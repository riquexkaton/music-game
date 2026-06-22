// game.ts — Vista de juego (pantalla #screen-play, estética Pulse, brutalist).
//
// Construye TODO el DOM del layout de gameplay (blueprint §6) por JS, instancia
// los módulos character/waves/fx por sus interfaces (§3) y expone funciones de
// render que el MOTOR (main.ts) llama. NO conoce el motor: recibe hooks (mute,
// salir) y datos por las funciones de render. La fuente de verdad sigue siendo
// el conductor real; esto es sólo PIEL.

import { createCharacter, type CharacterApi } from "./character";
import { createWaves, type WavesApi } from "./waves";
import { createFx, type FxApi } from "./fx";
import { TIMING_WINDOWS, type Grade } from "../core/judge";

// --- Geometría de la barra de timing (DEBE coincidir con el MOTOR) ---
//
// El playhead recorre `APPROACH_BEATS + AFTER_BEATS` beats de 0% a 100% (ver
// renderTimingPlay en main.ts). El COMMIT (instante que el motor juzga PERFECT)
// cae cuando conductor.beat === commitBeat, es decir a APPROACH/(APPROACH+AFTER)
// del recorrido. Las zonas y la línea perfect se dibujan a partir de ESE punto y
// de las ventanas reales de judge.ts — NO de porcentajes decorativos. Así lo que
// el jugador ve es exactamente lo que el motor juzga.
const APPROACH_BEATS = 4;
const AFTER_BEATS = 1;
const TIMING_SPAN_BEATS = APPROACH_BEATS + AFTER_BEATS; // 5
/** % del recorrido del playhead donde está el commit (perfect del motor). */
const COMMIT_PCT = (APPROACH_BEATS / TIMING_SPAN_BEATS) * 100; // 80
/** Un beat = este % del recorrido (100 / span). */
const PCT_PER_BEAT = 100 / TIMING_SPAN_BEATS; // 20

const windowOf = (grade: Grade): number =>
  TIMING_WINDOWS.find((w) => w.grade === grade)?.window ?? 0;

/**
 * Convierte las ventanas (en segundos) del motor a la geometría de la barra
 * para un BPM dado. Devuelve left/width en % para las zonas good y perfect.
 * `halfBeats = window_sec * bpm / 60`; `halfPct = halfBeats * PCT_PER_BEAT`.
 */
function timingGeometry(bpm: number): {
  good: { left: number; width: number };
  perf: { left: number; width: number };
} {
  const secToHalfPct = (sec: number): number => ((sec * bpm) / 60) * PCT_PER_BEAT;
  const goodHalf = secToHalfPct(windowOf("good"));
  const perfHalf = secToHalfPct(windowOf("perfect"));
  return {
    good: { left: COMMIT_PCT - goodHalf, width: goodHalf * 2 },
    perf: { left: COMMIT_PCT - perfHalf, width: perfHalf * 2 },
  };
}

// Colores de judgment (fijos, NO cambian por canción) — blueprint §4.
const JUDG_COLORS: Record<"PERFECT" | "GOOD" | "MISS", string> = {
  PERFECT: "#25E0FF",
  GOOD: "#C8FF1E",
  MISS: "#FF2E9A",
};
const JUDG_SUB: Record<"PERFECT" | "GOOD" | "MISS", string> = {
  PERFECT: "¡EN EL PUNTO!",
  GOOD: "BIEN",
  MISS: "FALLASTE",
};

const ARROW_GLYPHS = ["←", "↑", "→", "↓"];

/** Estado visual de cada keycap de la secuencia. */
export type ArrowCellState = "done" | "current" | "pending";

/** Cómo se ve el cabezal/zonas de la barra de timing. */
export type TimingPhase = "load" | "confirm";

/** Datos de la song bar al arrancar una canción. */
export interface GameSongInfo {
  title: string;
  bpm: number;
  difficulty: string;
  accent: string;
}

/** Hooks que el motor (main.ts) enchufa a los controles de la vista. */
export interface GameHooks {
  /** El usuario tocó MUTE; recibe el nuevo estado deseado. Devuelve el estado real aplicado. */
  onToggleMute: () => boolean;
  /** El usuario tocó ESC · SALIR. */
  onExit: () => void;
  /** Espectro de frecuencias del audio real (para waves.ts). */
  getFreq: () => Uint8Array | null;
  /** BPM actual (para el pulso por beat de waves.ts). */
  getBpm: () => number;
}

/** API pública que main.ts usa para pintar la vista durante el juego. */
export interface GameApi {
  /** Configura la song bar + acento de la canción (al arrancar play()). */
  setSong(info: GameSongInfo): void;
  /** Pinta la secuencia de flechas. `null` = sin barra activa (limpia). */
  renderSequence(states: ArrowCellState[] | null, glyphs: string[]): void;
  /**
   * Mueve el playhead (progress 0..1) y setea la fase de la barra de timing.
   * `phase` tiñe las zonas/label; `null` deja la barra en reposo.
   */
  renderTiming(progress: number, phase: TimingPhase | null): void;
  /** Muestra un judgment con stamp + dispara FX. `null` = volver a 'PREPARADO'. */
  showJudgment(judg: "PERFECT" | "GOOD" | "MISS" | null): void;
  /** Expresión del personaje (idle/hit/miss). */
  setExpression(e: "idle" | "hit" | "miss"): void;
  /** HUD: score, combo y best. */
  setScore(score: number): void;
  setCombo(combo: number): void;
  setBest(best: number): void;
  /** Barra de progreso de la canción (0..1). */
  setProgress(progress: number): void;
  /** Estado del botón mute (refleja el real del conductor). */
  setMuted(muted: boolean): void;
  /** Arranca/para los visualizadores reactivos (waves). */
  start(): void;
  stop(): void;
}

export function createGame(root: HTMLElement, hooks: GameHooks): GameApi {
  let accent = "#c8ff1e";

  // ---------------- DOM (blueprint §6) ----------------
  root.innerHTML = `
    <div class="pl-songbar" id="plg-songbar">
      <div class="pl-songbar-accent" id="plg-accent"></div>
      <div class="pl-songbar-cell pl-songbar-title" id="plg-title">—</div>
      <div class="pl-songbar-cell pl-songbar-bpm">
        <span class="pl-songbar-bpm-num" id="plg-bpm">—</span><span class="pl-songbar-bpm-unit">BPM</span>
      </div>
      <div class="pl-songbar-cell pl-songbar-diff" id="plg-diff">—</div>
      <div class="pl-grow"></div>
      <button class="pl-songbar-btn" id="plg-mute">MUTE</button>
      <button class="pl-songbar-btn pl-songbar-exit" id="plg-exit">ESC · SALIR</button>
    </div>

    <div class="pl-progress"><div class="pl-progress-fill" id="plg-progress"></div></div>

    <div class="pl-field" id="plg-field">
      <div class="pl-flash" id="plg-flash"></div>
      <canvas class="pl-fx-canvas" id="plg-fx"></canvas>

      <div class="pl-char-panel" id="plg-char-panel">
        <div class="pl-char-glow" id="plg-char-glow"></div>
        <div class="pl-char-scanlines"></div>
        <div class="pl-char-label"><span class="pl-char-chip" id="plg-char-chip"></span><span>VOCALISTA</span></div>
        <div class="pl-char-stack" id="plg-char-stack"></div>
        <div class="pl-char-expr" id="plg-char-expr">EN RITMO</div>
      </div>

      <div class="pl-gamecol">
        <canvas class="pl-wave-canvas" id="plg-wave"></canvas>
        <div class="pl-gamecol-inner">
          <div class="pl-hud">
            <div class="pl-hud-stat">
              <div class="pl-hud-label">MEJOR</div>
              <div class="pl-hud-best" id="plg-best">0<span class="pl-hud-x">x</span></div>
            </div>
            <div class="pl-hud-stat pl-hud-right">
              <div class="pl-hud-label">COMBO</div>
              <div class="pl-hud-combo" id="plg-combo">0<span class="pl-hud-x">x</span></div>
            </div>
          </div>

          <div class="pl-center">
            <div class="pl-judg" id="plg-judg">
              <div class="pl-judg-idle" id="plg-judg-idle">PREPARADO</div>
            </div>
            <div class="pl-arrows-row" id="plg-arrows"></div>
            <div class="pl-timing" id="plg-timing">
              <div class="pl-timing-good" id="plg-timing-good"></div>
              <div class="pl-timing-perf" id="plg-timing-perf"></div>
              <div class="pl-timing-line" id="plg-timing-line"></div>
              <div class="pl-timing-head" id="plg-timing-head"></div>
            </div>
            <div class="pl-phase" id="plg-phase">CARGÁ LA SECUENCIA</div>
            <div class="pl-scorebox">
              <div class="pl-hud-label">SCORE</div>
              <div class="pl-score" id="plg-score">0</div>
            </div>
          </div>

          <div class="pl-game-hint">
            CARGÁ <span class="pl-kbd">←</span><span class="pl-kbd">↑</span><span class="pl-kbd">→</span><span class="pl-kbd">↓</span>
            Y CONFIRMÁ CON <span class="pl-kbd pl-kbd-space">ESPACIO</span>
          </div>
        </div>
      </div>
    </div>`;

  const $ = (id: string): HTMLElement => root.querySelector(`#${id}`) as HTMLElement;
  const accentEl = $("plg-accent");
  const titleEl = $("plg-title");
  const bpmEl = $("plg-bpm");
  const diffEl = $("plg-diff");
  const muteBtn = $("plg-mute") as HTMLButtonElement;
  const exitBtn = $("plg-exit") as HTMLButtonElement;
  const progressEl = $("plg-progress");
  const fieldEl = $("plg-field");
  const flashEl = $("plg-flash");
  const fxCanvas = $("plg-fx") as HTMLCanvasElement;
  const waveCanvas = $("plg-wave") as HTMLCanvasElement;
  const charPanel = $("plg-char-panel");
  const charGlow = $("plg-char-glow");
  const charChip = $("plg-char-chip");
  const charStack = $("plg-char-stack");
  const charExpr = $("plg-char-expr");
  const bestEl = $("plg-best");
  const comboEl = $("plg-combo");
  const judgEl = $("plg-judg");
  const judgIdleEl = $("plg-judg-idle");
  const arrowsEl = $("plg-arrows");
  const timingEl = $("plg-timing");
  const timingGood = $("plg-timing-good");
  const timingPerf = $("plg-timing-perf");
  const timingLine = $("plg-timing-line");
  const timingHead = $("plg-timing-head");
  const phaseEl = $("plg-phase");
  const scoreEl = $("plg-score");

  // ---------------- módulos (instanciados por sus interfaces, §3) ----------------
  const character: CharacterApi = createCharacter(charStack);
  const waves: WavesApi = createWaves(waveCanvas, hooks.getFreq, hooks.getBpm);
  const fx: FxApi = createFx(fxCanvas, flashEl, fieldEl);

  // ---------------- acento por canción ----------------
  function applyAccent(hex: string): void {
    accent = hex;
    root.style.setProperty("--accent", hex);
    accentEl.style.background = hex;
    bpmEl.style.color = hex;
    comboEl.style.color = hex;
    charChip.style.background = hex;
    charGlow.style.background = `radial-gradient(80% 60% at 50% 34%, ${hex}38 0%, transparent 62%)`;
    character.setAccent(hex);
    waves.setAccent(hex);
  }

  // ---------------- controles ----------------
  muteBtn.addEventListener("click", () => {
    const muted = hooks.onToggleMute();
    setMuted(muted);
  });
  exitBtn.addEventListener("click", () => hooks.onExit());

  function setMuted(muted: boolean): void {
    muteBtn.textContent = muted ? "MUTEADO" : "MUTE";
    muteBtn.classList.toggle("muted", muted);
  }

  // ---------------- render: secuencia de flechas ----------------
  function renderSequence(states: ArrowCellState[] | null, glyphs: string[]): void {
    arrowsEl.innerHTML = "";
    if (!states) return;
    states.forEach((state, i) => {
      const cell = document.createElement("div");
      cell.className = `pl-keycap pl-keycap-${state}`;
      cell.textContent = glyphs[i] ?? ARROW_GLYPHS[i] ?? "?";
      arrowsEl.appendChild(cell);
    });
  }

  // ---------------- render: barra de timing ----------------
  function renderTiming(progress: number, phase: TimingPhase | null): void {
    const clamped = Math.max(0, Math.min(1, progress));
    // El CENTRO del cabezal (no su borde) marca el instante: así coincide con la
    // línea perfect y las zonas, que están centradas en su % objetivo.
    timingHead.style.left = `${clamped * 100}%`;
    timingHead.style.transform = "translateX(-50%)";
    timingEl.classList.toggle("active", phase !== null);
    if (phase === "confirm") {
      phaseEl.textContent = "¡CONFIRMÁ EN LA ZONA!";
      phaseEl.classList.add("confirm");
    } else {
      phaseEl.textContent = "CARGÁ LA SECUENCIA";
      phaseEl.classList.remove("confirm");
    }
  }

  // ---------------- render: judgment ----------------
  function showJudgment(judg: "PERFECT" | "GOOD" | "MISS" | null): void {
    if (!judg) {
      judgEl.innerHTML = "";
      judgEl.appendChild(judgIdleEl);
      return;
    }
    const color = JUDG_COLORS[judg];
    const stamp = document.createElement("div");
    stamp.className = "pl-judg-stamp";
    stamp.style.color = color;
    stamp.innerHTML = `<div class="pl-judg-main">${judg}</div><div class="pl-judg-sub">${JUDG_SUB[judg]}</div>`;
    judgEl.innerHTML = "";
    judgEl.appendChild(stamp);
    // re-trigger de la animación pl-stamp
    void stamp.offsetWidth;

    // FX reactivos
    fx.burst(judg, accent);
    fx.flash(judg, accent);
    if (judg === "MISS") fx.shake();
  }

  // ---------------- HUD ----------------
  function setScore(score: number): void {
    scoreEl.textContent = score.toLocaleString("en-US");
  }
  function setCombo(combo: number): void {
    comboEl.innerHTML = `${combo}<span class="pl-hud-x">x</span>`;
  }
  function setBest(best: number): void {
    bestEl.innerHTML = `${best}<span class="pl-hud-x">x</span>`;
  }
  function setProgress(progress: number): void {
    progressEl.style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`;
  }

  // ---------------- personaje ----------------
  function setExpression(e: "idle" | "hit" | "miss"): void {
    charExpr.textContent = e === "miss" ? "OUCH..." : e === "hit" ? "¡BRILLANDO!" : "EN RITMO";
    charExpr.style.color = e === "miss" ? JUDG_COLORS.MISS : accent;
    charPanel.classList.toggle("hit", e === "hit");
    character.setExpression(e);
  }

  // Posiciona las zonas good/perfect de la barra según el BPM real (ventanas del
  // motor → %). Se llama al arrancar cada canción porque las ventanas están en
  // segundos y su ancho en % depende del BPM.
  function applyTimingGeometry(bpm: number): void {
    const g = timingGeometry(bpm > 0 ? bpm : 120);
    timingGood.style.cssText = `left:${g.good.left}%;width:${g.good.width}%;`;
    timingPerf.style.cssText = `left:${g.perf.left}%;width:${g.perf.width}%;`;
  }

  // ---------------- canción ----------------
  function setSong(info: GameSongInfo): void {
    titleEl.textContent = info.title;
    bpmEl.textContent = String(Math.round(info.bpm));
    diffEl.textContent = info.difficulty;
    applyAccent(info.accent);
    applyTimingGeometry(info.bpm);
    setScore(0);
    setCombo(0);
    setBest(0);
    setProgress(0);
    showJudgment(null);
    setExpression("idle");
    renderSequence(null, []);
    renderTiming(0, null);
    setMuted(false);
  }

  // Geometría de la barra de timing alineada con el MOTOR:
  // - La línea PERFECT cae EXACTO donde el playhead está en el commit (COMMIT_PCT).
  // - Las zonas good/perfect arrancan con un BPM por defecto y se recalculan por
  //   canción en setSong() → applyTimingGeometry(), porque su ancho depende del BPM.
  timingLine.style.cssText = `left:${COMMIT_PCT}%;width:2px;transform:translateX(-1px);`;
  applyTimingGeometry(120);

  return {
    setSong,
    renderSequence,
    renderTiming,
    showJudgment,
    setExpression,
    setScore,
    setCombo,
    setBest,
    setProgress,
    setMuted,
    start: () => {
      fx.resize();
      waves.start();
    },
    stop: () => waves.stop(),
  };
}
