// editor-wave.ts — Dibujo del WAVEFORM REAL del editor (#screen-editor).
//
// Toma el AudioBuffer decodificado (datos REALES, no rng como el demo del diseño)
// y pinta sobre el <canvas> de la onda: barras de picos por columna, la grilla de
// beats (downbeats acentuados con el color de la canción), la baseline, y — por
// HTML, encima del canvas — los overlays de descansos (rayado amarillo), el marker
// de inicio pendiente y los ticks del ruler. El playhead lo mueve editor.setPlayhead.
//
// Es PURO dibujo: no conoce el motor ni el estado. main.ts le pasa un WaveModel con
// la onda + grilla + descansos y le pide repintar. Estética portada del drawWave()
// del demo "Pulse Editor", pero con la onda decodificada de verdad.

import type { Rest } from "../core/rests";

/** Lo que main.ts necesita para dibujar la onda + grilla + overlays. */
export interface WaveModel {
  /** Picos por columna (0..1), ya reducidos del AudioBuffer. null = sin audio aún. */
  peaks: Float32Array | null;
  /** Duración real del audio en segundos (de currentBuffer.duration). */
  duration: number;
  /** BPM de la grilla (la grilla se dibuja sólo si bpm > 0 y synced). */
  bpm: number;
  /** Offset del beat 0 en segundos. */
  offset: number;
  /** ¿La canción está sincronizada (manual)? La grilla se acentúa con el color vivo. */
  synced: boolean;
  /** Acento de la canción (hex) para los downbeats + ruler. */
  accent: string;
  /** Descansos a dibujar como overlays sobre la onda. */
  rests: Rest[];
  /** Inicio pendiente de un descanso a medio marcar (en beats), o null. */
  pendingStartBeat: number | null;
  /** INICIO DEL JUEGO en segundos (las flechas arrancan acá). */
  gameStart: number;
  /** ¿Está fijado el inicio? Si no, no se dibuja el overlay/marcador. */
  gameStartSet: boolean;
  /** Anclas del sync por 2 marcas (segundos). null = todavía no marcada. Se dibujan
   *  como líneas cyan mientras dura el sync, para que el usuario VEA dónde palmeó. */
  anchor0: number | null;
  anchor1: number | null;
}

const BEATS_PER_BAR = 4;
const BAR_COLOR_PLAYED = "#5c5a62"; // barras (la onda real va toda en este tono)
const BAR_COLOR_DIM = "#2c2c33"; // barras antes del beat 0 (intro sin grilla)
const BASELINE = "#161620";
const GRID_DOWN_ALPHA = 0.3;
const GRID_BEAT_ALPHA = 0.16;
const GRID_BEAT_COLOR = "#3a3a42";

/**
 * Reduce un canal de AudioBuffer a `columns` picos (0..1). Cada columna es el pico
 * absoluto (max |sample|) de su tramo — barato y se ve nítido como el demo. Un solo
 * pase O(n). Devolvemos un Float32Array que después se escala al alto del canvas.
 */
export function computePeaks(channel: Float32Array, columns: number): Float32Array {
  const peaks = new Float32Array(columns);
  if (channel.length === 0 || columns <= 0) return peaks;
  const block = channel.length / columns;
  for (let c = 0; c < columns; c += 1) {
    const start = Math.floor(c * block);
    const end = Math.min(channel.length, Math.floor((c + 1) * block));
    let peak = 0;
    for (let i = start; i < end; i += 1) {
      const v = channel[i] < 0 ? -channel[i] : channel[i];
      if (v > peak) peak = v;
    }
    peaks[c] = peak;
  }
  return peaks;
}

/** Cuántas columnas de pico conviene para un ancho de canvas dado (como el demo: ~1 cada 3px). */
export function columnsForWidth(width: number): number {
  return Math.max(60, Math.floor(width / 3));
}

/** Segundos -> "m:ss" para los ticks del ruler. */
function clockShort(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * El pintor de la onda. Se le da el <canvas>, su contenedor (.ple-wave-box), la
 * capa de overlays (.ple-wave-overlays) y el ruler. Mantiene un ResizeObserver para
 * repintar cuando el contenedor cambia de tamaño (igual que el demo).
 */
export class EditorWave {
  private model: WaveModel | null = null;
  private ro: ResizeObserver | null = null;
  private roRaf = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly box: HTMLElement,
    private readonly overlays: HTMLElement,
    private readonly ruler: HTMLElement,
  ) {
    if (typeof ResizeObserver !== "undefined") {
      this.ro = new ResizeObserver(() => {
        cancelAnimationFrame(this.roRaf);
        this.roRaf = requestAnimationFrame(() => this.draw());
      });
      this.ro.observe(box);
    }
  }

  /** Carga un modelo nuevo (onda/grilla/descansos) y repinta todo. */
  setModel(model: WaveModel | null): void {
    this.model = model;
    this.draw();
  }

  /** Limpia la onda (sin pista seleccionada): canvas vacío + overlays/ruler vacíos. */
  clear(): void {
    this.model = null;
    const ctx = this.canvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.overlays.innerHTML = "";
    this.ruler.innerHTML = "";
  }

  /** Mapea segundos -> fracción 0..1 del ancho (para posicionar overlays). */
  fractionForSeconds(seconds: number): number {
    const dur = this.model?.duration ?? 0;
    if (dur <= 0) return 0;
    return Math.max(0, Math.min(1, seconds / dur));
  }

  /** Mapea una fracción 0..1 del ancho -> beat (usa bpm/offset/duración del modelo). */
  beatForFraction(fraction: number): number {
    const m = this.model;
    if (!m || m.bpm <= 0) return 0;
    const sec = Math.max(0, Math.min(1, fraction)) * m.duration;
    return Math.max(0, (sec - m.offset) / (60 / m.bpm));
  }

  /** Repinta canvas (onda + grilla + baseline) y reposiciona overlays + ruler. */
  draw(): void {
    const m = this.model;
    const W = this.box.clientWidth;
    const H = this.box.clientHeight;
    if (W === 0 || H === 0) return;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.floor(W * dpr);
    this.canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    if (!m || !m.peaks || m.duration <= 0) {
      this.overlays.innerHTML = "";
      this.ruler.innerHTML = "";
      return;
    }

    const mid = H * 0.52;
    const amp = H * 0.46;
    const beat0Frac = m.duration > 0 ? Math.max(0, m.offset) / m.duration : 0;

    // --- barras de la onda REAL ---
    const peaks = m.peaks;
    const N = peaks.length;
    for (let i = 0; i < N; i += 1) {
      const f = i / N;
      const h = Math.max(1, peaks[i] * amp);
      const x = f * W;
      // antes del beat 0 (intro) la onda va apagada; el resto en el tono vivo.
      ctx.fillStyle = m.synced && f < beat0Frac ? BAR_COLOR_DIM : BAR_COLOR_PLAYED;
      ctx.fillRect(x, mid - h, 2, h * 2);
    }

    // --- grilla de beats (sólo si hay tempo) ---
    if (m.bpm > 0) {
      const beatSec = 60 / m.bpm;
      let idx = 0;
      for (let t = m.offset; t < m.duration; t += beatSec) {
        if (t >= 0) {
          const x = (t / m.duration) * W;
          const down = idx % BEATS_PER_BAR === 0;
          ctx.strokeStyle = down ? m.accent : GRID_BEAT_COLOR;
          ctx.globalAlpha = down ? GRID_DOWN_ALPHA : GRID_BEAT_ALPHA;
          ctx.lineWidth = down ? 1.4 : 1;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, H);
          ctx.stroke();
        }
        idx += 1;
      }
      ctx.globalAlpha = 1;
    }

    // --- baseline ---
    ctx.strokeStyle = BASELINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(W, mid);
    ctx.stroke();

    this.drawOverlays(m);
    this.drawRuler(m);
  }

  /** Overlays HTML de descansos (rayado amarillo) + marker de inicio pendiente. */
  private drawOverlays(m: WaveModel): void {
    this.overlays.innerHTML = "";
    const beatSec = m.bpm > 0 ? 60 / m.bpm : 0;

    // --- INTRO · SIN JUEGO: zona apagada de 0 → gameStart (las flechas no arrancaron) ---
    if (m.gameStartSet) {
      const startFrac = this.fractionForSeconds(m.gameStart);
      if (startFrac > 0) {
        const intro = document.createElement("div");
        intro.className = "ple-wave-intro";
        intro.style.left = "0%";
        intro.style.width = `${startFrac * 100}%`;
        intro.innerHTML = `<span class="ple-wave-intro-label">INTRO · SIN JUEGO</span>`;
        this.overlays.appendChild(intro);
      }
      // --- ▶ INICIO JUEGO: línea rosa donde realmente arrancan las flechas ---
      const marker = document.createElement("div");
      marker.className = "ple-wave-gamestart";
      marker.style.left = `${startFrac * 100}%`;
      marker.innerHTML = `<span class="ple-wave-gamestart-label">▶ INICIO JUEGO</span>`;
      this.overlays.appendChild(marker);
    }

    for (const r of m.rests) {
      const startSec = m.offset + r.atBeat * beatSec;
      const endSec = startSec + r.durationBeats * beatSec;
      const left = this.fractionForSeconds(startSec) * 100;
      const width = Math.max(0.6, (this.fractionForSeconds(endSec) - this.fractionForSeconds(startSec)) * 100);
      const el = document.createElement("div");
      el.className = "ple-wave-rest";
      el.style.left = `${left}%`;
      el.style.width = `${width}%`;
      el.innerHTML = `<span class="ple-wave-rest-label">DESCANSO</span>`;
      this.overlays.appendChild(el);
    }

    if (m.pendingStartBeat !== null && m.bpm > 0) {
      const sec = m.offset + m.pendingStartBeat * beatSec;
      const left = this.fractionForSeconds(sec) * 100;
      const marker = document.createElement("div");
      marker.className = "ple-wave-pending";
      marker.style.left = `${left}%`;
      marker.innerHTML = `<span class="ple-wave-pending-label">INICIO</span>`;
      this.overlays.appendChild(marker);
    }

    // --- ANCLAS del sync por 2 marcas (cyan): se ven al palmear ESPACIO ---
    // anchor0 es la marca más temprana y anchor1 la lejana (main.ts las reordena),
    // así el "1" cae a la izquierda y el "2" a la derecha en la onda.
    const anchors: Array<{ sec: number; n: 1 | 2 }> = [];
    if (m.anchor0 !== null) anchors.push({ sec: m.anchor0, n: 1 });
    if (m.anchor1 !== null) anchors.push({ sec: m.anchor1, n: 2 });
    for (const a of anchors) {
      const marker = document.createElement("div");
      marker.className = "ple-wave-anchor";
      marker.style.left = `${this.fractionForSeconds(a.sec) * 100}%`;
      marker.innerHTML = `<span class="ple-wave-anchor-label">ANCLA ${a.n}</span>`;
      this.overlays.appendChild(marker);
    }
  }

  /** Ticks del ruler: una etiqueta de tiempo por cada compás (cada 4 beats), espaciados. */
  private drawRuler(m: WaveModel): void {
    this.ruler.innerHTML = "";
    if (m.duration <= 0) return;

    // Con tempo (auto o manual): ticks alineados a compás. Sin tempo: por tiempo.
    // Elegimos un paso en compases para no saturar (apuntamos a ~8-10 ticks).
    const beatSec = m.bpm > 0 ? 60 / m.bpm : 0;
    if (beatSec > 0) {
      const totalBars = Math.max(1, Math.floor((m.duration - Math.max(0, m.offset)) / (beatSec * BEATS_PER_BAR)));
      const step = Math.max(1, Math.ceil(totalBars / 9));
      for (let bar = 0; bar <= totalBars; bar += step) {
        const sec = m.offset + bar * BEATS_PER_BAR * beatSec;
        if (sec < 0 || sec > m.duration) continue;
        const leftPct = (sec / m.duration) * 100;
        if (leftPct > 97) continue; // no encimar el final
        this.appendTick(leftPct, clockShort(sec));
      }
    } else {
      // Sin tempo: ticks de tiempo cada ~1/8 de la canción.
      for (let k = 0; k <= 8; k += 1) {
        const sec = (k / 8) * m.duration;
        const leftPct = (sec / m.duration) * 100;
        if (leftPct > 97) continue;
        this.appendTick(leftPct, clockShort(sec));
      }
    }
    // Tick final con la duración total, anclado a la derecha.
    const end = document.createElement("span");
    end.className = "ple-ruler-tick ple-ruler-tick-end";
    end.textContent = clockShort(m.duration);
    this.ruler.appendChild(end);
  }

  private appendTick(leftPct: number, label: string): void {
    const tick = document.createElement("span");
    tick.className = "ple-ruler-tick";
    tick.style.left = `${leftPct}%`;
    tick.textContent = label;
    this.ruler.appendChild(tick);
  }

  /** Desconecta el ResizeObserver (no se usa hoy — el editor vive toda la sesión). */
  destroy(): void {
    this.ro?.disconnect();
    cancelAnimationFrame(this.roRaf);
  }
}
