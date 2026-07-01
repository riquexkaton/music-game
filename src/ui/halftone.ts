// halftone.ts — Fondo "console screen" de la skin Alt 2 (variante C · OVERLAY),
// portado FIEL de claude.ai/design "Pulse Game Alt 2" (drawHalftoneBg). En la variante
// C el WebGL del diseño sólo limpia a oscuro: el fondo REAL es este dot-matrix halftone
// 2D. Reactivo al audio REAL (getFreq) + beat (getBpm): grilla fina fija + matriz de
// puntos con ripple radial desde el centro + scanline que barre. Es lo que distingue a
// Alt 2 del hub clásico (que usa anillos de sonar). Mismo ciclo de vida que waves.ts.

export interface HalftoneApi {
  start(): void;
  stop(): void;
  setAccent(hex: string): void;
}

/** Parsea un hex (#rgb / #rrggbb) a [r,g,b]. Fallback al lima por defecto. */
function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = Number.parseInt(h, 16);
  if (h.length !== 6 || Number.isNaN(n)) return [200, 255, 30]; // --lime
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function createHalftone(
  canvas: HTMLCanvasElement,
  getFreq: () => Uint8Array | null,
  getBpm: () => number,
): HalftoneApi {
  const ctx = canvas.getContext("2d");
  let rgb: [number, number, number] = [200, 255, 30];
  let rafId = 0;
  let running = false;
  let cssW = 0;
  let cssH = 0;
  const t0 = performance.now();

  // Backing-store al CSS box * DPR (nítido), igual que waves.ts.
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

  function frame(now: number): void {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    if (!ctx) return;

    const w = cssW;
    const h = cssH;
    ctx.clearRect(0, 0, w, h);

    const bpm = getBpm();
    const beatMs = bpm > 0 ? 60000 / bpm : 60000 / 120;
    const ph = (now - t0) / beatMs;
    const beat = Math.pow(1 - (ph - Math.floor(ph)), 2.4);
    const t = (now - t0) / 1000;
    const freq = getFreq();
    const haveAudio = !!freq && freq.length > 0;
    const acc = rgb;
    const fillAcc = `rgb(${acc[0]},${acc[1]},${acc[2]})`;

    // grilla fina fija — estructura "pantalla de consola"
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.028)";
    ctx.lineWidth = 1;
    const gs = 46;
    ctx.beginPath();
    for (let x = gs; x < w; x += gs) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, h);
    }
    for (let y = gs; y < h; y += gs) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
    }
    ctx.stroke();

    // matriz de puntos halftone reactiva (banda de audio + beat + ripple radial).
    // `cell` = separación entre puntos: más grande = MENOS puntos (menos invasivo).
    const cell = 56;
    const r0 = cell * 0.3; // radio máx del punto, modesto respecto a la celda → más aire
    const colsN = Math.ceil(w / cell) + 1;
    const rowsN = Math.ceil(h / cell) + 1;
    const cx = w * 0.5;
    const cy = h * 0.52;
    const maxD = Math.hypot(cx, cy) || 1;
    ctx.fillStyle = fillAcc;
    for (let c = 0; c < colsN; c++) {
      let band = 0.18;
      if (haveAudio && freq) {
        const idx = Math.floor((c / colsN) * (freq.length * 0.7));
        band = (freq[idx] ?? 0) / 255;
      }
      for (let rr = 0; rr < rowsN; rr++) {
        const x = c * cell;
        const y = rr * cell;
        const d = Math.hypot(x - cx, y - cy) / maxD; // caída radial desde el centro
        const ripple = 0.5 + 0.5 * Math.sin(d * 9 - t * 3.2); // pulso que sale hacia afuera
        const energy = Math.min(1, band * 0.9 + beat * 0.5 * (1 - d) + ripple * 0.28);
        const rad = Math.max(0.4, energy * r0 * (0.85 + beat * 0.35));
        ctx.globalAlpha = 0.04 + energy * 0.22 * (1 - d * 0.55);
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, 6.2832);
        ctx.fill();
      }
    }

    // scanline que barre hacia abajo, latiendo con el beat
    const sy = ((t * 60) % (h + 80)) - 40;
    ctx.globalAlpha = 0.06 + beat * 0.1;
    ctx.fillStyle = fillAcc;
    ctx.fillRect(0, sy, w, 2);
    ctx.globalAlpha = 1;
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
