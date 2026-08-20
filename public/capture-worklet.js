/**
 * capture-worklet.js — AudioWorklet for capturing mic input.
 * Replaces the deprecated ScriptProcessorNode.
 * 
 * Captures audio in chunks and sends it to the main thread.
 * 
 * Load via: audioContext.audioWorklet.addModule('/capture-worklet.js')
 */
class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    // Default to 4096 if not provided
    this.bufferSize = options.processorOptions?.bufferSize || 4096;
    this.buffer = new Float32Array(this.bufferSize);
    this.index = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    
    const channel = input[0];
    
    for (let i = 0; i < channel.length; i++) {
      this.buffer[this.index++] = channel[i];
      if (this.index >= this.bufferSize) {
        // Send a copy to the main thread
        const chunk = this.buffer.slice(0);
        this.port.postMessage({ audio: chunk }, [chunk.buffer]);
        this.index = 0;
      }
    }
    
    return true; // Keep alive
  }
}

registerProcessor('capture-processor', CaptureProcessor);
