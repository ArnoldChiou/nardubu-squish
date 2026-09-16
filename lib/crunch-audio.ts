import { synthesizeCrack } from './crisp-crack';

/** Gesture-unlocked gel friction and short, bright fracture clusters. */
export class CrunchAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastFriction = 0;
  private lastCrack = -Infinity;
  enabled = true;

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (this.master && this.context)
      this.master.gain.setTargetAtTime(
        enabled ? 0.48 : 0,
        this.context.currentTime,
        0.01,
      );
  }

  unlock() {
    if (!this.enabled) return;
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0.48;
      const limiter = this.context.createDynamicsCompressor();
      limiter.threshold.value = -14;
      limiter.ratio.value = 10;
      limiter.knee.value = 8;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.07;
      this.master.connect(limiter).connect(this.context.destination);
      this.noise = this.context.createBuffer(
        1,
        this.context.sampleRate,
        this.context.sampleRate,
      );
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    void this.context.resume().catch(() => undefined);
  }

  private burst(
    at: number,
    duration: number,
    frequency: number,
    amplitude: number,
  ) {
    const ctx = this.context;
    if (!ctx || !this.master || !this.noise) return;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(frequency, at);
    filter.frequency.exponentialRampToValueAtTime(
      frequency * 0.42,
      at + duration,
    );
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(amplitude, at + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(at, Math.random() * 0.5, duration);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }

  friction(speed: number) {
    if (!this.enabled || !this.context || speed < 0.05) return;
    const now = this.context.currentTime;
    if (now - this.lastFriction < 0.09) return;
    this.lastFriction = now;
    this.burst(
      now,
      0.065,
      Math.min(1100, 500 + speed * 140),
      Math.min(0.055, 0.014 + speed * 0.025),
    );
  }

  crack(strength: number) {
    const ctx = this.context;
    if (!this.enabled || !ctx || !this.master) return;
    const now = ctx.currentTime;
    if (now - this.lastCrack < 0.075) return;
    this.lastCrack = now;
    const data = synthesizeCrack(ctx.sampleRate, strength, Math.floor(Math.random() * 0xffffffff));
    const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buffer.getChannelData(0).set(data);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const level = ctx.createGain();
    level.gain.value = 0.24;
    source.connect(level).connect(this.master);
    source.onended = () => { source.disconnect(); level.disconnect(); };
    source.start(now);
  }

  release() {
    if (!this.enabled || !this.context) return;
    this.burst(this.context.currentTime, 0.055, 740, 0.025);
  }

  dispose() {
    void this.context?.close();
  }
}
