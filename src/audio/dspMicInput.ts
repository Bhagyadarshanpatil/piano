"use client"
/**
 * dspMicInput.ts — DSP-based polyphonic microphone input
 *
 * Architecture mirrors micInput.ts as closely as possible:
 *   Mic → HPF(80Hz) → AnalyserNode → harmonic sieve → note events
 *
 * Key design decisions borrowed from micInput.ts:
 *
 * 1. BiquadFilter high-pass at 80Hz removes room rumble and handling noise
 *    before any analysis — the single biggest accuracy improvement.
 *
 * 2. Uses the browser's native AnalyserNode FFT (no custom FFT Worker) with a
 *    large fftSize=16384 for 2.69 Hz/bin frequency resolution — sharp enough
 *    to separate adjacent piano semitones even at the low end.
 *
 * 3. Per-note EMA noise floor (analogous to micInput's rmsEma): each of the
 *    88 piano keys tracks its own background energy level at its harmonic
 *    frequency bins.  A note fires when its harmonic score spikes ONSET_SPIKE×
 *    above its own ambient floor — self-calibrating and room-noise immune.
 *    The EMA only updates during near-silence (score < ema × 2) so the
 *    note itself doesn't raise its own floor and mask re-attacks.
 *
 * 4. Fundamental-presence guard: if a note's harmonic score comes mostly from
 *    higher partials with near-zero fundamental energy, it is a sub-harmonic
 *    ghost (e.g., C3 appearing because C4 is played). Discarded.
 *
 * 5. setInterval at POLL_MS for consistent polling independent of vsync.
 *
 * 6. Per-note onset cooldown + release timer from micInput.ts.
 */

import { audioEngine } from './engine'
import { markLivePlay } from '../usage'

// ── Tunables ──────────────────────────────────────────────────────────────────

/** AnalyserNode FFT size. 16384 at 44100Hz → 2.69 Hz/bin; covers full piano. */
const FFT_SIZE = 16384

/** How often to run the harmonic sieve (ms). ~12.5 analyses/sec. */
const POLL_MS = 80

/** RMS gate — skip analysis in true silence (matches micInput.ts). */
const RMS_GATE = 0.006

/** Speed of per-note EMA noise floor adaptation. Smaller = slower = more stable. */
const EMA_ALPHA = 0.08

/** Score must be this many × the note's own EMA floor to count as onset. */
const ONSET_SPIKE = 2.5

/** Minimum harmonic score (absolute floor regardless of EMA). */
const ABSOLUTE_MIN = 0.001

/** ms between triggers of the same note (prevents rapid-fire re-triggers). */
const COOLDOWN_MS = 120

/** ms after score drops before releasing the note (sustain tail). */
const RELEASE_MS  = 300

/** Minimum dB to consider a frequency bin "present". */
const MIN_DB = -85

/** Fundamental-presence ratio: fundamental magnitude must be ≥ this × score. */
const FUND_RATIO = 0.10

// ── Piano note table ──────────────────────────────────────────────────────────

const MIDI_MIN      = 21    // A0
const MIDI_MAX      = 108   // C8
const NUM_NOTES     = MIDI_MAX - MIDI_MIN + 1

/** Harmonic weights: fundamental is most important, overtones taper off. */
const HARMONIC_WEIGHTS = [1.0, 0.55, 0.30, 0.15, 0.08]
const NUM_HARMONICS    = HARMONIC_WEIGHTS.length

/** Bin indices for each harmonic of each piano note, computed at 44100 Hz. */
const PIANO_BINS: Uint16Array[] = (() => {
  const SR   = 44100
  const HALF = FFT_SIZE >> 1
  const out: Uint16Array[] = []
  for (let m = MIDI_MIN; m <= MIDI_MAX; m++) {
    const f0   = 440.0 * Math.pow(2.0, (m - 69) / 12.0)
    const bins = new Uint16Array(NUM_HARMONICS)
    for (let h = 0; h < NUM_HARMONICS; h++) {
      const bin = Math.round((h + 1) * f0 * FFT_SIZE / SR)
      bins[h] = Math.max(1, Math.min(bin, HALF - 1))
    }
    out.push(bins)
  }
  return out
})()

// ── Manager ───────────────────────────────────────────────────────────────────

class DspMicInputManager {
  // Audio graph (same structure as micInput.ts)
  private ctx:      AudioContext | null = null
  private stream:   MediaStream  | null = null
  private analyser: AnalyserNode | null = null
  private hpf:      BiquadFilterNode | null = null

  // Analysis buffers (allocated once, reused every tick)
  private freqData: Float32Array<ArrayBuffer> = new Float32Array(new ArrayBuffer(0))
  private timeData: Float32Array<ArrayBuffer> = new Float32Array(new ArrayBuffer(0))

  // Per-note state (all Float32Array / Uint8Array for cache efficiency)
  private noteEma      = new Float32Array(NUM_NOTES)  // per-note EMA floor
  private noteCooldown = new Float64Array(NUM_NOTES)  // timestamp of last trigger

  // Active notes (MIDI → release callback + last-seen timestamp)
  private activeNotes = new Map<number, { release: () => void; lastSeen: number }>()

  private timer: ReturnType<typeof setInterval> | null = null
  private isListening = false
  private subs = new Set<() => void>()

  // ── Public API ───────────────────────────────────────────────────────────

  isSupported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia
    )
  }

  isCurrentlyListening(): boolean { return this.isListening }

  addListener(fn: () => void): () => void {
    this.subs.add(fn)
    return () => this.subs.delete(fn)
  }

  async toggleListening(): Promise<boolean> {
    if (this.isListening) { this.stop(); return false }
    return this.start()
  }

  async start(): Promise<boolean> {
    if (!this.isSupported() || this.isListening) return false

    try {
      // ── 1. Mic: raw, no browser DSP (same as micInput.ts) ─────────────
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          autoGainControl:  false,
          noiseSuppression: false,
        },
      })

      // ── 2. AudioContext at 44100 Hz (same as micInput.ts) ─────────────
      this.ctx = new AudioContext({ sampleRate: 44100 })
      if (this.ctx.state === 'suspended') await this.ctx.resume()

      // ── 3. Filter chain: Source → HPF(80Hz) → AnalyserNode ────────────
      this.hpf = this.ctx.createBiquadFilter()
      this.hpf.type           = 'highpass'
      this.hpf.frequency.value = 80
      this.hpf.Q.value         = 0.707

      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize               = FFT_SIZE
      this.analyser.smoothingTimeConstant = 0.0   // 0 = sharp transients, no smearing
      this.analyser.minDecibels           = -100
      this.analyser.maxDecibels           = -10

      const source = this.ctx.createMediaStreamSource(this.stream)
      source.connect(this.hpf)
      this.hpf.connect(this.analyser)
      // Connect to a silent gain node so the graph stays alive
      const silent = this.ctx.createGain(); silent.gain.value = 0
      this.analyser.connect(silent); silent.connect(this.ctx.destination)

      // ── 4. Allocate analysis buffers ───────────────────────────────────
      const binCount = this.analyser.frequencyBinCount  // = FFT_SIZE / 2
      this.freqData  = new Float32Array(new ArrayBuffer(binCount * 4))
      this.timeData  = new Float32Array(new ArrayBuffer(FFT_SIZE * 4))

      // ── 5. Reset per-note state ────────────────────────────────────────
      this.noteEma.fill(0)
      this.noteCooldown.fill(0)
      for (const { release } of this.activeNotes.values()) release()
      this.activeNotes.clear()

      // ── 6. Start polling ───────────────────────────────────────────────
      this.isListening = true
      this.notify()
      this.timer = setInterval(this.tick, POLL_MS)

      console.log('[DspMic] Started — AnalyserNode + HPF + harmonic sieve')
      return true
    } catch (err) {
      console.error('[DspMic] start() failed:', err)
      this.stop()
      return false
    }
  }

  stop(): void {
    if (!this.isListening) return
    this.isListening = false

    if (this.timer !== null) { clearInterval(this.timer); this.timer = null }

    this.stream?.getTracks().forEach(t => t.stop())
    this.stream   = null
    this.analyser = null
    this.hpf      = null
    this.ctx?.close().catch(() => {})
    this.ctx = null

    for (const { release } of this.activeNotes.values()) release()
    this.activeNotes.clear()

    this.notify()
    console.log('[DspMic] Stopped')
  }

  // ── Core analysis tick ───────────────────────────────────────────────────

  private tick = (): void => {
    if (!this.isListening || !this.analyser || !this.ctx) return

    const now = performance.now()

    // ── RMS gate (same logic as micInput.ts) ──────────────────────────────
    this.analyser.getFloatTimeDomainData(this.timeData)
    let sumSq = 0
    for (let i = 0; i < this.timeData.length; i++) sumSq += this.timeData[i] * this.timeData[i]
    const rms = Math.sqrt(sumSq / this.timeData.length)

    if (rms < RMS_GATE) {
      // True silence — slowly decay EMA floors toward zero
      for (let n = 0; n < NUM_NOTES; n++) {
        this.noteEma[n] *= (1 - EMA_ALPHA)
      }
      this._releaseStalledNotes(now)
      return
    }

    // ── Frequency-domain harmonic sieve ───────────────────────────────────
    this.analyser.getFloatFrequencyData(this.freqData)

    const dbToLin = (db: number) => db <= MIN_DB ? 0 : Math.pow(10, db / 20)

    // Local Peak Picking: A true musical note produces sharp peaks in the spectrum.
    // Broadband noise (fans, breath, room hum) raises all bins together.
    // We only accept a bin if it stands out significantly from its immediate neighbors.
    const getPeakAmp = (bin: number) => {
      // 1. Max in a tight 3-bin window (handles slight tuning offsets)
      const b1 = Math.max(0, bin - 1)
      const b3 = Math.min(this.freqData.length - 1, bin + 1)
      const maxDb = Math.max(this.freqData[b1], this.freqData[bin], this.freqData[b3])
      
      // 2. Average of the surrounding 12 bins (local noise floor)
      let localNoiseSum = 0
      let count = 0
      const start = Math.max(0, bin - 8)
      const end = Math.min(this.freqData.length - 1, bin + 8)
      for (let i = start; i <= end; i++) {
        // Exclude the tight 3-bin peak window from the noise average
        if (Math.abs(i - bin) > 1) { 
           localNoiseSum += this.freqData[i]
           count++
        }
      }
      const localNoiseDb = count > 0 ? localNoiseSum / count : -100

      // 3. Prominence check: Peak must be at least 6dB louder than surrounding noise
      // (12dB was too strict and caused notes in dense chords to mask each other)
      if (maxDb - localNoiseDb < 6) return 0
      
      return dbToLin(maxDb)
    }

    const nowActive = new Set<number>()
    const scores = new Float32Array(NUM_NOTES)

    for (let n = 0; n < NUM_NOTES; n++) {
      const bins = PIANO_BINS[n]

      let score    = 0
      let fundMag  = 0
      for (let h = 0; h < NUM_HARMONICS; h++) {
        const amp = getPeakAmp(bins[h])
        score += HARMONIC_WEIGHTS[h] * amp
        if (h === 0) fundMag = amp
      }
      scores[n] = score

      // Fundamental-presence guard: rejects sub-harmonic ghosts.
      const fundOk = score > 0 && fundMag >= score * FUND_RATIO

      let ema = this.noteEma[n]
      if (ema === 0) { ema = score; this.noteEma[n] = ema }

      const isActive = this.activeNotes.has(MIDI_MIN + n)

      // Only update background noise floor if it's not currently playing,
      // and prevent sudden loud ghost peaks from ruining the floor.
      if (!isActive && score < ema * 5.0) {
        ema = ema * (1 - EMA_ALPHA) + score * EMA_ALPHA
        this.noteEma[n] = ema
      }

      const threshold = Math.max(ema * ONSET_SPIKE, ABSOLUTE_MIN)
      const isOnset   = score >= threshold && fundOk && now >= this.noteCooldown[n]

      if (isOnset) {
        nowActive.add(MIDI_MIN + n)
        this.noteCooldown[n] = now + COOLDOWN_MS
      } else if (isActive && score >= Math.max(ema * 1.5, ABSOLUTE_MIN * 0.5) && fundOk) {
        // Sustaining
        nowActive.add(MIDI_MIN + n)
      }
    }

    // ── Precise harmonic ghost suppression ─────────────────────────────────
    // Sort by score descending: strongest notes get priority.
    const activeArr = Array.from(nowActive)
    activeArr.sort((a, b) => scores[b - MIDI_MIN] - scores[a - MIDI_MIN])

    const suppressed = new Set<number>()
    
    for (let i = 0; i < activeArr.length; i++) {
      const mA = activeArr[i]
      if (suppressed.has(mA)) continue
      
      const sA = scores[mA - MIDI_MIN]
      
      for (let j = i + 1; j < activeArr.length; j++) {
        const mB = activeArr[j]
        if (suppressed.has(mB)) continue
        
        const sB = scores[mB - MIDI_MIN]
        const interval = Math.abs(mA - mB)
        
        // Is mB a potential harmonic ghost of mA? 
        // Covers Octaves (12,24,36), Perfect 12th (19), Major 17th (28)
        const isHarmonic = 
          interval % 12 === 0 || 
          interval === 19 || 
          interval === 28
          
        if (isHarmonic && sB < sA * 0.85) {
          suppressed.add(mB)
        }
      }
    }
    for (const m of suppressed) nowActive.delete(m)

    // ── Note on/off reconciliation ─────────────────────────────────────────
    for (const [midi, state] of this.activeNotes.entries()) {
      if (!nowActive.has(midi)) {
        if (now - state.lastSeen > RELEASE_MS) {
          state.release()
          this.activeNotes.delete(midi)
        }
      } else {
        state.lastSeen = now
      }
    }

    for (const midi of nowActive) {
      if (!this.activeNotes.has(midi)) {
        markLivePlay('mic')
        // Velocity: map RMS to a 0.0 - 1.0 range for the audio engine / visualizer
        const normRms  = Math.min(1, rms / 0.20)
        const velocityRaw = Math.min(127, Math.round(50 + 60 * Math.pow(normRms, 0.5)))
        const velocity = velocityRaw / 127.0 // engine expects 0-1
        const handle   = audioEngine.triggerKey(midi, velocity)
        if (handle) {
          this.activeNotes.set(midi, { release: handle.release, lastSeen: now })
        }
      }
    }
  }

  private _releaseStalledNotes(now: number) {
    for (const [midi, state] of this.activeNotes.entries()) {
      if (now - state.lastSeen > RELEASE_MS) {
        state.release()
        this.activeNotes.delete(midi)
      }
    }
  }

  private notify() {
    for (const fn of this.subs) fn()
  }
}

export const dspMicInput = new DspMicInputManager()
