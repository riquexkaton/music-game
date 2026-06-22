// waves.ts — Visualizador de ondas (sonar rings) reactivo al audio REAL.
//
// Contrato (blueprint §3, §9): 7 anillos concéntricos en CADA esquina inferior
// (inset ~8px), reactivos al espectro real (getFreq) + pulso por beat (getBpm).
// El canvas hace overflow:hidden del game column → se ven cuartos de círculo
// en las esquinas. start/stop manejan el loop de rAF; setAccent recolorea.
//
// Algoritmo portado fiel del diseño (blueprint §9):
//   level     = promedio de getFreq()/255 (0 si no hay audio)
//   beatPulse = pow(1 - frac(now / (60000/bpm)), 2.4)
//   drive     = min(1, level*1.7 + beatPulse*0.5 + 0.16)
//   maxR 320, spacing = maxR/7, drift = (t*26)%spacing, beatR = beatPulse*24
//   por anillo i: r = i*spacing + drift + beatR; saltar si r<5 || r>maxR
//     fade = 1 - r/maxR; alpha = fade*(0.4 + drive*0.6); lineWidth = 1.4 + fade*2.2
//   punto central acento r = 5 + beatPulse*3

const RING_COUNT = 7;
const MAX_R = 320;
const SPACING = MAX_R / RING_COUNT;
const INSET = 8;
const TAU = Math.PI * 2;

export interface WavesApi {
  start(): void;
  stop(): void;
  setAccent(hex: string): void;
}

/** Parsea un hex (#rgb / #rrggbb) a [r,g,b]. Fallback al lima por defecto. */
function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  const n = Number.parseInt(h, 16);
  if (h.length !== 6 || Number.isNaN(n)) return [200, 255, 30]; // --lime
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function createWaves(
  canvas: HTMLCanvasElement,
  getFreq: () => Uint8Array | null,
  getBpm: () => number,
): WavesApi {
  const ctx = canvas.getContext("2d");
  let rgb: [number, number, number] = [200, 255, 30];
  let rafId = 0;
  let running = false;
  let cssW = 0;
  let cssH = 0;
  const t0 = performance.now();

  // Ajusta el tamaño del backing-store al CSS box * devicePixelRatio (nítido).
  function resize(): void {
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    const rect = canvas.getBoundingClientRect();
    cssW = rect.width;
    cssH = rect.height;
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const ro =
    typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => resize()) : null;

  /** Nivel medio del espectro real (0..1). 0 si no hay datos de audio. */
  function readLevel(): number {
    const freq = getFreq();
    if (!freq || freq.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < freq.length; i++) sum += freq[i];
    return sum / freq.length / 255;
  }

  // Dibuja los 7 anillos de un cuadrante en (cx, cy) con drive/beat dados.
  function drawCorner(
    c: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    drift: number,
    beatR: number,
    beatPulse: number,
    drive: number,
  ): void {
    for (let i = 0; i < RING_COUNT; i++) {
      const r = i * SPACING + drift + beatR;
      if (r < 5 || r > MAX_R) continue;
      const fade = 1 - r / MAX_R;
      c.beginPath();
      c.arc(cx, cy, r, 0, TAU);
      c.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${fade * (0.4 + drive * 0.6)})`;
      c.lineWidth = 1.4 + fade * 2.2;
      c.stroke();
    }
    // Punto central del sonar.
    const dotR = 5 + beatPulse * 3;
    c.beginPath();
    c.arc(cx, cy, dotR, 0, TAU);
    c.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.5 + drive * 0.4})`;
    c.fill();
  }

  function frame(now: number): void {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    if (!ctx) return;

    const t = (now - t0) / 1000;
    const level = readLevel();

    const bpm = getBpm();
    const beatMs = bpm > 0 ? 60000 / bpm : 0;
    const frac = beatMs > 0 ? (now / beatMs) % 1 : 0;
    const beatPulse = Math.pow(1 - frac, 2.4);
    const drive = Math.min(1, level * 1.7 + beatPulse * 0.5 + 0.16);

    const drift = (t * 26) % SPACING;
    const beatR = beatPulse * 24;

    ctx.clearRect(0, 0, cssW, cssH);

    // Dos esquinas inferiores → cuartos de círculo por el overflow:hidden.
    drawCorner(ctx, INSET, cssH - INSET, drift, beatR, beatPulse, drive);
    drawCorner(ctx, cssW - INSET, cssH - INSET, drift, beatR, beatPulse, drive);
  }

  function start(): void {
    if (running) return;
    running = true;
    resize();
    if (ro) ro.observe(canvas);
    rafId = requestAnimationFrame(frame);
  }

  function stop(): void {
    if (!running) return;
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    if (ro) ro.disconnect();
    if (ctx) ctx.clearRect(0, 0, cssW, cssH);
  }

  function setAccent(hex: string): void {
    rgb = hexToRgb(hex);
  }

  return { start, stop, setAccent };
}
