const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('real RNNoise worklet attenuates deterministic noise with bounded buffering and CPU cost', async t => {
  const vendor = fs.readFileSync(path.join(__dirname, '../node_modules/@jitsi/rnnoise-wasm/dist/rnnoise-sync.js'), 'utf8');
  const { default: createRNNoise } = await import('data:text/javascript;base64,' + Buffer.from(vendor).toString('base64'));
  let Processor;
  const source = fs.readFileSync(path.join(__dirname, '../public/noise-worklet.js'), 'utf8').replace(/^import .+;\r?\n/, '');
  vm.runInNewContext(source, {
    createRNNoise, sampleRate: 48000, Float32Array,
    AudioWorkletProcessor: class { constructor() { this.port = {}; } },
    registerProcessor: (_name, value) => { Processor = value; }
  });
  const reducer = new Processor();
  const input = new Float32Array(128), output = new Float32Array(128);
  let seed = 71, before = 0, after = 0;
  const start = performance.now();
  for (let block = 0; block < 1875; block++) {
    for (let i = 0; i < input.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      input[i] = (seed / 0xffffffff - 0.5) * 0.06;
    }
    assert.equal(reducer.process([[input]], [[output]]), true);
    if (block > 375) {
      for (let i = 0; i < input.length; i++) { before += input[i] ** 2; after += output[i] ** 2; }
    }
    assert.ok(output.every(Number.isFinite));
  }
  const elapsed = performance.now() - start;
  const reduction = 10 * Math.log10(before / after);
  t.diagnostic(`5 s of audio processed in ${elapsed.toFixed(0)} ms; white-noise attenuation ${reduction.toFixed(1)} dB (synthetic noise, not a speech quality score)`);
  assert.ok(reduction > 10, 'noise should be reduced by at least 10 dB');
  assert.ok(elapsed < 5000, 'processing must stay faster than realtime on the test machine');
  reducer.port.onmessage({ data: { enabled: false } });
  reducer.process([[input]], [[output]]);
  assert.ok(output.every(x => x === 0));
  reducer.port.onmessage({ data: 'stop' });
  assert.equal(reducer.process([[input]], [[output]]), false);
});

test('worklet adapts 128-sample renders to 480-sample frames with exactly 10 ms buffering', () => {
  let Processor;
  const memory = new Float32Array(481);
  const source = fs.readFileSync(path.join(__dirname, '../public/noise-worklet.js'), 'utf8').replace(/^import .+;\r?\n/, '');
  vm.runInNewContext(source, {
    sampleRate: 48000, Float32Array,
    createRNNoise: () => ({ HEAPF32: memory, _rnnoise_create: () => 1, _malloc: () => 4, _rnnoise_process_frame() {} }),
    AudioWorkletProcessor: class { constructor() { this.port = {}; } },
    registerProcessor: (_name, value) => { Processor = value; }
  });
  const reducer = new Processor();
  const samples = [];
  for (let block = 0; block < 30; block++) {
    const input = Float32Array.from({ length: 128 }, (_, i) => (block * 128 + i + 1) / 8192);
    const output = new Float32Array(128);
    reducer.process([[input]], [[output]]);
    samples.push(...output);
  }
  for (let i = 0; i < samples.length; i++) assert.equal(samples[i], i < 480 ? 0 : (i - 480 + 1) / 8192);
});
