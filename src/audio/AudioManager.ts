export class AudioManager {
  private ctx: AudioContext | null = null;
  private engineOscillator: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private windNoise: AudioBufferSourceNode | null = null;

  constructor() {}

  public init() {
    if (this.ctx) return; // Already initialized
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();

    // 1. Engine Sound (Low saw wave)
    this.engineOscillator = this.ctx.createOscillator();
    this.engineOscillator.type = 'sawtooth';
    this.engineOscillator.frequency.value = 50; // Idle freq

    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0.1; // Base volume

    // Lowpass filter to muffle the raw saw wave
    const engineFilter = this.ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 200;

    this.engineOscillator.connect(engineFilter);
    engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.ctx.destination);
    
    this.engineOscillator.start();

    // 2. Wind/Horror Ambient Drone
    this.createWindNoise();
  }

  private createWindNoise() {
    if (!this.ctx) return;
    const bufferSize = this.ctx.sampleRate * 2; // 2 seconds of noise
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Generate brown noise for wind
    let lastOut = 0;
    for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        data[i] = (lastOut + (0.02 * white)) / 1.02;
        lastOut = data[i];
        data[i] *= 3.5; // Compensate for gain
    }

    this.windNoise = this.ctx.createBufferSource();
    this.windNoise.buffer = buffer;
    this.windNoise.loop = true;

    const windFilter = this.ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 400; // Eerie howl
    windFilter.Q.value = 1.0;

    const windGain = this.ctx.createGain();
    windGain.gain.value = 0.5;

    this.windNoise.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(this.ctx.destination);

    this.windNoise.start();

    // Slowly modulate the wind filter frequency for eerie effect
    setInterval(() => {
      if (this.ctx) {
        const newFreq = 200 + Math.random() * 600;
        windFilter.frequency.setTargetAtTime(newFreq, this.ctx.currentTime, 2.0);
      }
    }, 2000);
  }

  public updateEngine(speed: number) {
    if (!this.ctx || !this.engineOscillator || !this.engineGain) return;
    
    // Pitch up with speed
    const targetFreq = 50 + (Math.abs(speed) * 1.5);
    // Slight volume increase with speed
    const targetVolume = 0.1 + (Math.min(Math.abs(speed), 100) / 100) * 0.1;

    this.engineOscillator.frequency.setTargetAtTime(targetFreq, this.ctx.currentTime, 0.1);
    this.engineGain.gain.setTargetAtTime(targetVolume, this.ctx.currentTime, 0.1);
  }

  public stop() {
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
  }
}
