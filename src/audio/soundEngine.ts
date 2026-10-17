// Procedural Web Audio API Synthesizer for Apex GT Racing
// Zero external MP3/WAV dependencies

class SoundEngine {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private isRunning: boolean = false;

  // Continuous engine oscillators
  private engineOsc1: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;

  // Continuous drift tire screech nodes
  private driftGain: GainNode | null = null;
  private driftFilter: BiquadFilterNode | null = null;

  // Continuous nitro turbine tone
  private nitroOsc: OscillatorNode | null = null;
  private nitroGain: GainNode | null = null;

  public init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return;
    }

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();

    // Master engine chain
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 320;
    this.engineFilter.Q.value = 3.5;

    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0.0;

    this.engineOsc1 = this.ctx.createOscillator();
    this.engineOsc1.type = 'sawtooth';
    this.engineOsc1.frequency.value = 55;

    this.engineOsc2 = this.ctx.createOscillator();
    this.engineOsc2.type = 'triangle';
    this.engineOsc2.frequency.value = 110;

    this.engineOsc1.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.ctx.destination);

    this.engineOsc1.start();
    this.engineOsc2.start();

    // Nitro turbine oscillator
    this.nitroOsc = this.ctx.createOscillator();
    this.nitroOsc.type = 'sine';
    this.nitroOsc.frequency.value = 220;
    this.nitroGain = this.ctx.createGain();
    this.nitroGain.gain.value = 0.0;
    this.nitroOsc.connect(this.nitroGain);
    this.nitroGain.connect(this.ctx.destination);
    this.nitroOsc.start();

    // Drift noise generator
    const bufferSize = this.ctx.sampleRate * 1.5;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;

    this.driftFilter = this.ctx.createBiquadFilter();
    this.driftFilter.type = 'bandpass';
    this.driftFilter.frequency.value = 1350;
    this.driftFilter.Q.value = 6.0;

    this.driftGain = this.ctx.createGain();
    this.driftGain.gain.value = 0.0;

    whiteNoise.connect(this.driftFilter);
    this.driftFilter.connect(this.driftGain);
    this.driftGain.connect(this.ctx.destination);
    whiteNoise.start();

    this.isRunning = true;
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (muted && this.ctx) {
      this.silenceContinuous();
    }
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  public silenceContinuous(): void {
    if (!this.ctx || !this.isRunning) return;
    const now = this.ctx.currentTime;
    this.engineGain?.gain.setTargetAtTime(0, now, 0.05);
    this.nitroGain?.gain.setTargetAtTime(0, now, 0.05);
    this.driftGain?.gain.setTargetAtTime(0, now, 0.05);
  }

  public updateTelemetryAudio(
    rpm: number,
    speedRatio: number,
    isBoosting: boolean,
    isDrifting: boolean,
    isPlaying: boolean
  ): void {
    if (!this.ctx || !this.isRunning) return;
    if (this.isMuted || !isPlaying) {
      this.silenceContinuous();
      return;
    }

    const now = this.ctx.currentTime;
    const normalizedRpm = Math.max(0, Math.min(1, (rpm - 1000) / 8000));

    // Fundamental V10/V8 harmonic frequencies
    const baseFreq = 42 + normalizedRpm * 135 + (isBoosting ? 28 : 0);
    this.engineOsc1?.frequency.setTargetAtTime(baseFreq, now, 0.03);
    this.engineOsc2?.frequency.setTargetAtTime(baseFreq * 1.5, now, 0.03);
    this.engineFilter?.frequency.setTargetAtTime(240 + normalizedRpm * 950, now, 0.04);

    const targetEngineVol = 0.045 + normalizedRpm * 0.055;
    this.engineGain?.gain.setTargetAtTime(targetEngineVol, now, 0.04);

    // Nitro turbine whine
    const targetNitroVol = isBoosting ? 0.06 : 0.0;
    const targetNitroFreq = isBoosting ? 360 + speedRatio * 340 : 200;
    this.nitroOsc?.frequency.setTargetAtTime(targetNitroFreq, now, 0.05);
    this.nitroGain?.gain.setTargetAtTime(targetNitroVol, now, 0.05);

    // Drift tire squeal
    const targetDriftVol = isDrifting && speedRatio > 0.25 ? 0.045 : 0.0;
    this.driftFilter?.frequency.setTargetAtTime(1150 + speedRatio * 450, now, 0.05);
    this.driftGain?.gain.setTargetAtTime(targetDriftVol, now, 0.04);
  }

  public playNearMiss(combo: number): void {
    if (this.isMuted || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    const basePitch = 520 + Math.min(combo, 8) * 65;
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(basePitch, now);
    osc.frequency.exponentialRampToValueAtTime(basePitch * 1.45, now + 0.16);

    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.19);
  }

  public playBoostPad(): void {
    if (this.isMuted || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(280, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.24);

    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.27);
  }

  public playCollision(intensity: number = 1): void {
    if (this.isMuted || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(130 * intensity, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + 0.22);

    gain.gain.setValueAtTime(Math.min(0.22, 0.14 * intensity), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  public playCheckpoint(isFinalVictory: boolean = false): void {
    if (this.isMuted || !this.ctx) return;
    const now = this.ctx.currentTime;
    const notes = isFinalVictory ? [523.25, 659.25, 783.99, 1046.5] : [440, 554.37, 659.25];

    notes.forEach((freq, idx) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const startTime = now + idx * 0.075;

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.09, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.28);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + 0.29);
    });
  }
}

export const soundEngine = new SoundEngine();
