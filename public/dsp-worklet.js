/**
 * dsp-worklet.js — AudioWorklet processor for DSP-based polyphonic mic input.
 *
 * Serves as a minimal audio capture layer. Runs on the dedicated audio thread,
 * accumulates 8192 samples with 50% overlap, then transfers each window to the
 * main thread via MessagePort for further analysis in the DSP Web Worker.
 *
 * Load via: audioContext.audioWorklet.addModule('/dsp-worklet.js')
 * Instantiate: new AudioWorkletNode(ctx, 'dsp-processor')
 */
class DspProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [] }

  constructor() {
    super()
    // 8192-sample ring buffer at 22050 Hz ≈ 372 ms window
    this._fftSize  = 8192
    this._hopSize  = 4096   // 50% overlap → new analysis every ~186 ms
    this._buf      = new Float32Array(this._fftSize)
    this._fill     = 0      // how many samples are currently in _buf
  }

  process(inputs) {
    const channel = inputs[0]?.[0]
    if (!channel || channel.length === 0) return true

    for (let i = 0; i < channel.length; i++) {
      this._buf[this._fill++] = channel[i]

      if (this._fill >= this._fftSize) {
        // Snapshot the window and transfer ownership to the main thread (zero-copy)
        const window = this._buf.slice(0, this._fftSize)
        this.port.postMessage({ type: 'audio', data: window }, [window.buffer])

        // Shift buffer left by hopSize (keep the second half as overlap)
        this._buf.copyWithin(0, this._hopSize)
        this._fill -= this._hopSize
      }
    }

    return true   // keep processor alive
  }
}

registerProcessor('dsp-processor', DspProcessor)
