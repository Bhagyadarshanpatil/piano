/**
 * basicPitchWorker.ts — Web Worker for ONNX-based polyphonic note detection
 *
 * Message protocol (main → worker):
 *   { type: 'load' }                           — preload model + warm up
 *   { type: 'infer', audio: Float32Array }     — run inference on a chunk
 *
 * Message protocol (worker → main):
 *   { type: 'ready' }                          — model loaded & warmed up
 *   { type: 'result', notes: NoteEventTime[] } — inference complete
 *   { type: 'error', message: string }         — something went wrong
 */

import * as ort from 'onnxruntime-web'

// ── Model constants ────────────────────────────────────────────────────────────
const MODEL_URL      = '/basic-pitch-onnx/nmp.onnx'
const SAMPLE_RATE    = 22050
const WINDOW_SAMPLES = 43844   // ~1.985 s at 22050 Hz
const FRAMES_PER_WIN = 172     // time frames per window
const MIDI_BINS      = 88      // 88 piano keys
const CONTOUR_BINS   = 264     // contour output bins

// Detection thresholds — tuned up to reject noise and false harmonics
const ONSET_THRESH = 0.50
const FRAME_THRESH = 0.35
const MIN_NOTE_LEN = 4         // frames (~46 ms, rejects clicks/pops)

const FRAMES_PER_SEC = SAMPLE_RATE / 256  // ~86.13

// ── ONNX session ───────────────────────────────────────────────────────────────
let session: ort.InferenceSession | null = null

// Resolved output tensor names (strings, not indices — immune to index bugs)
let noteOutputName    = ''
let onsetOutputName   = ''

async function loadModel(): Promise<void> {
  ort.env.wasm.wasmPaths = '/ort-wasm/'

  session = await ort.InferenceSession.create(MODEL_URL, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  })

  // Warm-up run — also used to inspect tensor shapes
  const dummyFeed = {
    [session.inputNames[0]]: new ort.Tensor('float32', new Float32Array(WINDOW_SAMPLES), [1, WINDOW_SAMPLES, 1])
  }
  const warmup = await session.run(dummyFeed)

  console.log('[PolyMic Worker] input names:', session.inputNames)
  console.log('[PolyMic Worker] output names:', session.outputNames)

  // ── Resolve output tensor names by two methods, cross-validated ────────────
  //
  // The nmp.onnx exports from Spotify's TF SavedModel name outputs as
  // StatefulPartitionedCall:N, where the port suffix maps to:
  //   :0 → note (frame activations, 88 bins)
  //   :1 → onset (onset spikes, 88 bins)
  //   :2 → contour (pitch contour, 264 bins)
  //
  // The ONNX array order is REVERSED relative to port suffix:
  //   session.outputNames[0] = 'StatefulPartitionedCall:2'  (contour)
  //   session.outputNames[1] = 'StatefulPartitionedCall:1'  (onset)
  //   session.outputNames[2] = 'StatefulPartitionedCall:0'  (note)
  //
  // We match by suffix, then cross-validate by shape. If names are different
  // (e.g. 'note', 'onset', 'contour'), we fall back to shape-only detection.

  const names = session.outputNames

  // Method 1: match by suffix (':0' = note, ':1' = onset, ':2' = contour)
  const by0 = names.find(n => n.endsWith(':0'))
  const by1 = names.find(n => n.endsWith(':1'))
  const by2 = names.find(n => n.endsWith(':2'))

  // Method 2: shape-based — two-pass to avoid the initial-value trap
  // Pass A: find contour (264 bins)
  let shapeContour = ''
  const shape88: string[] = []
  for (const name of names) {
    const t = warmup[name]
    if (!t) continue
    const cols = Number(t.dims[t.dims.length - 1])
    if (cols === CONTOUR_BINS) shapeContour = name
    else if (cols === MIDI_BINS) shape88.push(name)
  }
  // shape88[0] = note (first 88-bin output), shape88[1] = onset (second)
  const shapeNote  = shape88[0] ?? ''
  const shapeOnset = shape88[1] ?? ''

  // Cross-validate: prefer suffix match when shape also agrees
  const contourName = by2 ?? shapeContour
  const resolvedNote = (by0 && warmup[by0] && Number(warmup[by0].dims[warmup[by0].dims.length - 1]) === MIDI_BINS)
    ? by0
    : shapeNote
  const resolvedOnset = (by1 && warmup[by1] && Number(warmup[by1].dims[warmup[by1].dims.length - 1]) === MIDI_BINS)
    ? by1
    : shapeOnset

  noteOutputName  = resolvedNote
  onsetOutputName = resolvedOnset

  console.log(`[PolyMic Worker] note="${noteOutputName}" onset="${onsetOutputName}" contour="${contourName}"`)
  console.log(`[PolyMic Worker] dims → note:${warmup[noteOutputName]?.dims}, onset:${warmup[onsetOutputName]?.dims}`)
}

// ── Inference ──────────────────────────────────────────────────────────────────

async function runOnnx(audio: Float32Array): Promise<{
  frames: Float32Array
  onsets: Float32Array
}> {
  if (!session) throw new Error('Model not loaded')

  // Pad or truncate to exactly WINDOW_SAMPLES
  let windowed = audio
  if (audio.length < WINDOW_SAMPLES) {
    windowed = new Float32Array(WINDOW_SAMPLES)
    windowed.set(audio)
  } else if (audio.length > WINDOW_SAMPLES) {
    windowed = audio.slice(0, WINDOW_SAMPLES)
  }

  const feed = {
    [session.inputNames[0]]: new ort.Tensor('float32', windowed, [1, WINDOW_SAMPLES, 1])
  }
  const results = await session.run(feed)

  return {
    frames: results[noteOutputName].data  as Float32Array,
    onsets: results[onsetOutputName].data as Float32Array,
  }
}

// ── Note reconstruction ────────────────────────────────────────────────────────
// Per-MIDI-bin state machine:
//   START  when onset fires OR frame becomes active (not requiring both)
//   SUSTAIN while frame stays active
//   END    when frame drops below threshold
//   RETRIGGER on new onset mid-note

interface NoteEventTime {
  startTimeSeconds: number
  durationSeconds:  number
  pitchMidi:        number
  amplitude:        number
}

function reconstructNotes(frames: Float32Array, onsets: Float32Array): NoteEventTime[] {
  const raw: NoteEventTime[] = []

  for (let midi = 0; midi < MIDI_BINS; midi++) {
    let noteStart = -1
    let ampSum    = 0
    let ampCount  = 0

    for (let f = 0; f < FRAMES_PER_WIN; f++) {
      const frameConf = frames[f * MIDI_BINS + midi]
      const onsetConf = onsets[f * MIDI_BINS + midi]
      const isFrame   = frameConf >= FRAME_THRESH
      const isOnset   = onsetConf >= ONSET_THRESH

      if (noteStart === -1) {
        if (isOnset || isFrame) {
          noteStart = f
          ampSum    = frameConf
          ampCount  = 1
        }
      } else {
        if (!isFrame) {
          // Frame dropped → note ends
          const dur = f - noteStart
          if (dur >= MIN_NOTE_LEN) {
            raw.push({
              startTimeSeconds: noteStart / FRAMES_PER_SEC,
              durationSeconds:  dur       / FRAMES_PER_SEC,
              pitchMidi:        midi + 21,
              amplitude:        ampSum / ampCount,
            })
          }
          noteStart = -1; ampSum = 0; ampCount = 0
        } else {
          ampSum += frameConf; ampCount++
          // New onset mid-note → retrigger
          if (isOnset && f > noteStart + MIN_NOTE_LEN) {
            raw.push({
              startTimeSeconds: noteStart / FRAMES_PER_SEC,
              durationSeconds:  (f - noteStart) / FRAMES_PER_SEC,
              pitchMidi:        midi + 21,
              amplitude:        ampSum / ampCount,
            })
            noteStart = f; ampSum = frameConf; ampCount = 1
          }
        }
      }
    }

    if (noteStart !== -1) {
      const dur = FRAMES_PER_WIN - noteStart
      if (dur >= MIN_NOTE_LEN) {
        raw.push({
          startTimeSeconds: noteStart     / FRAMES_PER_SEC,
          durationSeconds:  dur           / FRAMES_PER_SEC,
          pitchMidi:        midi + 21,
          amplitude:        ampSum / ampCount,
        })
      }
    }
  }

  // ── Harmonic suppression ───────────────────────────────────────────────────
  // A single piano note generates harmonics at octave intervals and other
  // overtones. Suppress weaker notes whose pitch class matches a stronger note
  // at a lower MIDI pitch within the same 2-octave window.
  return suppressHarmonics(raw)
}

function suppressHarmonics(notes: NoteEventTime[]): NoteEventTime[] {
  if (notes.length <= 1) return notes

  // Sort by amplitude descending so we always keep the strongest candidate
  const sorted = notes.slice().sort((a, b) => b.amplitude - a.amplitude)
  const kept: NoteEventTime[] = []

  for (const candidate of sorted) {
    // Suppress if a stronger already-kept note is likely causing this as a harmonic.
    // This catches Octaves (12, 24), Perfect 12ths (19), and Major 17ths (28).
    const isHarmonic = kept.some(k => {
      const interval = candidate.pitchMidi - k.pitchMidi
      if (interval <= 0 || interval > 28) return false
      
      const isOctave = interval % 12 === 0
      const isP12 = interval === 19
      const isM17 = interval === 28
      
      return (isOctave || isP12 || isM17) && (candidate.amplitude < k.amplitude * 0.85)
    })
    if (!isHarmonic) kept.push(candidate)
  }

  return kept
}

// ── Message handler ────────────────────────────────────────────────────────────

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data

  if (msg.type === 'load') {
    try {
      await loadModel()
      self.postMessage({ type: 'ready' })
    } catch (err: any) {
      self.postMessage({ type: 'error', message: String(err?.message ?? err) })
    }
    return
  }

  if (msg.type === 'infer') {
    if (!session) {
      self.postMessage({ type: 'error', message: 'Model not loaded yet' })
      return
    }
    try {
      const { frames, onsets } = await runOnnx(msg.audio as Float32Array)
      const notes = reconstructNotes(frames, onsets)
      self.postMessage({ type: 'result', notes })
    } catch (err: any) {
      self.postMessage({ type: 'error', message: String(err?.message ?? err) })
    }
    return
  }
}
