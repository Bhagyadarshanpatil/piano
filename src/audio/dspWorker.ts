/**
 * dspWorker.ts — Web Worker: FFT + Harmonic Sieve polyphonic note detection
 *
 * Receives 8192-sample audio windows from DspMicInputManager, runs a full
 * Cooley-Tukey FFT, then scores all 88 piano keys using a harmonic sieve.
 * Notes are detected when their harmonic score clears a dynamic threshold.
 * Onset/offset state is tracked so we only report changes.
 *
 * Message protocol (main → worker):
 *   { type: 'analyze', audio: Float32Array }  — analyze a window
 *   { type: 'reset' }                         — reset note state
 *
 * Message protocol (worker → main):
 *   { type: 'notes', active: number[] }       — currently active MIDI notes
 */

// ── Constants ──────────────────────────────────────────────────────────────────
const SAMPLE_RATE   = 22050
const FFT_SIZE      = 8192
const HALF_FFT      = FFT_SIZE >> 1
const MIDI_MIN      = 21    // A0
const MIDI_MAX      = 108   // C8
const NUM_NOTES     = MIDI_MAX - MIDI_MIN + 1

// Harmonic weights: fundamental has the most weight, each overtone tapers off.
// Using 6 harmonics captures the piano's rich overtone series without
// reaching into a neighbouring note's frequency range.
const HARMONIC_WEIGHTS   = [1.0, 0.6, 0.4, 0.25, 0.15, 0.08]
const NUM_HARMONICS      = HARMONIC_WEIGHTS.length

// Detection parameters
//
// The threshold strategy uses THREE independent conditions and takes the
// strictest (max) of them to determine whether a bin is a real note:
//
//   1. RMS gate       — don't even run FFT if the signal is quiet (silence / room noise)
//   2. Noise-floor    — score must be NOISE_MULT × the 70th-percentile score, so a note
//                       has to clearly stick out of the noise distribution.
//   3. Relative       — score must be ON_RATIO of the strongest detected note, filtering
//                       weak harmonics relative to the fundamental.
//   4. Absolute min   — hard floor regardless of signal level.
//
// Hysteresis (ON_RATIO / OFF_RATIO) prevents flickering: a note fires immediately
// when score exceeds ON_RATIO of the max, and stays active until score drops below
// OFF_RATIO of the max.  No holdCount needed → zero onset latency.

const RMS_GATE      = 0.008   // skip FFT below this RMS level (keeps silence clean)
const NOISE_MULT    = 5.0     // note must be 5× the 70th-percentile score
const ON_RATIO      = 0.32    // note turns  ON when score > maxScore × ON_RATIO
const OFF_RATIO     = 0.16    // note turns OFF when score < maxScore × OFF_RATIO (hysteresis)
const ABSOLUTE_MIN  = 0.001   // absolute minimum per-note score
// Fundamental presence: the raw fundamental-bin magnitude must be at least this
// fraction of the total weighted score.  Eliminates sub-harmonic ghosts: when
// C4 is played, C3's sieve gets hits at its 2nd/4th harmonic positions (= C4's
// fundamental/2nd harmonic) but C3's own fundamental bin (130 Hz) is silent.
// A genuine C3 will have strong energy at 130 Hz → passes.
const FUND_RATIO    = 0.22    // fundamental mag must be ≥ 22% of total score

// ── Precomputed lookup tables ──────────────────────────────────────────────────

// Hann window — applied before FFT to suppress spectral leakage
const hann = new Float32Array(FFT_SIZE)
for (let i = 0; i < FFT_SIZE; i++) {
  hann[i] = 0.5 * (1.0 - Math.cos(2.0 * Math.PI * i / (FFT_SIZE - 1)))
}

// For each piano note, precompute FFT bin indices for each harmonic.
// Clamped to [1, HALF_FFT - 1] so we never read out of bounds.
// bin(f) = round(f * FFT_SIZE / SAMPLE_RATE)
const noteBins: Uint16Array[] = []
for (let m = MIDI_MIN; m <= MIDI_MAX; m++) {
  const f0   = 440.0 * Math.pow(2.0, (m - 69) / 12.0)
  const bins = new Uint16Array(NUM_HARMONICS)
  for (let h = 0; h < NUM_HARMONICS; h++) {
    const bin = Math.round((h + 1) * f0 * FFT_SIZE / SAMPLE_RATE)
    bins[h] = Math.max(1, Math.min(bin, HALF_FFT - 1))
  }
  noteBins.push(bins)
}

// ── FFT (Cooley-Tukey radix-2 DIT, in-place) ─────────────────────────────────
// Reusable typed arrays — allocated once, reused every frame for zero GC.
const fftReal = new Float64Array(FFT_SIZE)
const fftImag = new Float64Array(FFT_SIZE)
const mag     = new Float32Array(HALF_FFT)

// Bit-reversal permutation table (precomputed)
const bitRev = new Uint16Array(FFT_SIZE)
;(function buildBitRev() {
  const bits = Math.log2(FFT_SIZE)
  for (let i = 0; i < FFT_SIZE; i++) {
    let rev = 0, x = i
    for (let b = 0; b < bits; b++) { rev = (rev << 1) | (x & 1); x >>= 1 }
    bitRev[i] = rev
  }
})()

// Twiddle factor cache (precomputed cos/sin pairs)
const twiddleReal = new Float64Array(HALF_FFT)
const twiddleImag = new Float64Array(HALF_FFT)
;(function buildTwiddle() {
  for (let k = 0; k < HALF_FFT; k++) {
    const angle = -2.0 * Math.PI * k / FFT_SIZE
    twiddleReal[k] = Math.cos(angle)
    twiddleImag[k] = Math.sin(angle)
  }
})()

function fft(): void {
  // Bit-reversal permutation
  for (let i = 0; i < FFT_SIZE; i++) {
    const j = bitRev[i]
    if (i < j) {
      let t = fftReal[i]; fftReal[i] = fftReal[j]; fftReal[j] = t
          t = fftImag[i]; fftImag[i] = fftImag[j]; fftImag[j] = t
    }
  }

  // Butterfly stages
  for (let len = 2; len <= FFT_SIZE; len <<= 1) {
    const half   = len >> 1
    const stride = FFT_SIZE / len
    for (let i = 0; i < FFT_SIZE; i += len) {
      for (let k = 0; k < half; k++) {
        const ti = i + k + half
        const wr = twiddleReal[k * stride]
        const wi = twiddleImag[k * stride]
        const tr = wr * fftReal[ti] - wi * fftImag[ti]
        const ti2 = wr * fftImag[ti] + wi * fftReal[ti]
        fftReal[ti] = fftReal[i + k] - tr
        fftImag[ti] = fftImag[i + k] - ti2
        fftReal[i + k] += tr
        fftImag[i + k] += ti2
      }
    }
  }

  // Magnitude spectrum (positive frequencies only)
  for (let i = 0; i < HALF_FFT; i++) {
    mag[i] = Math.sqrt(fftReal[i] * fftReal[i] + fftImag[i] * fftImag[i])
  }
}

// ── Harmonic sieve ─────────────────────────────────────────────────────────────
const scores    = new Float32Array(NUM_NOTES)
const fundMags  = new Float32Array(NUM_NOTES)  // raw fundamental magnitude per note
const sortBuf   = new Float32Array(NUM_NOTES)
const activeSet = new Uint8Array(NUM_NOTES)    // 1 = currently active (hysteresis)

function analyzeWindow(audio: Float32Array): number[] {
  // ── 1. Hard RMS gate ───────────────────────────────────────────────────────
  let sumSq = 0.0
  for (let i = 0; i < audio.length; i++) sumSq += audio[i] * audio[i]
  const rmsVal = Math.sqrt(sumSq / audio.length)
  if (rmsVal < RMS_GATE) {
    activeSet.fill(0)
    return []
  }

  // ── 2. Hann window + FFT ───────────────────────────────────────────────────
  const len = Math.min(audio.length, FFT_SIZE)
  for (let i = 0; i < len; i++) {
    fftReal[i] = audio[i] * hann[i]
    fftImag[i] = 0.0
  }
  for (let i = len; i < FFT_SIZE; i++) { fftReal[i] = 0.0; fftImag[i] = 0.0 }
  fft()

  // ── 3. Harmonic sieve ─────────────────────────────────────────────────────
  let maxScore = 0.0
  for (let n = 0; n < NUM_NOTES; n++) {
    const bins = noteBins[n]
    let score  = 0.0
    for (let h = 0; h < NUM_HARMONICS; h++) {
      score += HARMONIC_WEIGHTS[h] * mag[bins[h]]
    }
    scores[n]   = score
    fundMags[n] = mag[bins[0]]          // save fundamental magnitude separately
    if (score > maxScore) maxScore = score
  }

  // ── 4. Noise-floor (70th-percentile of all 88 scores) ─────────────────────
  for (let i = 0; i < NUM_NOTES; i++) sortBuf[i] = scores[i]
  sortBuf.sort()                         // Float32Array.sort() is numeric — correct
  const noiseFloor  = sortBuf[Math.floor(NUM_NOTES * 0.70)]
  const noiseThresh = noiseFloor * NOISE_MULT

  // ── 5. Hysteresis activation with fundamental-presence guard ──────────────
  // ON  threshold = max(noiseThresh, maxScore × ON_RATIO,  ABSOLUTE_MIN)
  // OFF threshold = max(noiseThresh, maxScore × OFF_RATIO, ABSOLUTE_MIN × 0.5)
  const onThresh  = Math.max(noiseThresh, maxScore * ON_RATIO,  ABSOLUTE_MIN)
  const offThresh = Math.max(noiseThresh, maxScore * OFF_RATIO, ABSOLUTE_MIN * 0.5)

  const active: number[] = []

  for (let n = 0; n < NUM_NOTES; n++) {
    const s = scores[n]

    // Fundamental-presence guard: if the raw fundamental-bin magnitude is less
    // than FUND_RATIO × total weighted score, the note's "energy" is coming
    // almost entirely from higher harmonics of a different (real) note.
    // Example: playing C4 makes C3's 2nd+4th harmonic bins light up, but
    // C3's fundamental bin at 130 Hz stays near-zero → ghost → discard.
    const fundOk = fundMags[n] >= s * FUND_RATIO

    if (activeSet[n]) {
      if (s >= offThresh && fundOk) {
        active.push(MIDI_MIN + n)
      } else {
        activeSet[n] = 0
      }
    } else {
      if (s >= onThresh && fundOk) {
        activeSet[n] = 1
        active.push(MIDI_MIN + n)
      }
    }
  }

  // ── 6. Bidirectional harmonic suppression ─────────────────────────────────
  // For any two notes of the same pitch class within 24 semitones, keep only
  // the STRONGER one — regardless of direction.  This catches both:
  //   • octave harmonics above (C4 fundamental → C5/C6 ghost)
  //   • sub-harmonic ghosts below (C4 played → C3 ghost, which the fundamental
  //     check above also catches, but this is a second safety net)
  const suppressed = new Set<number>()
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const midiA = active[i], midiB = active[j]
      if (Math.abs(midiA - midiB) <= 24 && midiA % 12 === midiB % 12) {
        const sA = scores[midiA - MIDI_MIN], sB = scores[midiB - MIDI_MIN]
        if (sA < sB * 0.6) {
          suppressed.add(midiA); activeSet[midiA - MIDI_MIN] = 0
        } else if (sB < sA * 0.6) {
          suppressed.add(midiB); activeSet[midiB - MIDI_MIN] = 0
        }
      }
    }
  }

  return active.filter(m => !suppressed.has(m))
}

// ── Message handler ────────────────────────────────────────────────────────────

self.onmessage = (e: MessageEvent) => {
  const msg = e.data

  if (msg.type === 'analyze') {
    const active = analyzeWindow(msg.audio as Float32Array)
    self.postMessage({ type: 'notes', active })
    return
  }

  if (msg.type === 'reset') {
    activeSet.fill(0)
    return
  }
}
