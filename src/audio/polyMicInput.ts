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
  private captureNode: AudioWorkletNode | null = null

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

      // 4. Capture AudioWorklet to replace deprecated ScriptProcessorNode
      try {
        await this.ctx.audioWorklet.addModule('/capture-worklet.js')
      } catch (err) {
        console.warn('AudioWorklet load failed, make sure capture-worklet.js is in public dir:', err)
      }
      
      this.captureNode = new AudioWorkletNode(this.ctx, 'capture-processor', {
        processorOptions: { bufferSize: 4096 }
      })
      const source = this.ctx.createMediaStreamSource(this.stream)
      source.connect(this.captureNode)
      this.captureNode.connect(this.ctx.destination) // Required by some browsers to keep it alive

      let buffer: Float32Array[] = []
      let bufferLength = 0
      const targetLength = Math.floor(22050 * (CHUNK_MS / 1000))

      // ── Audio callback — MUST stay synchronous ────────────────────────────
      // We snapshot the buffer and post it to the worker. The worker reply
      // arrives asynchronously via handleWorkerMessage(). The isProcessing
      // flag prevents concurrent inference calls, but never blocks this
      // callback — chunks keep accumulating while inference runs.
      this.captureNode.port.onmessage = (e) => {
        const input = e.data.audio
        buffer.push(input)
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
          let inferBuf = combined
          let peakAmp  = 0
          for (let i = 0; i < combined.length; i++) {
            const a = Math.abs(combined[i])
            if (a > peakAmp) peakAmp = a
          }
          if (peakAmp > 0 && peakAmp < 0.25) {
            // Cap the gain multiplier at 4.0x so we don't massively amplify room noise
            const gain = Math.min(0.25 / peakAmp, 4.0)
            inferBuf = new Float32Array(combined.length)
            for (let i = 0; i < combined.length; i++) inferBuf[i] = combined[i] * gain
          }

          // Hand off to worker
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

    if (this.captureNode) {
      this.captureNode.disconnect()
      this.captureNode.port.onmessage = null
      this.captureNode = null
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
        // engine expects velocity between 0.0 and 1.0, note.amplitude is 0-1
        const velocity = Math.max(0.1, Math.min(1.0, note.amplitude))
        const handle   = audioEngine.triggerKey(note.pitchMidi, velocity)
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
