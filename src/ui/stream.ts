// stream.ts — Capa "live-stream / hype" del gameplay (#screen-play). DECORATIVA.
//
// Contrato: piel 100% AUTÓNOMA. Todas las animaciones (grilla en perspectiva,
// speed lines, emotes flotantes, toasts de alerta, medidor de HYPE + llama,
// chat en vivo, multiplicador, hitos de combo) se animan SOLAS con timers/rAF
// internos — NO están cableadas a datos del motor ni reflejan el rendimiento
// real. Es decisión explícita del producto: replica el demo JS del diseño nuevo,
// pero su "combo/hype/heat" es una SIMULACIÓN decorativa local, no el del juego.
//
// Portado fiel del diseño nuevo (design_new.html, L40-48 keyframes; L182-289
// markup; reactHit/spawn* del view-model). Mantiene el patrón de ciclo de vida
// de waves.ts / fx.ts: createStream() construye el DOM, start()/stop() arrancan
// y LIMPIAN todo (cada setInterval/setTimeout/rAF se trackea y se cancela).

// Paleta de colores de chat/acentos (design L898).
const HUES = ["#25E0FF", "#C8FF1E", "#FF2E9A", "#FFD021", "#A78BFA", "#FF7847"];
// Emotes (design L877).
const EMOTES = ["🔥", "★", "♥", "♪", "✦", "⚡", "💥", "🎵"];
// Usuarios y pools de mensajes del chat (design L889-892) — lista EXACTA.
const CHAT_USERS = [
  "ritmo_kun", "no_lifer", "pulse_fan", "kawaii_x", "beatmania",
  "otaku404", "syncwave", "mikulover", "pixelpro", "comboGOD",
];
const CHAT_HIT = ["eso!", "vamos!!", "limpio", "pog", "sigue así", "crackk", "wepa", "nice", "GG", "uff"];
const CHAT_PERFECT = ["PERFECT!!", "INSANO 🔥", "noooo way", "POGGERS", "crackazo", "sin fallar??", "LIMPIO 💯", "GOD"];
const CHAT_MISS = ["nooo", "F", "casi", "auch", "tranqui", "se viene", "ñooo"];

type ChatKind = "hit" | "perfect" | "miss";

const rnd = (n: number): number => Math.floor(Math.random() * n);
const pick = <T>(arr: T[]): T => arr[rnd(arr.length)]!;

export interface StreamApi {
  /** Arranca la capa decorativa (animaciones autónomas). */
  start(): void;
  /** Para y LIMPIA todo: rAF, timers, y vacía las capas. */
  stop(): void;
  /** Recolorea lo dependiente del acento por canción. */
  setAccent(hex: string): void;
}

/** Refs al DOM que createGame ya construyó (la capa vive dentro de .pl-gamecol). */
export interface StreamRefs {
  grid: HTMLElement;
  speed: HTMLElement;
  emoteLayer: HTMLElement;
  alertLayer: HTMLElement;
  hypeFill: HTMLElement;
  hypeFlame: HTMLElement;
  chatLayer: HTMLElement;
  comboNum: HTMLElement;
  mult: HTMLElement;
  comboFlair: HTMLElement;
}

export function createStream(refs: StreamRefs, getBpm: () => number): StreamApi {
  let accent = "#c8ff1e";
  let running = false;
  let rafId = 0;
  const t0 = performance.now();

  // Estado decorativo SIMULADO (no es el del motor). El demo lo deriva de hits
  // reales; acá lo movemos con timers para que la capa "viva" sola.
  let hype = 0; // 0..100
  let combo = 0; // combo decorativo (sube en cada "hit" simulado, se rompe a veces)
  let maxHypeLatched = false;

  // rastreo de timers para limpieza determinista en stop().
  const timeouts = new Set<number>();
  const intervals = new Set<number>();
  const after = (fn: () => void, ms: number): number => {
    const id = window.setTimeout(() => {
      timeouts.delete(id);
      fn();
    }, ms);
    timeouts.add(id);
    return id;
  };
  const every = (fn: () => void, ms: number): number => {
    const id = window.setInterval(fn, ms);
    intervals.add(id);
    return id;
  };

  // heat decorativo (0..1): igual fórmula que el demo (combo/12), pero combo es local.
  const heat = (): number => Math.min(1, combo / 12);

  // ---------------- HYPE ----------------
  function setHype(v: number): void {
    hype = Math.max(0, Math.min(100, v));
    refs.hypeFill.style.height = `${hype}%`;
    const atMax = hype >= 100;
    refs.hypeFill.classList.toggle("max", atMax);
    refs.hypeFlame.classList.toggle("on", atMax);
    if (atMax && !maxHypeLatched) {
      maxHypeLatched = true;
      spawnAlert("🔥 HYPE MÁXIMO", "#FF7847");
    }
    if (!atMax) maxHypeLatched = false;
  }

  // ---------------- emotes ----------------
  function spawnEmote(comboHint = combo): void {
    const e = document.createElement("div");
    e.className = "pl-emote";
    e.textContent = pick(EMOTES);
    const x = 6 + Math.random() * 88;
    const dur = 1.5 + Math.random() * 1.1;
    const rot = (Math.random() * 30 - 15).toFixed(0);
    const size = (18 + Math.random() * (16 + comboHint)).toFixed(0);
    e.style.cssText =
      `left:${x.toFixed(1)}%;bottom:${(4 + Math.random() * 16).toFixed(0)}%;` +
      `font-size:${size}px;--r:${rot}deg;` +
      `animation:pl-emote-rise ${dur.toFixed(2)}s ease-out forwards`;
    refs.emoteLayer.appendChild(e);
    after(() => e.remove(), dur * 1000 + 60);
  }

  // ---------------- chat ----------------
  // (el demo ignora el combo en el chat — solo decide el pool por `kind`).
  function spawnChat(kind: ChatKind): void {
    const pool = kind === "perfect" ? CHAT_PERFECT : kind === "miss" ? CHAT_MISS : CHAT_HIT;
    const user = pick(CHAT_USERS);
    const msg = pick(pool);
    const hue = pick(HUES);
    const row = document.createElement("div");
    row.className = "pl-chat-row";
    row.innerHTML =
      `<span class="pl-chat-user" style="color:${hue}">${user}</span>` +
      `<span class="pl-chat-msg">${msg}</span>`;
    refs.chatLayer.appendChild(row);
    while (refs.chatLayer.children.length > 6) refs.chatLayer.removeChild(refs.chatLayer.firstChild!);
    after(() => {
      row.classList.add("out");
      after(() => row.remove(), 420);
    }, 2600);
  }

  // ---------------- alertas ----------------
  function spawnAlert(text: string, color: string): void {
    const a = document.createElement("div");
    a.className = "pl-alert";
    a.style.background = color;
    a.textContent = text;
    refs.alertLayer.appendChild(a);
    after(() => a.remove(), 2500);
  }

  // ---------------- hito de combo ----------------
  function comboMilestone(c: number): void {
    const f = document.createElement("div");
    f.className = "pl-combo-flair-item";
    f.style.color = accent;
    f.innerHTML = `${c}<span class="pl-combo-flair-x">x</span> COMBO`;
    refs.comboFlair.innerHTML = "";
    refs.comboFlair.appendChild(f);
    after(() => f.remove(), 1000);
    if (c % 10 === 0) spawnAlert(`★ ${c} COMBO · NUEVO SEGUIDOR`, accent);
  }

  // ---------------- "hit" simulado (réplica decorativa de reactHit) ----------------
  // No hay input real: cada cierto tiempo simulamos un acierto (a veces un fallo)
  // para que la capa reaccione sola, tal como el demo reaccionaba a los hits.
  function simulateHit(): void {
    const isMiss = Math.random() < 0.12; // fallo ocasional
    if (isMiss) {
      combo = 0;
      setHype(hype - 42);
      spawnChat("miss");
      refs.mult.style.opacity = "0";
      refs.comboNum.style.filter = "none";
      return;
    }
    const isPerfect = Math.random() < 0.62;
    combo += 1;
    const h = Math.min(1, combo / 12);
    setHype(hype + (isPerfect ? 13 : 8));

    // multiplicador (mismo cálculo que el demo: ×1 + 0.2 cada 5 de combo).
    const mult = 1 + Math.floor(combo / 5) * 0.2;
    refs.mult.textContent = `×${mult.toFixed(1)} PUNTOS`;
    refs.mult.style.opacity = combo >= 5 ? "1" : "0";

    // pop + glow del número de combo (es el MISMO combo visible; acá decorativo).
    refs.comboNum.style.transform = `scale(${(1.14 + h * 0.22).toFixed(3)})`;
    refs.comboNum.style.filter =
      h > 0.45 ? `drop-shadow(0 0 ${(8 + h * 22).toFixed(0)}px ${accent})` : "none";
    after(() => {
      refs.comboNum.style.transform = "scale(1)";
    }, 130);

    // emotes escalan con el combo.
    const emoteN = 1 + Math.round(h * 3) + (isPerfect ? 1 : 0);
    for (let i = 0; i < emoteN; i++) spawnEmote(combo);

    // chat reacciona más a combo alto.
    if (Math.random() < 0.4 + h * 0.45) spawnChat(isPerfect ? "perfect" : "hit");

    // hitos cada 5.
    if (combo > 0 && combo % 5 === 0) comboMilestone(combo);
  }

  // ---------------- loop visual (grilla + speed lines + decay de hype) ----------------
  function frame(now: number): void {
    if (!running) return;
    rafId = requestAnimationFrame(frame);

    const bpm = getBpm();
    const beatMs = bpm > 0 ? 60000 / bpm : 60000 / 120;
    const ph = (now - t0) / beatMs;
    const beat = Math.pow(1 - (ph - Math.floor(ph)), 2.2);
    const h = heat();

    // grilla en perspectiva: opacity late con el beat + heat (design lifeFx).
    refs.grid.style.opacity = (0.05 + beat * 0.07 + h * 0.12).toFixed(3);

    // speed lines: rampa con el heat decorativo (design lifeFx).
    const target = h > 0.35 ? (h - 0.35) / 0.65 : 0;
    refs.speed.style.opacity = (target * (0.5 + beat * 0.5)).toFixed(3);

    // llama: pulsa de tamaño al estar al máximo de hype.
    if (hype >= 100) {
      refs.hypeFlame.style.transform = `scale(${(1 + beat * 0.25).toFixed(3)})`;
    } else {
      refs.hypeFlame.style.transform = "scale(1)";
    }
  }

  // ---------------- ciclo de vida ----------------
  function start(): void {
    if (running) return;
    running = true;
    // reset de estado.
    hype = 0;
    combo = 0;
    maxHypeLatched = false;
    setHype(0);
    refs.mult.style.opacity = "0";
    refs.comboNum.style.transform = "scale(1)";
    refs.comboNum.style.filter = "none";

    // arranca el loop visual.
    rafId = requestAnimationFrame(frame);

    // decay lento de hype (design lifeFx: -1.2 cada 240ms).
    every(() => {
      if (hype > 0) setHype(hype - 1.2);
    }, 240);

    // goteo ambiental de chat/emotes (design lifeFx: ~cada 1.5s, más con heat).
    every(() => {
      const h = heat();
      if (Math.random() < 0.6) spawnChat("hit");
      if (h > 0.5 && Math.random() < h) spawnEmote(combo);
    }, 1500);

    // "hits" simulados: cadencia decorativa para que hype/combo/flair vivan solos.
    every(() => simulateHit(), 900);

    // primer hit pronto para que arranque con vida.
    after(() => simulateHit(), 400);
  }

  function stop(): void {
    if (!running) return;
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    for (const id of timeouts) clearTimeout(id);
    for (const id of intervals) clearInterval(id);
    timeouts.clear();
    intervals.clear();
    // vacía las capas + resetea (design clearLayers).
    refs.emoteLayer.innerHTML = "";
    refs.alertLayer.innerHTML = "";
    refs.chatLayer.innerHTML = "";
    refs.comboFlair.innerHTML = "";
    refs.hypeFill.style.height = "0%";
    refs.hypeFill.classList.remove("max");
    refs.hypeFlame.classList.remove("on");
    refs.hypeFlame.style.transform = "scale(1)";
    refs.mult.style.opacity = "0";
    refs.comboNum.style.transform = "scale(1)";
    refs.comboNum.style.filter = "none";
    refs.speed.style.opacity = "0";
    hype = 0;
    combo = 0;
    maxHypeLatched = false;
  }

  function setAccent(hex: string): void {
    accent = hex;
    // la grilla usa --accent (heredado del root), así que no hace falta tocarla acá;
    // el combo-flair y el glow del combo se recolorean en su próximo spawn/hit.
  }

  return { start, stop, setAccent };
}
