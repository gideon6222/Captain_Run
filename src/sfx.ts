/* Audio, fully synthesised. No binaries reach this repo.

   Everything is one Web Audio graph built on the first real gesture: a master
   gain into a compressor, a music bus, a feedback delay for the horn, and one
   noise buffer reused by every percussive sound. Music and effects share the
   bus so the compressor ducks them together.

   The music is a slow 8-note theme on a horn with a 0.3s attack, over a tom
   heartbeat and a three-oscillator drone. The attack is the whole trick: a
   short attack on a synthesised note is a beep, and beeps were the one thing
   Gideon named as bad in the Coreward playtest. It drops an octave in the boss
   phase - same theme, same tempo, so it reads as the same music getting
   heavier rather than as a different track starting. */

export interface SfxHooks {
  /* Read live, not passed once: the boss phase starts mid-run. */
  isBossPhase: () => boolean;
}

export interface Sfx {
  init(): void;
  throwAxe(): void;
  hit(): void;
  smash(): void;
  kill(): void;
  ping(): void;
  gate(good: boolean): void;
  forge(): void;
  hurt(): void;
  horn(): void;
  boom(): void;
}

export function createSfx(hooks: SfxHooks): Sfx {
  let ac: AudioContext | null = null;
  let master: GainNode | null = null;
  let musicGain: GainNode | null = null;
  let noiseBuf: AudioBuffer | null = null;
  let delay: DelayNode | null = null;
  let step = 0, nextTime = 0, lastPing = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  const THEME = [0, 3, 5, 7, 5, 3, 0, -2];   // D minor-ish, 8 slow notes

  function init() {
    /* Called on every gesture, not just the first. A context created before a
       user gesture starts suspended, and a suspended context plays nothing
       while reporting no error at all. */
    if (ac) { if (ac.state === 'suspended') ac.resume().catch(() => {}); return; }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain(); master.gain.value = 0.6;
    const comp = ac.createDynamicsCompressor();
    master.connect(comp); comp.connect(ac.destination);
    musicGain = ac.createGain(); musicGain.gain.value = 0.34; musicGain.connect(master);
    delay = ac.createDelay(1.0); delay.delayTime.value = 0.34;
    const fb = ac.createGain(); fb.gain.value = 0.3;
    delay.connect(fb); fb.connect(delay); delay.connect(musicGain);
    const len = ac.sampleRate * 1.2;
    noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // drone bed
    for (const [f, det] of [[73.4, 0], [110, 4], [146.8, -5]]) {
      const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
      const g = ac.createGain(); g.gain.value = 0.055;
      o.connect(lp); lp.connect(g); g.connect(musicGain); o.start();
    }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    nextTime = ac.currentTime + 0.1;
    /* Scheduled ahead on a timer rather than from the frame loop: audio timing
       must not follow the renderer, or a dropped frame becomes an audible
       stutter. */
    timer = setInterval(sched, 120);
  }

  function tone(freq: number, dur: number, type?: OscillatorType, vol = 0.1, atk?: number, dest?: AudioNode) {
    if (!ac || !master) return;
    const o = ac.createOscillator(); o.type = type || 'sine'; o.frequency.value = freq;
    const g = ac.createGain();
    const t = ac.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + (atk || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || master);
    o.start(t); o.stop(t + dur + 0.02);
    return o;
  }

  function noise(dur: number, freq: number, q: number, vol: number, type?: BiquadFilterType) {
    if (!ac || !master || !noiseBuf) return;
    const s = ac.createBufferSource(); s.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = type || 'bandpass'; f.frequency.value = freq; f.Q.value = q || 1;
    const g = ac.createGain();
    const t = ac.currentTime;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t); s.stop(t + dur + 0.02);
  }

  function sched() {
    if (!ac) return;
    const beat = 60 / 116 / 2;   // eighth notes
    while (nextTime < ac.currentTime + 0.3) {
      const s = step % 16;
      const t = nextTime;
      // drum: tom heartbeat
      if (s === 0 || s === 6 || s === 10) drum(t, s === 0 ? 62 : 88, 0.28);
      if (s === 4 || s === 12) drum(t, 150, 0.14);
      // horn theme, one note every 2 beats
      if (s % 4 === 0) {
        const idx = Math.floor(step / 4) % 8;
        const semi = THEME[idx] + (hooks.isBossPhase() ? -12 : 0);
        const f = 146.83 * Math.pow(2, semi / 12);
        horn(t, f);
      }
      nextTime += beat; step++;
    }
  }

  function drum(t: number, f: number, vol: number) {
    if (!ac || !musicGain) return;
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f * 2.2, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.09);
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g); g.connect(musicGain);
    o.start(t); o.stop(t + 0.36);
  }

  function horn(t: number, f: number) {
    if (!ac || !musicGain || !delay) return;
    const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const o2 = ac.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = f * 1.005;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.linearRampToValueAtTime(1100, t + 0.5);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.075, t + 0.3);       // slow attack: never a beep
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(musicGain); g.connect(delay);
    o.start(t); o2.start(t); o.stop(t + 1.6); o2.stop(t + 1.6);
  }

  return {
    init,
    throwAxe() { noise(0.09, 2600 + Math.random() * 900, 2, 0.05, 'highpass'); },
    hit() { tone(180 + Math.random() * 120, 0.09, 'square', 0.06); },
    smash() { noise(0.24, 700 + Math.random() * 400, 1.2, 0.2, 'bandpass'); },
    kill() { noise(0.34, 320, 0.9, 0.25); tone(90, 0.3, 'sawtooth', 0.1); },
    ping() {
      /* Loot lands in bursts of fourteen. Without this gate they arrive inside
         a millisecond of each other and sum into one loud click. */
      if (!ac) return;
      const now = ac.currentTime;
      if (now - lastPing < 0.055) return;
      lastPing = now;
      tone(880 * (0.85 + Math.random() * 0.5), 0.08, 'triangle', 0.045);
    },
    gate(good: boolean) {
      if (good) { tone(523, 0.14, 'triangle', 0.11); setTimeout(() => tone(784, 0.2, 'triangle', 0.1), 80); }
      else { tone(200, 0.3, 'sawtooth', 0.11); }
    },
    forge() {
      noise(0.3, 900, 1, 0.22);
      setTimeout(() => { tone(392, 0.5, 'triangle', 0.13, 0.01); tone(587, 0.5, 'triangle', 0.1, 0.01); }, 60);
    },
    hurt() { tone(160, 0.34, 'sawtooth', 0.14, 0.005); },
    horn() { if (!ac) return; horn(ac.currentTime, 98); },
    boom() { noise(0.7, 180, 0.7, 0.34, 'lowpass'); tone(60, 0.8, 'sine', 0.2); },
  };
}
