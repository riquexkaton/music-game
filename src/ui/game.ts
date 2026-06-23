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
import { createStream, type StreamApi } from "./stream";
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

/** Estado visual de cada keycap de la secuencia. `wrong` = la que rompió (miss-flash). */
export type ArrowCellState = "done" | "current" | "pending" | "wrong";

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
  /**
   * Feedback de DESCANSO (descanso real del motor, src/core/rests.ts).
   * `active=true` muestra el bloque con `secondsLeft` (s restantes) y `fraction`
   * (0..1 restante, para la barra) y activa el overlay rayado de la timing bar.
   * `active=false` vuelve al estado normal.
   */
  setBreak(active: boolean, secondsLeft?: number, fraction?: number): void;
  /** Timecode decorativo (opcional, desde conductor.time). */
  setTimecode(text: string): void;
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
  // ¿Estamos en un descanso? Mientras dure, el bloque DESCANSO es dueño del slot
  // central: showJudgment(null) NO debe re-mostrar el idle, y el playhead va a 0.
  let breaking = false;

  // ---------------- DOM (blueprint §6 + diseño Pulse Game) ----------------
  // El panel del personaje es un OVERLAY flotante (no columna): la game column
  // ocupa todo el field (absolute inset:0). El orden importa para z-index.
  root.innerHTML = `
    <div class="pl-songbar" id="plg-songbar">
      <div class="pl-songbar-accent" id="plg-accent"></div>
      <div class="pl-songbar-cell pl-songbar-title" id="plg-title">—</div>
      <div class="pl-songbar-cell pl-songbar-bpm">
        <span class="pl-songbar-bpm-num" id="plg-bpm">—</span><span class="pl-songbar-bpm-unit">BPM</span>
      </div>
      <div class="pl-songbar-cell pl-songbar-diff" id="plg-diff">—</div>
      <div class="pl-grow"></div>
      <button class="pl-songbar-btn" id="plg-mute">♪ AUDIO ON</button>
      <button class="pl-songbar-btn pl-songbar-exit" id="plg-exit">ESC · SALIR</button>
    </div>

    <div class="pl-progress"><div class="pl-progress-fill" id="plg-progress"></div></div>

    <div class="pl-field" id="plg-field">
      <div class="pl-flash" id="plg-flash"></div>
      <canvas class="pl-fx-canvas" id="plg-fx"></canvas>

      <!-- capa stream/hype DECORATIVA (autónoma): speed lines + emotes + alertas -->
      <div class="pl-speed" id="plg-speed"></div>
      <div class="pl-emote-layer" id="plg-emote-layer"></div>
      <div class="pl-alert-layer" id="plg-alert-layer"></div>

      <div class="pl-gamecol">
        <canvas class="pl-wave-canvas" id="plg-wave"></canvas>

        <!-- grilla en perspectiva reactiva (decorativa) -->
        <div class="pl-bg-grid" id="plg-bg-grid"></div>

        <!-- decoración ambiental (detrás del HUD, z-index 0) -->
        <div class="pl-ambient">
          <div class="pl-watermark" id="plg-watermark">—</div>
          <div class="pl-rings" id="plg-rings">
            <div class="pl-ring" id="plg-ring1"></div>
            <div class="pl-ring" id="plg-ring2"></div>
            <div class="pl-ring" id="plg-ring3"></div>
            <div class="pl-ring-core" id="plg-ring-core"></div>
          </div>
          <div class="pl-bracket pl-bracket-tl"></div>
          <div class="pl-bracket pl-bracket-tr"></div>
          <div class="pl-bracket pl-bracket-bl"></div>
          <div class="pl-bracket pl-bracket-br"></div>
          <div class="pl-reg pl-reg-top">PULSE-ENGINE // LIVE</div>
          <div class="pl-reg pl-reg-tc" id="plg-tc">TC 00:00:00 · F00</div>
        </div>

        <!-- medidor de HYPE (borde izquierdo) — decorativo. La etiqueta "HYPE"
             ocupa el lugar del viejo registro vertical SYS.RHYTHM · AUDITION. -->
        <div class="pl-hype-track"><div class="pl-hype-fill" id="plg-hype-fill"></div></div>
        <div class="pl-hype-label">HYPE</div>
        <div class="pl-hype-flame" id="plg-hype-flame">🔥</div>

        <!-- chat en vivo (decorativo) -->
        <div class="pl-chat-layer" id="plg-chat-layer"></div>

        <!-- hito de combo en el centro (decorativo) -->
        <div class="pl-combo-flair" id="plg-combo-flair"></div>

        <div class="pl-gamecol-inner">
          <div class="pl-hud">
            <div class="pl-hud-stat">
              <div class="pl-hud-label">MEJOR</div>
              <div class="pl-hud-best" id="plg-best">0<span class="pl-hud-x">x</span></div>
            </div>
            <div class="pl-hud-stat pl-hud-right">
              <div class="pl-hud-label">COMBO</div>
              <div class="pl-hud-combo pl-hud-combo-reactive" id="plg-combo">0<span class="pl-hud-x">x</span></div>
              <div class="pl-mult" id="plg-mult">×1.0 PUNTOS</div>
            </div>
          </div>

          <div class="pl-center">
            <div class="pl-judg" id="plg-judg">
              <div class="pl-judg-idle" id="plg-judg-idle">PREPARADO</div>
              <div class="pl-break" id="plg-break" hidden>
                <div class="pl-break-eyebrow">DESCANSO</div>
                <div class="pl-break-count">
                  <span class="pl-break-sec" id="plg-break-sec">0.0</span><span class="pl-break-unit">s</span>
                </div>
                <div class="pl-break-track"><div class="pl-break-fill" id="plg-break-fill"></div></div>
                <div class="pl-break-hint">SIN INPUT · ESPERÁ EL CABEZAL</div>
              </div>
            </div>
            <div class="pl-arrows-row" id="plg-arrows"></div>
            <div class="pl-timing" id="plg-timing">
              <div class="pl-timing-good" id="plg-timing-good"></div>
              <div class="pl-timing-perf" id="plg-timing-perf"></div>
              <div class="pl-timing-line" id="plg-timing-line"></div>
              <div class="pl-timing-break" id="plg-timing-break"></div>
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

      <!-- overlay flotante del personaje (z-index 6, esquina inf-der) -->
      <div class="pl-char-panel" id="plg-char-panel">
        <div class="pl-char-portrait">
          <div class="pl-char-glow" id="plg-char-glow"></div>
          <div class="pl-char-scanlines"></div>
          <div class="pl-char-live">
            <span class="pl-char-live-dot"></span><span>LIVE</span>
          </div>
          <div class="pl-char-viewers">
            <span class="pl-char-viewers-dot">●</span><span id="plg-viewers">12.4K</span>
          </div>
          <div class="pl-char-stack" id="plg-char-stack"></div>
          <div class="pl-char-vignette"></div>
          <div class="pl-char-lower">
            <div class="pl-char-lower-text">
              <div class="pl-char-handle-row">
                <span class="pl-char-chip" id="plg-char-chip">M</span>
                <span class="pl-char-handle">@miku_rhythm</span>
              </div>
              <span class="pl-char-expr" id="plg-char-expr">EN RITMO</span>
            </div>
            <div class="pl-char-meter" id="plg-char-meter">
              <span></span><span></span><span></span><span></span><span></span>
            </div>
          </div>
          <div class="pl-char-border" id="plg-char-border"></div>
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
  const charBorder = $("plg-char-border");
  const charMeter = $("plg-char-meter");
  const bestEl = $("plg-best");
  const comboEl = $("plg-combo");
  const judgEl = $("plg-judg");
  const judgIdleEl = $("plg-judg-idle");
  const breakEl = $("plg-break");
  const breakSecEl = $("plg-break-sec");
  const breakFillEl = $("plg-break-fill");
  const arrowsEl = $("plg-arrows");
  const timingEl = $("plg-timing");
  const timingGood = $("plg-timing-good");
  const timingPerf = $("plg-timing-perf");
  const timingLine = $("plg-timing-line");
  const timingHead = $("plg-timing-head");
  const phaseEl = $("plg-phase");
  const scoreEl = $("plg-score");
  // decoración ambiental
  const watermarkEl = $("plg-watermark");
  const ringsEl = $("plg-rings");
  const ringCoreEl = $("plg-ring-core");
  const tcEl = $("plg-tc");
  // capa stream/hype (decorativa, autónoma)
  const gridEl = $("plg-bg-grid");
  const speedEl = $("plg-speed");
  const emoteLayerEl = $("plg-emote-layer");
  const alertLayerEl = $("plg-alert-layer");
  const hypeFillEl = $("plg-hype-fill");
  const hypeFlameEl = $("plg-hype-flame");
  const chatLayerEl = $("plg-chat-layer");
  const multEl = $("plg-mult");
  const comboFlairEl = $("plg-combo-flair");

  // ---------------- módulos (instanciados por sus interfaces, §3) ----------------
  const character: CharacterApi = createCharacter(charStack);
  const waves: WavesApi = createWaves(waveCanvas, hooks.getFreq, hooks.getBpm);
  const fx: FxApi = createFx(fxCanvas, flashEl, fieldEl);
  // Capa stream/hype: 100% DECORATIVA y AUTÓNOMA (animaciones por timers internos,
  // NO cableadas a datos del motor). Misma lifecycle que waves/fx (start/stop).
  const stream: StreamApi = createStream(
    {
      grid: gridEl,
      speed: speedEl,
      emoteLayer: emoteLayerEl,
      alertLayer: alertLayerEl,
      hypeFill: hypeFillEl,
      hypeFlame: hypeFlameEl,
      chatLayer: chatLayerEl,
      comboNum: comboEl,
      mult: multEl,
      comboFlair: comboFlairEl,
    },
    hooks.getBpm,
  );

  // ---------------- acento por canción ----------------
  function applyAccent(hex: string): void {
    accent = hex;
    root.style.setProperty("--accent", hex);
    accentEl.style.background = hex;
    bpmEl.style.color = hex;
    comboEl.style.color = hex;
    charChip.style.background = hex;
    charGlow.style.background = `radial-gradient(80% 60% at 50% 34%, ${hex}38 0%, transparent 62%)`;
    charBorder.style.borderColor = hex;
    for (const bar of Array.from(charMeter.children) as HTMLElement[]) bar.style.background = hex;
    character.setAccent(hex);
    waves.setAccent(hex);
    stream.setAccent(hex);
  }

  // Duración de las animaciones de pulso (anillos + core) derivada del BPM real,
  // igual que el diseño: ringDur = (60/bpm)*2 con delays escalonados; core = 60/bpm.
  function applyBeatTiming(bpm: number): void {
    const spb = 60 / (bpm > 0 ? bpm : 120);
    const ringDur = (spb * 2).toFixed(3);
    ringsEl.style.setProperty("--ring-dur", `${ringDur}s`);
    ringsEl.style.setProperty("--ring-d2", `${(-(spb * 2) / 3).toFixed(3)}s`);
    ringsEl.style.setProperty("--ring-d3", `${(-(spb * 4) / 3).toFixed(3)}s`);
    ringCoreEl.style.setProperty("--beat-dur", `${spb.toFixed(3)}s`);
  }

  // ---------------- controles ----------------
  muteBtn.addEventListener("click", () => {
    const muted = hooks.onToggleMute();
    setMuted(muted);
  });
  exitBtn.addEventListener("click", () => hooks.onExit());

  function setMuted(muted: boolean): void {
    muteBtn.textContent = muted ? "♪ AUDIO OFF" : "♪ AUDIO ON";
    muteBtn.classList.toggle("muted", muted);
  }

  // ---------------- render: secuencia de flechas ----------------
  // Diff con el render anterior para detectar la tecla RECIÉN pulsada (transición a
  // 'done') y dispararle el key-punch. El 'wrong' (miss-flash) viene en el estado.
  let prevStates: ArrowCellState[] = [];
  function renderSequence(states: ArrowCellState[] | null, glyphs: string[]): void {
    arrowsEl.innerHTML = "";
    if (!states) {
      prevStates = [];
      return;
    }
    states.forEach((state, i) => {
      const cell = document.createElement("div");
      cell.className = `pl-keycap pl-keycap-${state}`;
      // recién pulsada: pasó a 'done' en este render → punch.
      if (state === "done" && prevStates[i] !== "done") cell.classList.add("pl-keycap-punch");
      cell.textContent = glyphs[i] ?? ARROW_GLYPHS[i] ?? "?";
      arrowsEl.appendChild(cell);
    });
    prevStates = states.slice();
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
  // El slot central (#plg-judg) tiene 3 estados que conviven en el DOM: idle
  // (#plg-judg-idle), un stamp efímero (.pl-judg-stamp, creado/destruido acá) y el
  // bloque DESCANSO (#plg-break, lo maneja setBreak). NO vaciamos el contenedor:
  // togglear hidden preserva todos los nodos (el break sobrevive a un showJudgment).
  function clearStamp(): void {
    const stamp = judgEl.querySelector(".pl-judg-stamp");
    if (stamp) stamp.remove();
  }
  function showJudgment(judg: "PERFECT" | "GOOD" | "MISS" | null): void {
    clearStamp();
    if (!judg) {
      // Durante un descanso el bloque DESCANSO es dueño del slot: no re-mostrar idle.
      judgIdleEl.hidden = breaking;
      return;
    }
    judgIdleEl.hidden = true;
    const color = JUDG_COLORS[judg];
    const stamp = document.createElement("div");
    stamp.className = "pl-judg-stamp";
    stamp.style.color = color;
    stamp.innerHTML = `<div class="pl-judg-main">${judg}</div><div class="pl-judg-sub">${JUDG_SUB[judg]}</div>`;
    judgEl.appendChild(stamp);
    // re-trigger de la animación pl-stamp
    void stamp.offsetWidth;

    // FX reactivos
    fx.burst(judg, accent);
    fx.flash(judg, accent);
    if (judg === "MISS") fx.shake();
  }

  // ---------------- DESCANSO ----------------
  // Bloque visual cuando el motor está en un descanso real (src/core/rests.ts).
  // active=true muestra el contador + barra y activa el overlay rayado de la barra
  // de timing; active=false vuelve al estado normal. NO toca la geometría derivada
  // del juez: el rayado es un hijo toggleable de la barra.
  //
  // OJO: se llama CADA frame (desde renderTimingPlay). Por eso el toggle de
  // judgIdle/timing/phase sólo corre en la TRANSICIÓN (entrar/salir), nunca por
  // frame: si no, pisaría a showJudgment (que oculta el idle al mostrar un stamp).
  function setBreak(active: boolean, secondsLeft = 0, fraction = 1): void {
    const was = breaking;
    breaking = active;
    if (active) {
      if (!was) {
        // Entrando al descanso: el bloque DESCANSO toma el slot central.
        judgIdleEl.hidden = true;
        clearStamp();
        breakEl.hidden = false;
        breakEl.style.animation = "none";
        void breakEl.offsetWidth;
        breakEl.style.animation = "";
        timingEl.classList.add("breaking");
        phaseEl.classList.remove("confirm");
        phaseEl.classList.add("breaking");
      }
      // Cada frame: sólo actualizamos contador, barra, label y reset del cabezal.
      breakSecEl.textContent = Math.max(0, secondsLeft).toFixed(1);
      breakFillEl.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
      timingHead.style.left = "0%";
      phaseEl.textContent = "DESCANSO — SIN INPUT";
    } else if (was) {
      // Saliendo del descanso: ocultar el bloque y restaurar el idle SÓLO si no hay
      // un stamp vivo (showJudgment manda sobre el idle).
      breakEl.hidden = true;
      judgIdleEl.hidden = judgEl.querySelector(".pl-judg-stamp") !== null;
      timingEl.classList.remove("breaking");
      phaseEl.classList.remove("breaking");
    }
  }

  /** Timecode decorativo de la esquina (lo cablea main.ts desde conductor.time). */
  function setTimecode(text: string): void {
    tcEl.textContent = text;
  }

  // ---------------- HUD ----------------
  // Score con rolling-digits + bump (portado del diseño). `displayScore` guarda el
  // último valor pintado para animar SOLO los dígitos que cambian. El valor real
  // (numérico) siempre queda correcto: si no hay animación, es textContent directo.
  let displayScore = 0;
  let rollEndTimer = 0;
  function setScore(score: number): void {
    const from = displayScore;
    displayScore = score;
    const fmt = score.toLocaleString("en-US");
    // Primer pintado o sin cambio: directo, sin animación.
    if (from === score) {
      scoreEl.textContent = fmt;
      return;
    }
    const toR = fmt.split("").reverse();
    const fromR = from.toLocaleString("en-US").split("").reverse();
    const cells = toR.map((tc, i) => ({ tc, fc: i < fromR.length ? fromR[i] : null }));
    cells.reverse();
    let inner = "";
    for (const c of cells) {
      if (c.tc === ",") {
        inner += `<span class="pl-score-comma">,</span>`;
        continue;
      }
      const nd = Number.parseInt(c.tc, 10);
      const od = c.fc && c.fc >= "0" && c.fc <= "9" ? Number.parseInt(c.fc, 10) : 0;
      const steps = (nd - od + 10) % 10;
      let col = "";
      for (let k = 0; k <= steps; k += 1) col += `<span class="pl-score-d">${(od + k) % 10}</span>`;
      inner += `<span class="pl-score-cell"><span class="pl-score-col" data-col>${col}</span></span>`;
    }
    scoreEl.innerHTML = inner;
    // re-trigger del bump
    scoreEl.style.animation = "none";
    void scoreEl.offsetWidth;
    scoreEl.style.animation = "pl-score-bump 0.42s ease";
    const cols = Array.from(scoreEl.querySelectorAll<HTMLElement>("[data-col]"));
    void scoreEl.offsetWidth;
    requestAnimationFrame(() => {
      for (const col of cols) {
        const n = col.children.length - 1; // pasos hasta el dígito final
        col.style.transition = "transform 0.54s cubic-bezier(.2,.75,.2,1)";
        col.style.transform = `translateY(-${n}em)`;
      }
    });
    // Al terminar, colapsar al texto plano (evita acumular DOM y deja el valor exacto).
    clearTimeout(rollEndTimer);
    rollEndTimer = window.setTimeout(() => {
      scoreEl.style.animation = "none";
      scoreEl.textContent = displayScore.toLocaleString("en-US");
    }, 620);
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
    watermarkEl.textContent = info.title;
    applyAccent(info.accent);
    applyTimingGeometry(info.bpm);
    applyBeatTiming(info.bpm);
    setBreak(false);
    // Reset duro del score (sin rolling): nueva canción arranca en 0 limpio.
    displayScore = 0;
    scoreEl.style.animation = "none";
    scoreEl.textContent = "0";
    setCombo(0);
    setBest(0);
    setProgress(0);
    setTimecode("TC 00:00:00 · F00");
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
    setBreak,
    setTimecode,
    setExpression,
    setScore,
    setCombo,
    setBest,
    setProgress,
    setMuted,
    start: () => {
      fx.resize();
      waves.start();
      stream.start();
    },
    stop: () => {
      waves.stop();
      stream.stop();
    },
  };
}
