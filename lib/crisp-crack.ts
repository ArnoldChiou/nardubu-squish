/** Short, dry fracture clusters. Pure PCM synthesis also permits offline tests. */
export function synthesizeCrack(sampleRate: number, strength: number, seed: number) {
  if (!Number.isFinite(sampleRate) || sampleRate < 16000 || sampleRate > 192000)
    throw new RangeError('Unsupported sample rate');
  const power = Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : 0.5;
  const samples = new Float32Array(Math.ceil(sampleRate * 0.145));
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const count = 7 + Math.floor(power * 4);
  for (let pulse = 0; pulse < count; pulse++) {
    const start = pulse === 0 ? 0 : 0.010 + (pulse - 1) * 0.010 + random() * 0.005;
    const duration = pulse === 0 ? 0.033 : 0.009 + random() * 0.013;
    const decay = pulse === 0 ? 0.0065 : 0.002 + random() * 0.0025;
    const amplitude = (pulse === 0 ? 0.72 : 0.30 + random() * 0.20) * (1 - pulse / (count * 1.6));
    const frequency = 2500 + random() * 2100;
    const highpass = Math.exp(-2 * Math.PI * (1600 + random() * 900) / sampleRate);
    const lowpass = 1 - Math.exp(-2 * Math.PI * Math.min(8200, sampleRate * 0.40) / sampleRate);
    let low = 0, hp = 0, previous = 0;
    const offset = Math.floor(start * sampleRate);
    for (let i = 0; i < duration * sampleRate && offset + i < samples.length; i++) {
      const t = i / sampleRate;
      const white = random() * 2 - 1;
      hp = highpass * (hp + white - previous);
      previous = white;
      low += lowpass * (hp - low);
      const attack = Math.min(1, t / 0.0006);
      const tail = Math.min(1, Math.max(0, (duration - t) / 0.003));
      const envelope = attack * Math.exp(-t / decay) * tail;
      // A tiny, heavily damped woody tick gives a crack rather than just a hiss.
      const tick = Math.sin(2 * Math.PI * frequency * t) * Math.exp(-t / 0.0018) * 0.16;
      samples[offset + i] += amplitude * (low * envelope + tick * attack * tail);
    }
  }
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  const gain = (0.48 + power * 0.28) / Math.max(peak, 0.001);
  for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  return samples;
}
