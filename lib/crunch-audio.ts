/** Gesture-unlocked procedural gel friction and irregular fracture transients. */
export class CrunchAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastFriction = 0;
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
    crunchy: boolean,
  ) {
    const ctx = this.context;
    if (!ctx || !this.master || !this.noise) return;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = crunchy ? 'bandpass' : 'lowpass';
    filter.frequency.setValueAtTime(frequency, at);
    filter.frequency.exponentialRampToValueAtTime(
      frequency * 0.42,
      at + duration,
    );
    filter.Q.value = crunchy ? 0.7 : 1.4;
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
      0.16,
      400 + speed * 180,
      Math.min(0.18, 0.035 + speed * 0.07),
      false,
    );
  }

  crack(strength: number) {
    if (!this.enabled || !this.context) return;
    const now = this.context.currentTime;
    for (let i = 0; i < 6; i++) {
      this.burst(
        now + i * 0.017 + Math.random() * 0.015,
        0.014 + Math.random() * 0.05,
        1100 + Math.random() * 3400,
        (0.06 + strength * 0.14) * (1 - i / 9),
        true,
      );
    }
    this.burst(now, 0.13, 300, 0.17, false);
  }

  release() {
    if (!this.enabled || !this.context) return;
    this.burst(this.context.currentTime, 0.22, 560, 0.09, false);
  }

  dispose() {
    void this.context?.close();
  }
}
