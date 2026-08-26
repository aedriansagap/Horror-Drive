export class AudioManager {
  private ctx: AudioContext | null = null;

  // Master & Bus Gains
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private radioGain: GainNode | null = null;

  // Engine Audio
  private osc1: OscillatorNode | null = null;
  private osc2: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;

  // Wind / Speed Rush
  private windSource: AudioBufferSourceNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;

  // Tire Squeal
  private tireNoise: AudioBufferSourceNode | null = null;
  private tireGain: GainNode | null = null;

  // Radio System
  public radioStation = 0; // 0 = Off, 1 = EAS / Drone, 2 = Spooky Synth, 3 = Numbers Station
  private radioOsc: OscillatorNode | null = null;
  private radioInterval: any = null;

  public isInitialized = false;

  constructor() {}

  public init() {
    if (this.isInitialized) return;
    try {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();

      // Master Gain
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.85;
      this.masterGain.connect(this.ctx.destination);

      // SFX Bus
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.75;
      this.sfxGain.connect(this.masterGain);

      // Radio Bus
      this.radioGain = this.ctx.createGain();
      this.radioGain.gain.value = 0.45;
      this.radioGain.connect(this.masterGain);

      // 1. Setup Engine Synthesizer
      this.setupEngine();

      // 2. Setup Wind Rush
      this.setupWind();

      // 3. Setup Tire Skid
      this.setupTireSkid();

      this.isInitialized = true;
    } catch (e) {
      console.warn('AudioContext init failed or blocked by autoplay:', e);
    }
  }

  private setupEngine() {
    if (!this.ctx || !this.sfxGain) return;

    // Dual oscillator engine sound
    this.osc1 = this.ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc1.frequency.value = 45; // Idle rumble

    this.osc2 = this.ctx.createOscillator();
    this.osc2.type = 'triangle';
    this.osc2.frequency.value = 22.5; // Sub-harmonic

    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 180;
    this.engineFilter.Q.value = 2.0;

    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0.22;

    this.osc1.connect(this.engineFilter);
    this.osc2.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.sfxGain);

    this.osc1.start();
    this.osc2.start();
  }

  private setupWind() {
    if (!this.ctx || !this.sfxGain) return;

    const bufferSize = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    let last = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      data[i] = (last + 0.02 * white) / 1.02;
      last = data[i];
      data[i] *= 3.0;
    }

    this.windSource = this.ctx.createBufferSource();
    this.windSource.buffer = buffer;
    this.windSource.loop = true;

    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 320;
    this.windFilter.Q.value = 1.2;

    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0.04;

    this.windSource.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.sfxGain);

    this.windSource.start();
  }

  private setupTireSkid() {
    if (!this.ctx || !this.sfxGain) return;

    const bufferSize = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    this.tireNoise = this.ctx.createBufferSource();
    this.tireNoise.buffer = buffer;
    this.tireNoise.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1100;
    filter.Q.value = 4.0;

    this.tireGain = this.ctx.createGain();
    this.tireGain.gain.value = 0;

    this.tireNoise.connect(filter);
    filter.connect(this.tireGain);
    this.tireGain.connect(this.sfxGain);

    this.tireNoise.start();
  }

    public updateEngine(speed: number, isBraking: boolean = false, isHandbraking: boolean = false, isTurningHard: boolean = false) {
    if (!this.ctx || !this.osc1 || !this.osc2 || !this.engineFilter || !this.engineGain) return;

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    const safeSpeed = Number.isFinite(speed) ? Math.abs(speed) : 0;
    const targetPitch = Math.max(25, Math.min(500, 45 + (safeSpeed * 1.6)));
    const targetFilterFreq = Math.max(100, Math.min(4000, 180 + (safeSpeed * 6.5)));
    const targetVolume = Math.max(0, Math.min(1, 0.18 + Math.min(safeSpeed / 100, 1) * 0.18));

    try {
      const t = this.ctx.currentTime;
      this.osc1.frequency.setTargetAtTime(targetPitch, t, 0.06);
      this.osc2.frequency.setTargetAtTime(targetPitch * 0.5, t, 0.06);
      this.engineFilter.frequency.setTargetAtTime(targetFilterFreq, t, 0.08);
      this.engineGain.gain.setTargetAtTime(targetVolume, t, 0.08);

      if (this.windGain && this.windFilter) {
        const windVol = Math.max(0, Math.min(1, 0.04 + Math.min(safeSpeed / 120, 1) * 0.28));
        const windFreq = Math.max(100, Math.min(3000, 320 + safeSpeed * 4.0));
        this.windGain.gain.setTargetAtTime(windVol, t, 0.1);
        this.windFilter.frequency.setTargetAtTime(windFreq, t, 0.1);
      }

      if (this.tireGain) {
        const isSkidding = (isHandbraking && safeSpeed > 10) || (isBraking && safeSpeed > 35) || (isTurningHard && safeSpeed > 55);
        const targetTireVol = isSkidding ? 0.35 : 0;
        this.tireGain.gain.setTargetAtTime(targetTireVol, t, 0.05);
      }
    } catch (_) {
      this.osc1.frequency.value = targetPitch;
      this.osc2.frequency.value = targetPitch * 0.5;
      this.engineFilter.frequency.value = targetFilterFreq;
      this.engineGain.gain.value = targetVolume;
    }
  }

  // --- Horror Radio System ('R' Key) ---
  public cycleRadio(): number {
    this.radioStation = (this.radioStation + 1) % 4;
    this.playClick();
    this.applyRadioStation();
    return this.radioStation;
  }

  private applyRadioStation() {
    if (!this.ctx || !this.radioGain) return;

    // Clean up existing radio osc
    if (this.radioInterval) {
      clearInterval(this.radioInterval);
      this.radioInterval = null;
    }
    if (this.radioOsc) {
      try { this.radioOsc.stop(); } catch (_) {}
      this.radioOsc.disconnect();
      this.radioOsc = null;
    }

    if (this.radioStation === 0) {
      // OFF
      return;
    }

    if (this.radioStation === 1) {
      // Station 1: EAS / Emergency Alert Drone (Dual frequency 853Hz + 960Hz pulse)
      this.radioOsc = this.ctx.createOscillator();
      this.radioOsc.type = 'sine';
      this.radioOsc.frequency.value = 853;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 900;

      const gain = this.ctx.createGain();
      gain.gain.value = 0.15;

      this.radioOsc.connect(filter);
      filter.connect(gain);
      gain.connect(this.radioGain);
      this.radioOsc.start();

      let toggle = false;
      this.radioInterval = setInterval(() => {
        if (!this.ctx || !this.radioOsc) return;
        toggle = !toggle;
        this.radioOsc.frequency.setValueAtTime(toggle ? 960 : 853, this.ctx.currentTime);
      }, 500);

    } else if (this.radioStation === 2) {
      // Station 2: Spooky Ambient Dark Synth Minor Arpeggio
      const notes = [130.81, 155.56, 174.61, 196.0, 233.08]; // C minor pentatonic
      this.radioOsc = this.ctx.createOscillator();
      this.radioOsc.type = 'sawtooth';
      this.radioOsc.frequency.value = notes[0];

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 450;
      filter.Q.value = 3.0;

      const gain = this.ctx.createGain();
      gain.gain.value = 0.18;

      this.radioOsc.connect(filter);
      filter.connect(gain);
      gain.connect(this.radioGain);
      this.radioOsc.start();

      let idx = 0;
      this.radioInterval = setInterval(() => {
        if (!this.ctx || !this.radioOsc) return;
        idx = (idx + 1) % notes.length;
        this.radioOsc.frequency.setTargetAtTime(notes[idx], this.ctx.currentTime, 0.08);
      }, 700);

    } else if (this.radioStation === 3) {
      // Station 3: Numbers Station / Morse & Cosmic Static
      this.radioOsc = this.ctx.createOscillator();
      this.radioOsc.type = 'sine';
      this.radioOsc.frequency.value = 1000;

      const gain = this.ctx.createGain();
      gain.gain.value = 0;

      this.radioOsc.connect(gain);
      gain.connect(this.radioGain);
      this.radioOsc.start();

      this.radioInterval = setInterval(() => {
        if (!this.ctx || !this.radioOsc) return;
        const now = this.ctx.currentTime;
        const isBeep = Math.random() < 0.45;
        gain.gain.setValueAtTime(isBeep ? 0.16 : 0, now);
        if (isBeep) {
          this.radioOsc.frequency.setValueAtTime(700 + Math.floor(Math.random() * 5) * 150, now);
        }
      }, 200);
    }
  }

  // --- Sound Effects ---

  public playHorn() {
    if (!this.ctx || !this.sfxGain) return;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc1.frequency.value = 420;
    osc2.frequency.value = 510;
    osc1.type = 'sawtooth';
    osc2.type = 'sawtooth';

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1400;

    gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.5);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);

    osc1.start();
    osc2.start();
    osc1.stop(this.ctx.currentTime + 0.5);
    osc2.stop(this.ctx.currentTime + 0.5);
  }

  public playScreech() {
    if (!this.ctx || !this.sfxGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(900, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(280, this.ctx.currentTime + 0.8);

    filter.type = 'bandpass';
    filter.frequency.value = 800;
    filter.Q.value = 5.0;

    gain.gain.setValueAtTime(0.4, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.8);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.8);
  }

  public playThump() {
    if (!this.ctx || !this.sfxGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(30, this.ctx.currentTime + 0.35);

    gain.gain.setValueAtTime(0.7, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.35);

    osc.connect(gain);
    gain.connect(this.sfxGain);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.35);
  }

  public playStaticGlitch() {
    if (!this.ctx || !this.sfxGain) return;
    const bufferSize = this.ctx.sampleRate * 0.4;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1800;

    const gain = this.ctx.createGain();
    gain.gain.value = 0.25;

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);

    src.start();
  }

  public playTruckHorn() {
    if (!this.ctx || !this.sfxGain) return;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc1.frequency.value = 185;
    osc2.frequency.value = 220;
    osc1.type = 'sawtooth';
    osc2.type = 'sawtooth';

    gain.gain.setValueAtTime(0.5, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 1.2);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.sfxGain);

    osc1.start();
    osc2.start();
    osc1.stop(this.ctx.currentTime + 1.2);
    osc2.stop(this.ctx.currentTime + 1.2);
  }

  public playThunder() {
    if (!this.ctx || !this.sfxGain) return;
    const bufferSize = this.ctx.sampleRate * 2.5;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    let last = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      data[i] = (last + 0.05 * white) / 1.05;
      last = data[i];
      data[i] *= 4.0;
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(350, this.ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(60, this.ctx.currentTime + 2.5);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.8, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 2.5);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);

    src.start();
  }

  public playClick() {
    if (!this.ctx || !this.sfxGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.frequency.value = 1200;
    gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.04);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.04);
  }

  public stop() {
    if (this.radioInterval) {
      clearInterval(this.radioInterval);
      this.radioInterval = null;
    }
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
      this.isInitialized = false;
    }
  }
}
