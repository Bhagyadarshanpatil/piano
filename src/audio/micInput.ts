"use client"
/**
 * Microphone → Virtual Piano bridge.
 *
 * Listens to the user's microphone, detects the pitch of individual piano
 * notes being played on a real instrument, and triggers the corresponding
 * key on the virtual piano in real-time.
 *
 * Architecture:
 *   Mic → HighPass(60Hz) → LowPass(5kHz) → AnalyserNode → MPM pitch detect
 *
 * Key design decisions (informed by how Simply Piano / Flowkey work):
 *
 * 1. Uses the `pitchy` library (McLeod Pitch Method / MPM) — the gold
 *    standard for monophonic pitch detection. MPM's NSDF normalization +
 *    key-maxima selection is specifically designed to avoid octave errors,
 *    the #1 problem with naive autocorrelation.
 *
 * 2. Audio filtering chain (BiquadFilters) removes room rumble (<60Hz)
 *    and high-frequency noise (>5kHz) before pitch detection, dramatically
 *    reducing false positives.
 *
 * 3. Uses `setInterval` at ~23ms for consistent polling independent of
 *    display refresh rate (rAF is tied to vsync, which can vary 30-144Hz).
 *
 * 4. Onset detection uses amplitude envelope tracking (exponential moving
 *    average of RMS) to detect both new pitches AND re-attacks of the same
 *    note — critical for detecting repeated notes like scales/arpeggios.
 *
 * 5. Majority-vote pitch smoothing over a sliding window eliminates
 *    single-frame glitches without adding perceptible latency.
 */

import { PitchDetector } from 'pitchy'
import { audioEngine } from './engine'
import { markLivePlay } from '../usage'

// ===================================================================
// Tunables — adjust these if detection feels off in your environment
// ===================================================================

/** AnalyserNode FFT size. 4096 at 44.1kHz = ~93ms window.
 *  Good balance: covers A0 (27.5Hz needs lag 1604 → fits in 4096)
 *  while keeping latency under 100ms. */
const BUFFER_SIZE = 4096

/** How often to poll the analyser (ms). ~43Hz independent of display. */
const POLL_MS = 23

/** Minimum clarity (0–1) from MPM to accept a detection.
 *  Raise if you get false triggers on noise; lower if it misses notes.
 *  0.90–0.95 is the sweet spot for piano. */
const MIN_CLARITY = 0.92

/** Absolute RMS floor. Below this = silence (noise gate). */
const RMS_GATE = 0.005

/** RMS must spike this many × above background EMA to count as onset. */
const ONSET_SPIKE = 2.5

/** Minimum ms between onset triggers (prevents rapid-fire re-triggers). */
const ONSET_COOLDOWN_MS = 55

/** How long (ms) after last detected sound before releasing the note. */
const RELEASE_MS = 200

/** Majority-vote window size. Need ≥ ceil(N/2) agreeing frames. */
const VOTE_WINDOW = 3

/** Background RMS EMA speed. Smaller = slower adaptation = more stable. */
const EMA_ALPHA = 0.07

/** Lowest MIDI note to accept (A0). */
const MIDI_MIN = 21
/** Highest MIDI note to accept (C8). */
const MIDI_MAX = 108

// ===================================================================
// MicInputManager
// ===================================================================

class MicInputManager {
  // Audio graph
  private stream: MediaStream | null = null
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private gainNode: GainNode | null = null
  private hpf: BiquadFilterNode | null = null   // high-pass 60Hz
  private lpf: BiquadFilterNode | null = null    // low-pass 5kHz

  // Detection
  private detector: PitchDetector<Float32Array> | null = null
  private buf = new Float32Array(new ArrayBuffer(BUFFER_SIZE * 4))
  private timer: ReturnType<typeof setInterval> | null = null
  private listening = false

  // Note state
  private activeNote: number | null = null
  private activeRelease: (() => void) | null = null
  private lastSoundTs = 0
  private lastOnsetTs = 0

  // Smoothing
  private rmsEma = 0
  private votes: number[] = []

  // React listeners
  private subs = new Set<() => void>()

  // ── Public API ──────────────────────────────────────────────────────

  isSupported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
  }

  isCurrentlyListening(): boolean {
    return this.listening
  }

  addListener(fn: () => void): () => void {
    this.subs.add(fn)
    return () => { this.subs.delete(fn) }
  }

  async toggleListening(): Promise<boolean> {
    if (this.listening) { this.stop(); return false }
    return this.start()
  }

  async start(): Promise<boolean> {
    if (!this.isSupported() || this.listening) return false

    try {
      // ── 1. Mic stream — raw, no browser DSP ─────────────────────────
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          autoGainControl: false,
          noiseSuppression: false,
        },
      })

      // ── 2. Audio context ────────────────────────────────────────────
      this.ctx = new AudioContext({ sampleRate: 44100 })

      // ── 3. Filter chain: Source → HPF → LPF → Analyser ─────────────
      //
      //   High-pass at 60Hz: removes AC hum, room rumble, handling noise.
      //   Low-pass at 5kHz: removes key clicks, high harmonics that
      //   confuse the pitch detector, and general HF noise.
      //
      //   This mimics the "biological filtering" approach from the
      //   Tartini pitch tracker (McLeod 2008) — pre-filter to the
      //   frequency range that carries pitch information.
      //
      this.hpf = this.ctx.createBiquadFilter()
      this.hpf.type = 'highpass'
      this.hpf.frequency.value = 60
      this.hpf.Q.value = 0.707

      this.lpf = this.ctx.createBiquadFilter()
      this.lpf.type = 'lowpass'
      this.lpf.frequency.value = 5000
      this.lpf.Q.value = 0.707

      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = BUFFER_SIZE
      this.analyser.smoothingTimeConstant = 0  // No built-in smoothing
      
      this.gainNode = this.ctx.createGain()
      this.gainNode.gain.value = 1.0

      this.source = this.ctx.createMediaStreamSource(this.stream)
      this.source.connect(this.gainNode)
      this.gainNode.connect(this.hpf)
      this.hpf.connect(this.lpf)
      this.lpf.connect(this.analyser)

      // ── 4. Pitch detector (pitchy / MPM) ────────────────────────────
      this.detector = PitchDetector.forFloat32Array(BUFFER_SIZE)
      this.buf = new Float32Array(new ArrayBuffer(BUFFER_SIZE * 4))

      // ── 5. Reset state ──────────────────────────────────────────────
      this.rmsEma = 0
      this.votes = []
      this.lastSoundTs = 0
      this.lastOnsetTs = 0
      this.activeNote = null
      this.activeRelease = null

      // ── 6. Start polling ────────────────────────────────────────────
      this.listening = true
      this.notify()
      this.timer = setInterval(this.tick, POLL_MS)

      return true
    } catch (e) {
      console.error('[MicInput] start failed:', e)
      this.cleanup()
      return false
    }
  }

  stop(): void {
    if (!this.listening) return
    this.listening = false
    this.cleanup()
    this.release()
    this.notify()
  }

  // ── Internals ───────────────────────────────────────────────────────

  private notify() {
    for (const fn of this.subs) fn()
  }

  private cleanup() {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null }
    this.stream?.getTracks().forEach(t => t.stop())
    this.stream = null
    this.ctx?.close().catch(() => {})
    this.ctx = null
    this.analyser = null
    this.source = null
    this.gainNode = null
    this.hpf = null
    this.lpf = null
    this.detector = null
  }

  private release() {
    this.activeRelease?.()
    this.activeRelease = null
    this.activeNote = null
  }

  // ── Core tick ───────────────────────────────────────────────────────

  private tick = (): void => {
    if (!this.listening || !this.analyser || !this.detector || !this.ctx) return

    this.analyser.getFloatTimeDomainData(this.buf)
    const now = performance.now()

    // ── RMS energy ──────────────────────────────────────────────────
    let sumSq = 0
    for (let i = 0; i < this.buf.length; i++) sumSq += this.buf[i] * this.buf[i]
    const rms = Math.sqrt(sumSq / this.buf.length)

    // (Dynamic Auto-Gain removed as requested)

    // ── Silence gate ────────────────────────────────────────────────
    if (rms < RMS_GATE) {
      this.rmsEma = this.rmsEma * (1 - EMA_ALPHA) + rms * EMA_ALPHA
      this.votes = []
      if (this.activeNote !== null && now - this.lastSoundTs > RELEASE_MS) {
        this.release()
      }
      return
    }

    // ── Pitch detection via pitchy (McLeod Pitch Method) ────────────
    const [freq, clarity] = this.detector.findPitch(this.buf, this.ctx.sampleRate)

    if (clarity < MIN_CLARITY || freq <= 0) {
      // Heard sound but no clear pitch
      this.rmsEma = this.rmsEma * (1 - EMA_ALPHA) + rms * EMA_ALPHA
      return
    }

    const midi = Math.round(69 + 12 * Math.log2(freq / 440))
    if (midi < MIDI_MIN || midi > MIDI_MAX) return

    // ── Majority-vote smoothing ─────────────────────────────────────
    this.votes.push(midi)
    if (this.votes.length > VOTE_WINDOW) this.votes.shift()

    const counts = new Map<number, number>()
    let best = midi, bestN = 0
    for (const v of this.votes) {
      const n = (counts.get(v) ?? 0) + 1
      counts.set(v, n)
      if (n > bestN) { bestN = n; best = v }
    }
    if (bestN < Math.ceil(VOTE_WINDOW / 2)) return   // No consensus

    // ── Onset detection ─────────────────────────────────────────────
    const isNew   = best !== this.activeNote
    const isSpike = !isNew && rms > Math.max(this.rmsEma * ONSET_SPIKE, RMS_GATE * 3)
    const cooled  = now - this.lastOnsetTs > ONSET_COOLDOWN_MS

    this.lastSoundTs = now

    if ((isNew || isSpike) && cooled) {
      this.release()

      // Velocity: log-map RMS to 50–110 range, then normalize to 0.0–1.0 for the engine
      const normRms = Math.min(1, rms / 0.20)
      const velocityRaw = Math.min(127, Math.round(50 + 60 * Math.pow(normRms, 0.5)))
      const velocity = velocityRaw / 127.0 // engine expects 0-1

      markLivePlay('mic')
      const handle = audioEngine.triggerKey(best, velocity)
      if (handle) {
        this.activeNote = best
        this.activeRelease = handle.release
      }
      this.lastOnsetTs = now
      this.rmsEma = rms * 0.35   // Reset baseline after onset
    } else {
      // Sustaining — slow EMA update
      this.rmsEma = this.rmsEma * (1 - EMA_ALPHA * 0.25) + rms * (EMA_ALPHA * 0.25)
    }
  }
}

export const micInput = new MicInputManager()
