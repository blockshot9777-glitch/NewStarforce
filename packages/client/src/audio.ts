// Звук игры — целиком синтез WebAudio, без файлов (никаких сторонних ассетов и лицензий).
// Фон: низкий гул космоса; петли: двигатель в полёте и бур при добыче; события: выстрелы, попадания
// в щит и корпус, взрывы, тревоги и хорошие новости из журнала, гиперпрыжок, щелчки кнопок.
// Громкость и панорама — от положения события относительно камеры. M — без звука (запоминается).
import type { Fx, LogEntry } from '@starforce/shared';

/** Громкость (0..1) и панорама (−1..1) звука в точке (dx, dy) от камеры; z — масштаб камеры. */
export function spatial(dx: number, dy: number, z: number): { gain: number; pan: number } {
  // В пикселях экрана: что на экране — слышно хорошо, за его пределами быстро затихает.
  const sx = dx * z;
  const sy = dy * z;
  const d = Math.hypot(sx, sy);
  const gain = 1 / (1 + (d / 700) ** 2);
  const pan = Math.max(-1, Math.min(1, sx / 900));
  return { gain, pan };
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfx: GainNode | null = null;
let noise: AudioBuffer | null = null;
let muted = false;
try {
  muted = localStorage.getItem('starforce.mute') === '1';
} catch {
  /* приватный режим — просто без запоминания */
}
const lastPlay = new Map<string, number>();
/** Сколько раз прозвучал каждый вид звука и пиковый уровень на выходе — для проверки в браузере. */
export const audioStats: { plays: Record<string, number>; peak: number } = { plays: {}, peak: 0 };
let analyser: AnalyserNode | null = null;

/** Включить звук по первому жесту игрока (браузеры не дают играть звук без него). */
export function initAudio(): void {
  const start = () => {
    if (ctx) {
      void ctx.resume();
      return;
    }
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.7;
    // Мягкий лимитер, чтобы залп взрывов не хрипел.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    master.connect(comp).connect(ctx.destination);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    comp.connect(analyser);
    (window as unknown as { __sfAudio: typeof audioStats }).__sfAudio = audioStats;
    sfx = ctx.createGain();
    sfx.connect(master);
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    startAmbient();
  };
  window.addEventListener('pointerdown', start);
  window.addEventListener('keydown', start);
  // Щелчок кнопок интерфейса.
  document.addEventListener('click', (e) => {
    if ((e.target as HTMLElement | null)?.closest('button')) click();
  });
}

export function toggleMute(): boolean {
  muted = !muted;
  try {
    localStorage.setItem('starforce.mute', muted ? '1' : '0');
  } catch {
    /* без запоминания */
  }
  if (ctx && master) master.gain.setTargetAtTime(muted ? 0 : 0.7, ctx.currentTime, 0.05);
  return muted;
}

export function isMuted(): boolean {
  return muted;
}

/** Не чаще раза в minMs для одного вида звука — залп из 20 попаданий не превращается в шум. */
function allow(kind: string, minMs: number): boolean {
  const now = performance.now();
  if (now - (lastPlay.get(kind) ?? -1e9) < minMs) return false;
  lastPlay.set(kind, now);
  audioStats.plays[kind] = (audioStats.plays[kind] ?? 0) + 1;
  return true;
}

/** Вход в цепочку: панорама → громкость → общая шина эффектов. */
function out(gain: number, pan: number): GainNode | null {
  if (!ctx || !sfx) return null;
  const g = ctx.createGain();
  g.gain.value = gain;
  const p = ctx.createStereoPanner();
  p.pan.value = pan;
  g.connect(p).connect(sfx);
  return g;
}

function env(g: AudioParam, t0: number, peak: number, attack: number, decay: number): void {
  g.setValueAtTime(0.0001, t0);
  g.exponentialRampToValueAtTime(peak, t0 + attack);
  g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
}

function noiseBurst(dest: AudioNode, t0: number, dur: number, f0: number, f1: number, peak: number, type: BiquadFilterType = 'lowpass'): void {
  if (!ctx || !noise) return;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(f0, t0);
  f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  const g = ctx.createGain();
  env(g.gain, t0, peak, 0.005, dur);
  src.connect(f).connect(g).connect(dest);
  src.start(t0, Math.random() * 1.5, dur + 0.05);
}

function tone(dest: AudioNode, t0: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number, attack = 0.004): void {
  if (!ctx) return;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  const g = ctx.createGain();
  env(g.gain, t0, peak, attack, dur);
  o.connect(g).connect(dest);
  o.start(t0);
  o.stop(t0 + attack + dur + 0.05);
}

/** Звук игрового эффекта в мировых координатах; cam — центр камеры, z — её масштаб. */
export function playFx(fx: Fx, cam: { x: number; y: number }, z: number): void {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime + 0.01;
  const x = 'x' in fx ? fx.x : fx.x1;
  const y = 'y' in fx ? fx.y : fx.y1;
  const { gain, pan } = spatial(x - cam.x, y - cam.y, z);
  if (gain < 0.03) return;
  switch (fx.k) {
    case 'laser': {
      if (!allow(fx.hostile ? 'laser-h' : 'laser', 70)) return;
      const o = out(gain * 0.5, pan);
      if (!o) return;
      // «Пью»: пила с быстрым падением тона и шипение.
      tone(o, t0, 'sawtooth', fx.hostile ? 1100 : 1600, fx.hostile ? 180 : 260, 0.16, 0.22);
      noiseBurst(o, t0, 0.08, 6000, 2000, 0.12, 'highpass');
      break;
    }
    case 'hit': {
      if (!allow(fx.shield ? 'hit-s' : 'hit', 60)) return;
      const o = out(gain * 0.6, pan);
      if (!o) return;
      if (fx.shield) {
        // Щит: звенящий «вжух» с биением.
        tone(o, t0, 'sine', 900, 600, 0.35, 0.18);
        tone(o, t0, 'sine', 1355, 900, 0.3, 0.1);
      } else {
        // Корпус: глухой удар и треск металла.
        tone(o, t0, 'sine', 140, 50, 0.25, 0.5);
        noiseBurst(o, t0, 0.18, 2400, 300, 0.35);
      }
      break;
    }
    case 'boom': {
      if (!allow('boom', 90)) return;
      const big = Math.min(1, fx.r / 30);
      const o = out(gain * (0.6 + 0.4 * big), pan);
      if (!o) return;
      noiseBurst(o, t0, 0.9 + big * 0.9, 1800, 60, 0.7);
      tone(o, t0, 'sine', 70, 28, 0.8 + big, 0.7, 0.01);
      noiseBurst(o, t0 + 0.05, 0.4, 5000, 800, 0.15, 'bandpass');
      break;
    }
    case 'mine':
      break;
  }
}

/** Тревога и хорошие новости из журнала. */
export function playLog(e: LogEntry): void {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime + 0.02;
  const o = out(0.35, 0);
  if (!o) return;
  if (e.level === 'bad' && allow('alarm', 1500)) {
    tone(o, t0, 'square', 660, 640, 0.14, 0.12);
    tone(o, t0 + 0.18, 'square', 440, 430, 0.18, 0.12);
  } else if (e.level === 'good' && allow('good', 400)) {
    tone(o, t0, 'sine', 880, 880, 0.25, 0.1);
    tone(o, t0 + 0.08, 'sine', 1320, 1320, 0.3, 0.08);
  }
}

function click(): void {
  if (!ctx || muted || !allow('click', 40)) return;
  const o = out(0.25, 0);
  if (!o) return;
  tone(o, ctx.currentTime, 'triangle', 2400, 1200, 0.03, 0.15, 0.001);
}

/** Прыжок: нарастающий вой зарядки (start) и удар выхода в новой системе (arrive). */
export function playJump(kind: 'start' | 'arrive'): void {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime + 0.02;
  const o = out(0.5, 0);
  if (!o) return;
  if (kind === 'start') {
    tone(o, t0, 'sawtooth', 60, 900, 7.5, 0.08, 6.5);
    noiseBurst(o, t0, 7.5, 200, 4000, 0.06, 'bandpass');
  } else {
    noiseBurst(o, t0, 1.6, 6000, 80, 0.6);
    tone(o, t0, 'sine', 90, 30, 1.4, 0.7, 0.01);
  }
}

// ---------- Фон и петли ----------

let engineGain: GainNode | null = null;
let mineGain: GainNode | null = null;

function startAmbient(): void {
  if (!ctx || !master || !noise) return;
  // Гул космоса: две расстроенные низкие синусоиды и тихий «ветер» из фильтрованного шума.
  const amb = ctx.createGain();
  amb.gain.value = 0.06;
  amb.connect(master);
  for (const f of [43, 43.7, 65.2]) {
    const o = ctx.createOscillator();
    o.frequency.value = f;
    o.connect(amb);
    o.start();
  }
  const wind = ctx.createBufferSource();
  wind.buffer = noise;
  wind.loop = true;
  const wf = ctx.createBiquadFilter();
  wf.type = 'lowpass';
  wf.frequency.value = 380;
  const wg = ctx.createGain();
  wg.gain.value = 0.25;
  wind.connect(wf).connect(wg).connect(amb);
  wind.start();
  // Двигатель: шум сквозь низкий фильтр + низкий тон; громкость задаёт updateLoops.
  engineGain = ctx.createGain();
  engineGain.gain.value = 0;
  engineGain.connect(master);
  const en = ctx.createBufferSource();
  en.buffer = noise;
  en.loop = true;
  const ef = ctx.createBiquadFilter();
  ef.type = 'lowpass';
  ef.frequency.value = 220;
  en.connect(ef).connect(engineGain);
  en.start();
  const eo = ctx.createOscillator();
  eo.type = 'triangle';
  eo.frequency.value = 55;
  const eog = ctx.createGain();
  eog.gain.value = 0.35;
  eo.connect(eog).connect(engineGain);
  eo.start();
  // Бур: жужжание пилы с дрожанием.
  mineGain = ctx.createGain();
  mineGain.gain.value = 0;
  mineGain.connect(master);
  const mo = ctx.createOscillator();
  mo.type = 'sawtooth';
  mo.frequency.value = 118;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 9;
  const lfoG = ctx.createGain();
  lfoG.gain.value = 6;
  lfo.connect(lfoG).connect(mo.frequency);
  const mf = ctx.createBiquadFilter();
  mf.type = 'bandpass';
  mf.frequency.value = 900;
  mf.Q.value = 1.5;
  mo.connect(mf).connect(mineGain);
  mo.start();
  lfo.start();
}

/** Раз в кадр: насколько громко гудят двигатель (0..1 — доля скорости) и бур. */
export function updateLoops(engine: number, mining: boolean): void {
  if (!ctx || !engineGain || !mineGain) return;
  if (analyser) {
    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    let pk = 0;
    for (const v of buf) pk = Math.max(pk, Math.abs(v));
    audioStats.peak = Math.max(audioStats.peak * 0.98, pk);
  }
  const t = ctx.currentTime;
  engineGain.gain.setTargetAtTime(muted ? 0 : 0.05 + 0.25 * Math.max(0, Math.min(1, engine)), t, 0.3);
  mineGain.gain.setTargetAtTime(muted || !mining ? 0 : 0.07, t, 0.15);
}
