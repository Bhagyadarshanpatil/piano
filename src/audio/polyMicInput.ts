import { audioEngine } from './engine'
import { markLivePlay } from '../usage'

// ── Audio pipeline constants ──────────────────────────────────────────────────
const CHUNK_MS   = 500
const OVERLAP_MS = 100

// ── Dynamic noise gate constants ─────────────────────────────────────────────
const NOISE_FLOOR_ALPHA = 0.02   // slow EMA — only updated during silence
const NOISE_GATE_RATIO  = 3.0    // signal must be 3× noise floor to pass
const NOISE_GATE_MIN    = 0.001  // absolute minimum floor

// ── NoteEventTime (matches @spotify/basic-pitch type, no import needed) ──────
interface NoteEventTime {
  startTimeSeconds: number
  durationSeconds:  number
  pitchMidi:        number
  amplitude:        number
  pitchBends?:      number[]
}

class PolyMicInputManager {
  private stream:    MediaStream | null = null
  private ctx:       AudioContext | null = null
  private processor: ScriptProcessorNode | null = null

  // Inference is delegated entirely to a Web Worker — no TF.js on the main thread.
  private worker:      Worker | null = null
  private workerReady  = false
  private isProcessing = false

  private isListening = false
  private subs = new Set<() => void>()

  private activeNotes = new Map<number, () => void>()

  // Dynamic noise gate state
  private noiseFloor = NOISE_GATE_MIN

  // ── Public API ───────────────────────────────────────────────────────────────

  isSupported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof Worker !== 'undefined'
    )
  }

  isCurrentlyListening(): boolean {
    return this.isListening
  }

  addListener(fn: () => void): () => void {
    this.subs.add(fn)
    return () => { this.subs.delete(fn) }
  }

  async toggleListening(): Promise<boolean> {
    if (this.isListening) { this.stop(); return false }
    return this.start()
  }

  /**
   * Preloads the ONNX model in a background worker.
   * Call this on mount so the model is warm before the user clicks the button.
   */
  async preload(): Promise<void> {
    if (this.worker) return
    try {
      this.worker = new Worker(
        new URL('./basicPitchWorker.ts', import.meta.url),
        { type: 'module' }
      )
      this.worker.onmessage = (e) => this.handleWorkerMessage(e)
      this.worker.onerror   = (e) => console.error('[PolyMic] Worker error:', e)
      this.worker.postMessage({ type: 'load' })
      // workerReady is set to true when the worker replies with { type: 'ready' }
    } catch (err) {
      console.warn('[PolyMic] Preload failed (non-fatal):', err)
      this.worker = null
    }
  }

  async start(): Promise<boolean> {
    if (!this.isSupported() || this.isListening) return false

    try {
      // 1. AudioContext — created immediately to avoid suspension
      this.ctx = new AudioContext({ sampleRate: 22050 })
      if (this.ctx.state === 'suspended') await this.ctx.resume()

      // 2. Mic stream — raw, no browser DSP
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false },
      })

      // 3. Spin up worker if preload() wasn't called
      if (!this.worker) await this.preload()

      // 4. Script processor for audio capture
      this.processor = this.ctx.createScriptProcessor(4096, 1, 1)
      const source   = this.ctx.createMediaStreamSource(this.stream)
      source.connect(this.processor)
      this.processor.connect(this.ctx.destination)

      let buffer: Float32Array[] = []
      let bufferLength = 0
      const targetLength = Math.floor(22050 * (CHUNK_MS / 1000))

      // ── Audio callback — MUST stay synchronous ────────────────────────────
      // We snapshot the buffer and post it to the worker. The worker reply
      // arrives asynchronously via handleWorkerMessage(). The isProcessing
      // flag prevents concurrent inference calls, but never blocks this
      // callback — chunks keep accumulating while inference runs.
      this.processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0)
        buffer.push(new Float32Array(input))
        bufferLength += input.length

        if (bufferLength >= targetLength && !this.isProcessing && this.workerReady) {
          this.isProcessing = true

          // Snapshot accumulated buffer synchronously
          const combined = new Float32Array(bufferLength)
          let offset = 0
          for (const b of buffer) { combined.set(b, offset); offset += b.length }

          // Keep overlap for continuity
          const overlapLen = Math.floor(22050 * (OVERLAP_MS / 1000))
          buffer       = [combined.slice(combined.length - overlapLen)]
          bufferLength = buffer[0].length

          // RMS for noise gate (computed on raw signal)
          let sumSq = 0
          for (let i = 0; i < combined.length; i++) sumSq += combined[i] * combined[i]
          const rms = Math.sqrt(sumSq / combined.length)

          // Update noise floor ONLY during silence (2× of floor or less).
          // If updated unconditionally, note audio pulls the floor up and
          // subsequent soft notes get gated — the opposite of what we want.
          if (rms < this.noiseFloor * 2.0) {
            this.noiseFloor = Math.max(
              NOISE_GATE_MIN,
              this.noiseFloor * (1 - NOISE_FLOOR_ALPHA) + rms * NOISE_FLOOR_ALPHA
            )
          }

          // Gate: skip inference for true silence / background noise
          const gate = Math.max(NOISE_GATE_MIN, this.noiseFloor * NOISE_GATE_RATIO)
          if (rms < gate) {
            this.handleDetectedNotes([])
            this.isProcessing = false
            return
          }

          // ── Software AGC (pre-amplification) ─────────────────────────────
          // The ONNX model expects audio at a normal recording level. Soft
          // playing or a low-gain mic produces low-amplitude signal that causes
          // the model's confidence scores to drop below threshold even when it
          // "hears" the note. Boosting to a target peak of ~0.25 restores
          // confidence without affecting the gate (which ran on raw RMS above).
          let inferBuf = combined
          let peakAmp  = 0
          for (let i = 0; i < combined.length; i++) {
            const a = Math.abs(combined[i])
            if (a > peakAmp) peakAmp = a
          }
          if (peakAmp > 0 && peakAmp < 0.25) {
            const gain = Math.min(0.25 / peakAmp, 12.0)
            inferBuf = new Float32Array(combined.length)
            for (let i = 0; i < combined.length; i++) inferBuf[i] = combined[i] * gain
          }

          // Hand off to worker — zero cost on this thread
          this.worker!.postMessage({ type: 'infer', audio: inferBuf }, [inferBuf.buffer])
        }
      }

      this.isListening = true
      this.notify()
      return true
    } catch (err) {
      console.error('[PolyMic] start failed:', err)
      this.stop()
      return false
    }
  }

  stop(): void {
    if (!this.isListening) return
    this.isListening = false

    if (this.processor) {
      this.processor.disconnect()
      this.processor.onaudioprocess = null
      this.processor = null
    }

    this.stream?.getTracks().forEach(t => t.stop())
    this.stream = null
    this.ctx?.close().catch(() => {})
    this.ctx = null

    for (const release of this.activeNotes.values()) release()
    this.activeNotes.clear()

    this.notify()
  }

  // ── Worker message handler ────────────────────────────────────────────────

  private handleWorkerMessage(e: MessageEvent) {
    const msg = e.data

    if (msg.type === 'ready') {
      this.workerReady = true
      console.log('[PolyMic] ONNX model ready ✓')
      return
    }

    if (msg.type === 'result') {
      this.handleDetectedNotes(msg.notes as NoteEventTime[])
      this.isProcessing = false
      return
    }

    if (msg.type === 'error') {
      console.error('[PolyMic] Worker error:', msg.message)
      this.isProcessing = false
    }
  }

  // ── Note event dispatch ───────────────────────────────────────────────────

  private handleDetectedNotes(notes: NoteEventTime[]) {
    const newNotes = new Set(notes.map(n => n.pitchMidi))

    for (const [midi, release] of this.activeNotes.entries()) {
      if (!newNotes.has(midi)) {
        release()
        this.activeNotes.delete(midi)
      }
    }

    for (const note of notes) {
      if (!this.activeNotes.has(note.pitchMidi)) {
        markLivePlay('mic')
        const velocity = Math.floor(note.amplitude * 127)
        const handle   = audioEngine.triggerKey(note.pitchMidi, velocity || 80)
        if (handle) {
          this.activeNotes.set(note.pitchMidi, handle.release)
        }
      }
    }
  }

  private notify() {
    for (const fn of this.subs) fn()
  }
}

export const polyMicInput = new PolyMicInputManager()
