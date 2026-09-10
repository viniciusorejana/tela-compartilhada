import createRNNoise from '/vendor/rnnoise-sync.js';

// RNNoise 0.2: mono, 48 kHz, frames of 480 samples (10 ms).
// Each processor owns its state. No allocations or messages in the audio render loop.
class NoiseReducer extends AudioWorkletProcessor {
  constructor() {
    super();
    if (sampleRate !== 48000) throw new Error('RNNoise requires 48 kHz');
    this.wasm = createRNNoise();
    this.state = this.wasm._rnnoise_create(0);
    this.pointer = this.wasm._malloc(480 * 4);
    if (!this.state || !this.pointer) throw new Error('RNNoise allocation failed');
    this.frame = new Float32Array(this.wasm.HEAPF32.buffer, this.pointer, 480);
    this.queue = new Float32Array(960);
    this.read = 0;
    this.write = 480;
    this.position = 0;
    this.enabled = true;
    this.stopped = false;
    this.port.onmessage = ({ data }) => {
      if (data === 'stop' && !this.stopped) {
        this.wasm._rnnoise_destroy(this.state);
        this.wasm._free(this.pointer);
        this.stopped = true;
      } else if (typeof data?.enabled === 'boolean') {
        if (!data.enabled && this.enabled) {
          this.queue.fill(0);
          this.position = 0;
          this.read = 0;
          this.write = 480;
        }
        this.enabled = data.enabled;
      }
    };
  }
  process(inputs, outputs) {
    if (this.stopped) return false;
    const input = inputs[0]?.[0];
    const output = outputs[0][0];
    if (!this.enabled) { output.fill(0); return true; }
    for (let i = 0; i < output.length; i++) {
      this.frame[this.position++] = (input?.[i] || 0) * 32768;
      if (this.position === 480) {
        this.wasm._rnnoise_process_frame(this.state, this.pointer, this.pointer);
        for (let j = 0; j < 480; j++) {
          this.queue[this.write] = this.frame[j] / 32768;
          this.write = (this.write + 1) % 960;
        }
        this.position = 0;
      }
      output[i] = this.queue[this.read];
      this.read = (this.read + 1) % 960;
    }
    return true;
  }
}
registerProcessor('nexo-noise', NoiseReducer);
