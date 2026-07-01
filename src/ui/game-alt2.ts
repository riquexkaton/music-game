// game-alt2.ts — Piel ALTERNATIVA del gameplay (#screen-play): "Pulse Game Alt 2 ·
// Streamer", variante C (OVERLAY VERTICAL), portada de claude.ai/design.
//
// Cumple EXACTAMENTE el mismo contrato que game.ts (GameApi): el motor (main.ts) le
// habla por esa interfaz sin saber qué piel está montada. Por eso importamos los tipos
// desde ./game — así el compilador garantiza que ambas skins son intercambiables.
//
// REUTILIZA los mismos módulos decorativos que la piel clásica (character/waves/fx/
// stream): no duplicamos el motor visual, sólo cambiamos el LAYOUT y le pasamos otros
// nodos. La fuente de verdad sigue siendo el conductor real; esto es sólo PIEL.

import { createCharacter, type CharacterApi } from "./character";
import { createWaves, type WavesApi } from "./waves";
import { createFx, type FxApi } from "./fx";
import { createStream, type StreamApi } from "./stream";
import { TIMING_WINDOWS, type Grade } from "../core/judge";
import type {
  GameApi,
  GameHooks,
  GameSongInfo,
  ArrowCellState,
  TimingPhase,
} from "./game";

// --- Geometría de la barra de timing (DEBE coincidir con el MOTOR, igual que game.ts).
// El playhead recorre APPROACH+AFTER beats de 0% a 100%; el COMMIT (perfect del motor)
// cae a APPROACH/(APPROACH+AFTER) del recorrido. Zonas y línea perfect se derivan de las
// ventanas reales de judge.ts — no de porcentajes decorativos. (Duplicado a propósito:
// game.ts guarda su copia con la misma nota; son constantes puras y estables.)
const APPROACH_BEATS = 4;
const AFTER_BEATS = 1;
const TIMING_SPAN_BEATS = APPROACH_BEATS + AFTER_BEATS; // 5
const COMMIT_PCT = (APPROACH_BEATS / TIMING_SPAN_BEATS) * 100; // 80
const PCT_PER_BEAT = 100 / TIMING_SPAN_BEATS; // 20

const windowOf = (grade: Grade): number =>
  TIMING_WINDOWS.find((w) => w.grade === grade)?.window ?? 0;

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

// Colores/sub de judgment (fijos, NO cambian por canción) — igual que game.ts.
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

export function createGameAlt2(root: HTMLElement, hooks: GameHooks): GameApi {
  let accent = "#c8ff1e";
  // ¿Estamos en un descanso? Mientras dure, el bloque DESCANSO es dueño del slot central
  // (misma regla que game.ts): showJudgment(null) no re-muestra el idle, playhead a 0.
  let breaking = false;

  // ---------------- DOM (Pulse Game Alt 2, variante C · OVERLAY) ----------------
  root.innerHTML = `
    <div class="pl-a2-topbar">
      <div class="pl-a2-brand">PULSE<span>.</span>LIVE</div>
      <div class="pl-a2-song">
        <span class="pl-a2-song-dot" id="a2-accent"></span>
        <span class="pl-a2-song-title" id="a2-title">—</span>
        <span class="pl-a2-song-bpm" id="a2-bpm">—</span>
        <span class="pl-a2-song-unit">BPM · <span id="a2-diff">—</span></span>
      </div>
      <div class="pl-grow"></div>
      <button class="pl-a2-btn" id="a2-mute" type="button">♪ AUDIO ON</button>
      <button class="pl-a2-btn pl-a2-exit" id="a2-exit" type="button">ESC · SALIR</button>
    </div>

    <div class="pl-a2-progress"><div id="a2-progress"></div></div>

    <div class="pl-a2-field" id="a2-field">
      <canvas class="pl-wave-canvas" id="a2-wave"></canvas>
      <div class="pl-bg-grid" id="a2-grid"></div>
      <div class="pl-a2-vignette"></div>
      <div class="pl-a2-edge"><span></span><span></span></div>

      <div class="pl-flash" id="a2-flash"></div>
      <div class="pl-speed" id="a2-speed"></div>
      <canvas class="pl-fx-canvas" id="a2-fx"></canvas>
      <div class="pl-emote-layer" id="a2-emote"></div>
      <div class="pl-alert-layer" id="a2-alert"></div>
      <div class="pl-combo-flair" id="a2-flair"></div>

      <!-- hype rail (arriba, horizontal) -->
      <div class="pl-a2-hype-rail"><div class="pl-a2-hype-fill" id="a2-hype"></div></div>
      <span class="pl-a2-hype-flame" id="a2-flame">🔥</span>

      <!-- cámara del streamer (derecha) -->
      <div class="pl-a2-cam" id="a2-cam">
        <div class="pl-a2-cam-glow" id="a2-camglow"></div>
        <div class="pl-a2-cam-stack" id="a2-camstack"></div>
        <div class="pl-a2-cam-scan"></div>
        <div class="pl-a2-cam-maskL"></div>
        <div class="pl-a2-cam-maskB"></div>
        <div class="pl-a2-cam-lower">
          <div class="pl-a2-cam-handle">
            <span class="pl-a2-cam-chip" id="a2-chip">M</span>
            <span class="pl-a2-cam-name">@miku_rhythm</span>
          </div>
          <span class="pl-a2-cam-expr" id="a2-expr">EN RITMO</span>
        </div>
      </div>

      <!-- LIVE + espectadores (arriba izquierda) -->
      <div class="pl-a2-live">
        <div class="pl-a2-live-badge"><span class="pl-a2-live-dot"></span>LIVE</div>
        <div class="pl-a2-viewers"><span class="pl-a2-viewers-dot">●</span><span id="a2-viewers">12.4K</span></div>
      </div>

      <!-- columna HUD (izquierda-centro) -->
      <div class="pl-a2-hud">
        <div class="pl-a2-hud-top">
          <div>
            <div class="pl-a2-hud-label">COMBO</div>
            <div class="pl-a2-combo" id="a2-combo">0<span class="pl-a2-x">x</span></div>
            <div class="pl-mult" id="a2-mult" style="text-align:left">×1.0 PUNTOS</div>
          </div>
          <div class="pl-a2-best-wrap">
            <div class="pl-a2-hud-label">MEJOR</div>
            <div class="pl-a2-best" id="a2-best">0<span class="pl-a2-x">x</span></div>
          </div>
        </div>

        <div class="pl-a2-center">
          <div class="pl-judg" id="a2-judg">
            <div class="pl-judg-idle" id="a2-idle">PREPARADO</div>
            <div class="pl-countdown" id="a2-countdown" hidden>
              <div class="pl-countdown-num" id="a2-countdown-num"></div>
            </div>
            <div class="pl-break" id="a2-break" hidden>
              <div class="pl-break-eyebrow">DESCANSO</div>
              <div class="pl-break-count">
                <span class="pl-break-sec" id="a2-break-sec">0.0</span><span class="pl-break-unit">s</span>
              </div>
              <div class="pl-break-track"><div class="pl-break-fill" id="a2-break-fill"></div></div>
              <div class="pl-break-hint">SIN INPUT · ESPERÁ EL CABEZAL</div>
            </div>
          </div>
          <div class="pl-arrows-row" id="a2-arrows"></div>
          <div class="pl-timing" id="a2-timing">
            <div class="pl-timing-good" id="a2-tgood"></div>
            <div class="pl-timing-perf" id="a2-tperf"></div>
            <div class="pl-timing-line" id="a2-tline"></div>
            <div class="pl-timing-break"></div>
            <div class="pl-timing-head" id="a2-thead"></div>
          </div>
          <div class="pl-phase" id="a2-phase">CARGÁ LA SECUENCIA</div>
          <div class="pl-a2-scorebox">
            <div class="pl-a2-hud-label">SCORE</div>
            <div class="pl-score" id="a2-score">0</div>
          </div>
        </div>
      </div>

      <!-- chat en vivo (abajo izquierda) -->
      <div class="pl-chat-layer pl-a2-chat" id="a2-chat"></div>
    </div>`;

  const $ = (id: string): HTMLElement => root.querySelector(`#${id}`) as HTMLElement;
  const accentSquare = $("a2-accent");
  const titleEl = $("a2-title");
  const bpmEl = $("a2-bpm");
  const diffEl = $("a2-diff");
  const muteBtn = $("a2-mute") as HTMLButtonElement;
  const exitBtn = $("a2-exit") as HTMLButtonElement;
  const progressEl = $("a2-progress");
  const fieldEl = $("a2-field");
  const flashEl = $("a2-flash");
  const fxCanvas = $("a2-fx") as HTMLCanvasElement;
  const waveCanvas = $("a2-wave") as HTMLCanvasElement;
  const gridEl = $("a2-grid");
  const speedEl = $("a2-speed");
  const emoteLayerEl = $("a2-emote");
  const alertLayerEl = $("a2-alert");
  const comboFlairEl = $("a2-flair");
  const hypeFillEl = $("a2-hype");
  const hypeFlameEl = $("a2-flame");
  const chatLayerEl = $("a2-chat");
  const camStackEl = $("a2-camstack");
  const camGlowEl = $("a2-camglow");
  const chipEl = $("a2-chip");
  const exprEl = $("a2-expr");
  const comboEl = $("a2-combo");
  const bestEl = $("a2-best");
  const multEl = $("a2-mult");
  const judgEl = $("a2-judg");
  const judgIdleEl = $("a2-idle");
  const countdownEl = $("a2-countdown");
  const countdownNumEl = $("a2-countdown-num");
  const breakEl = $("a2-break");
  const breakSecEl = $("a2-break-sec");
  const breakFillEl = $("a2-break-fill");
  const arrowsEl = $("a2-arrows");
  const timingEl = $("a2-timing");
  const timingGood = $("a2-tgood");
  const timingPerf = $("a2-tperf");
  const timingLine = $("a2-tline");
  const timingHead = $("a2-thead");
  const phaseEl = $("a2-phase");
  const scoreEl = $("a2-score");

  // ---------------- módulos (reutilizados, mismas interfaces que game.ts) ----------------
  const character: CharacterApi = createCharacter(camStackEl);
  const waves: WavesApi = createWaves(waveCanvas, hooks.getFreq, hooks.getBpm);
  const fx: FxApi = createFx(fxCanvas, flashEl, fieldEl);
  // El rail de HYPE de Alt 2 es HORIZONTAL → hypeAxis:"width" (el clásico usa height).
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
      hypeAxis: "width",
    },
    hooks.getBpm,
  );

  // ---------------- acento por canción ----------------
  function applyAccent(hex: string): void {
    accent = hex;
    root.style.setProperty("--accent", hex);
    accentSquare.style.background = hex;
    bpmEl.style.color = hex;
    comboEl.style.color = hex;
    chipEl.style.background = hex;
    camGlowEl.style.background = `radial-gradient(70% 60% at 64% 36%, ${hex}4d 0%, transparent 64%)`;
    // El MEJOR queda en lima fija (como el diseño); combo/acento sí siguen la canción.
    character.setAccent(hex);
    waves.setAccent(hex);
    stream.setAccent(hex);
  }

  // ---------------- controles ----------------
  muteBtn.addEventListener("click", () => setMuted(hooks.onToggleMute()));
  exitBtn.addEventListener("click", () => hooks.onExit());
  function setMuted(muted: boolean): void {
    muteBtn.textContent = muted ? "♪ AUDIO OFF" : "♪ AUDIO ON";
    muteBtn.classList.toggle("muted", muted);
  }

  // ---------------- render: secuencia de flechas (idéntico a game.ts) ----------------
  let prevStates: ArrowCellState[] = [];
  function renderSequence(states: ArrowCellState[] | null, glyphs: string[]): void {
    arrowsEl.innerHTML = "";
    if (!states) {
      prevStates = [];
      return;
    }
    const fresh = prevStates.length === 0;
    states.forEach((state, i) => {
      const cell = document.createElement("div");
      cell.className = `pl-keycap pl-keycap-${state}`;
      if (state === "done" && prevStates[i] !== "done") cell.classList.add("pl-keycap-punch");
      if (fresh) {
        cell.classList.add("pl-keycap-enter");
        cell.style.animationDelay = `${i * 60}ms`;
      }
      cell.textContent = glyphs[i] ?? ARROW_GLYPHS[i] ?? "?";
      arrowsEl.appendChild(cell);
    });
    prevStates = states.slice();
  }

  // ---------------- render: barra de timing ----------------
  function renderTiming(progress: number, phase: TimingPhase | null): void {
    const clamped = Math.max(0, Math.min(1, progress));
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
  function clearStamp(): void {
    judgEl.querySelector(".pl-judg-stamp")?.remove();
  }
  function showJudgment(judg: "PERFECT" | "GOOD" | "MISS" | null): void {
    clearStamp();
    if (!judg) {
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
    void stamp.offsetWidth;
    // FX honestos: destello sólo en aciertos (MISS ya tiene su feedback). Sin shake.
    fx.burst(judg, accent);
    if (judg !== "MISS") fx.flash(judg, accent);
  }

  // ---------------- DESCANSO (idéntico a game.ts) ----------------
  function setBreak(active: boolean, secondsLeft = 0, fraction = 1): void {
    const was = breaking;
    breaking = active;
    if (active) {
      if (!was) {
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
      breakSecEl.textContent = Math.max(0, secondsLeft).toFixed(1);
      breakFillEl.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
      timingHead.style.left = "0%";
      phaseEl.textContent = "DESCANSO — SIN INPUT";
    } else if (was) {
      breakEl.hidden = true;
      judgIdleEl.hidden = judgEl.querySelector(".pl-judg-stamp") !== null;
      timingEl.classList.remove("breaking");
      phaseEl.classList.remove("breaking");
    }
  }

  // ---------------- CUENTA REGRESIVA (intro, idéntico a game.ts) ----------------
  let countLabel: string | null = null;
  function setCountdown(label: string | null): void {
    if (label === countLabel) return;
    countLabel = label;
    if (label === null) {
      countdownEl.hidden = true;
      countdownNumEl.textContent = "";
      judgIdleEl.hidden = breaking || judgEl.querySelector(".pl-judg-stamp") !== null;
      return;
    }
    const go = label === "¡VAMOS!";
    judgIdleEl.hidden = true;
    countdownEl.hidden = false;
    countdownNumEl.textContent = label;
    countdownNumEl.classList.toggle("go", go);
    countdownNumEl.style.animation = "none";
    void countdownNumEl.offsetWidth;
    countdownNumEl.style.animation = "";
  }

  // La variante C del diseño no tiene timecode → no-op (parte del contrato GameApi).
  function setTimecode(_text: string): void {
    /* sin elemento de timecode en Alt 2 */
  }

  // ---------------- HUD ----------------
  // Score con rolling-digits + bump (mismo algoritmo probado que game.ts; reusa las
  // clases pl-score-* globales de pulse.css).
  let displayScore = 0;
  let rollEndTimer = 0;
  function setScore(score: number): void {
    const from = displayScore;
    displayScore = score;
    const fmt = score.toLocaleString("en-US");
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
    scoreEl.style.animation = "none";
    void scoreEl.offsetWidth;
    scoreEl.style.animation = "pl-score-bump 0.42s ease";
    const cols = Array.from(scoreEl.querySelectorAll<HTMLElement>("[data-col]"));
    void scoreEl.offsetWidth;
    requestAnimationFrame(() => {
      for (const col of cols) {
        const n = col.children.length - 1;
        col.style.transition = "transform 0.54s cubic-bezier(.2,.75,.2,1)";
        col.style.transform = `translateY(-${n}em)`;
      }
    });
    clearTimeout(rollEndTimer);
    rollEndTimer = window.setTimeout(() => {
      scoreEl.style.animation = "none";
      scoreEl.textContent = displayScore.toLocaleString("en-US");
    }, 620);
  }
  function setCombo(combo: number): void {
    comboEl.innerHTML = `${combo}<span class="pl-a2-x">x</span>`;
  }
  function setBest(best: number): void {
    bestEl.innerHTML = `${best}<span class="pl-a2-x">x</span>`;
  }
  function setProgress(progress: number): void {
    (progressEl.firstElementChild as HTMLElement | null)?.style.setProperty(
      "width",
      `${Math.max(0, Math.min(1, progress)) * 100}%`,
    );
  }

  // ---------------- personaje ----------------
  function setExpression(e: "idle" | "hit" | "miss"): void {
    exprEl.textContent = e === "miss" ? "OUCH..." : e === "hit" ? "¡BRILLANDO!" : "EN RITMO";
    exprEl.style.color = e === "miss" ? JUDG_COLORS.MISS : accent;
    character.setExpression(e);
  }

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
    setBreak(false);
    setCountdown(null);
    displayScore = 0;
    scoreEl.style.animation = "none";
    scoreEl.textContent = "0";
    setCombo(0);
    setBest(0);
    setProgress(0);
    showJudgment(null);
    setExpression("idle");
    renderSequence(null, []);
    renderTiming(0, null);
    setMuted(false);
  }

  // Geometría alineada al MOTOR: línea perfect en el commit; zonas por BPM (setSong).
  timingLine.style.cssText = `left:${COMMIT_PCT}%;width:2px;transform:translateX(-1px);`;
  applyTimingGeometry(120);

  return {
    setSong,
    renderSequence,
    renderTiming,
    showJudgment,
    react: (verdict, combo) => stream.react(verdict, combo),
    setBreak,
    setCountdown,
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
