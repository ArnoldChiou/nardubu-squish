import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const moduleUrl = (name, replace = (s) => s) => {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return `data:text/javascript;base64,${Buffer.from(replace(js)).toString('base64')}`;
};
const synthUrl = moduleUrl('crisp-crack');
const { synthesizeCrack } = await import(synthUrl);
const { fracturePose } = await import(moduleUrl('fracture'));
for (const seed of [0, 0.25, 0.75, 1]) {
  let previous = fracturePose(0, seed);
  assert.deepEqual(previous, { stage: 0, opening: 0, splitting: 0 });
  for (let i = 1; i <= 1000; i++) {
    const pose = fracturePose(i / 1000, seed);
    for (const key of ['stage', 'opening', 'splitting'])
      assert(pose[key] >= previous[key], 'fracture may not heal as damage accumulates');
    assert(pose.opening <= 1 && pose.splitting <= 1);
    previous = pose;
  }
  assert.equal(previous.stage, 5);
  assert(fracturePose(0.12, seed).splitting >= 0.4, 'deep damage must visibly subdivide plates');
}
let worstLowRatio = 0, worstPeak = 0;
for (const rate of [16000, 44100, 48000, 96000]) {
  for (const strength of [0.2, 0.6, 1]) for (const seed of [7, 42, 123456]) {
    const samples = synthesizeCrack(rate, strength, seed);
    assert.equal(samples.length, Math.ceil(rate * 0.145));
    assert(samples.every(Number.isFinite));
    let peak = 0, energy = 0, lowEnergy = 0, low = 0, sum = 0;
    const k = 1 - Math.exp(-2 * Math.PI * 900 / rate);
    for (const sample of samples) {
      peak = Math.max(peak, Math.abs(sample));
      energy += sample * sample;
      low += k * (sample - low);
      lowEnergy += low * low;
      sum += sample;
    }
    worstLowRatio = Math.max(worstLowRatio, lowEnergy / energy);
    worstPeak = Math.max(worstPeak, peak);
    assert(peak <= 0.761 && peak >= 0.5, 'controlled headroom, not a volume-only boost');
    assert(lowEnergy / energy < 0.25, 'crisp transient should not be dominated by low rumble');
    assert(Math.abs(sum / samples.length) < 0.003, 'no significant DC offset');
    assert(samples.slice(-Math.floor(rate * 0.015)).every((v) => v === 0), 'short clean tail');
  }
}
assert.deepEqual(synthesizeCrack(48000, 0.8, 4), synthesizeCrack(48000, 0.8, 4));
assert.notDeepEqual(synthesizeCrack(48000, 0.8, 4), synthesizeCrack(48000, 0.8, 5));
const mix = new Float32Array(48000);
for (let i = 0; i < 8; i++) {
  const samples = synthesizeCrack(48000, 1, i);
  const offset = Math.round(48000 * i * 0.085);
  for (let j = 0; j < samples.length; j++) mix[offset + j] += samples[j] * 0.48;
}
assert(mix.every((v) => Math.abs(v) < 0.8), 'rapid cracks retain headroom even before compression');

// Exercise audio gesture/mute/throttle/lifecycle wiring without claiming an audition.
class Param {
  value = 0;
  setTargetAtTime(v) { this.value = v; }
  setValueAtTime(v) { this.value = v; }
  exponentialRampToValueAtTime(v) { this.value = v; }
}
class Node {
  gain = new Param(); frequency = new Param(); Q = new Param();
  threshold = new Param(); ratio = new Param(); knee = new Param();
  attack = new Param(); release = new Param(); disconnected = false;
  connect(next) { this.connected = next; return next; }
  disconnect() { this.disconnected = true; }
}
let contexts = 0, ctx;
class FakeContext {
  currentTime = 1; sampleRate = 48000; destination = new Node(); sources = []; gains = []; closed = false;
  constructor() { contexts++; ctx = this; }
  createGain() { const node = new Node(); this.gains.push(node); return node; }
  createDynamicsCompressor() { return new Node(); }
  createBiquadFilter() { return new Node(); }
  createBuffer(channels, size) { const data = new Float32Array(size); return { getChannelData: () => data }; }
  createBufferSource() {
    const node = new Node();
    node.start = () => { node.started = true; };
    this.sources.push(node);
    return node;
  }
  resume() { return Promise.resolve(); }
  close() { this.closed = true; return Promise.resolve(); }
}
globalThis.AudioContext = FakeContext;
const { CrunchAudio } = await import(moduleUrl('crunch-audio', (js) => js.replace("'./crisp-crack'", `'${synthUrl}'`)));
const audio = new CrunchAudio();
audio.crack(1);
assert.equal(contexts, 0, 'no audio context before a user gesture');
audio.unlock();
audio.crack(0.7);
assert.equal(ctx.sources.length, 1);
assert(ctx.sources[0].started);
assert.equal(ctx.sources[0].connected.gain.value, 0.24, 'crisper timbre, not an excessive playback-level jump');
audio.crack(1);
assert.equal(ctx.sources.length, 1, 'rate limit overlapping clusters');
audio.setEnabled(false);
assert.equal(ctx.gains[0].gain.value, 0, 'mute fades already-playing sound too');
ctx.currentTime += 1;
audio.crack(1); audio.friction(1); audio.release();
assert.equal(ctx.sources.length, 1, 'all paths honor mute');
audio.setEnabled(true);
audio.crack(1);
ctx.sources[1].onended();
assert(ctx.sources[1].disconnected);
assert(ctx.sources[1].connected.disconnected);
audio.dispose();
assert(ctx.closed);
console.log(`PASS: 5 irreversible fracture stages; 36 synthesized clusters; peak ${worstPeak.toFixed(3)}, low-band energy ratio <= ${worstLowRatio.toFixed(3)}; overlap headroom, gesture unlock, mute and cleanup.`);
