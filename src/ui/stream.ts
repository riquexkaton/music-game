// stream.ts — Capa "live-stream / hype" del gameplay (#screen-play). HONESTA.
//
// Contrato: la capa REFLEJA el desempeño REAL del jugador. El motor resuelve
// cada nota y game.ts llama a react(verdict, combo) con el veredicto y el combo
// REALES del juego. NO hay simulación: hype, multiplicador, chat, emotes y heat
// derivan de lo que el jugador efectivamente hizo. Los únicos loops autónomos son
// puramente visuales (rAF de grilla/speed-lines + decay lento del hype) y NO
// inventan rendimiento.
//
// Markup y keyframes portados del diseño nuevo (design_new.html, L40-48 / L182-289),
// pero el view-model está cableado a datos reales. Mantiene el patrón de ciclo de
// vida de waves.ts / fx.ts: createStream() construye el DOM, start()/stop()
// arrancan y LIMPIAN todo (cada setInterval/setTimeout/rAF se trackea y se cancela).

// Paleta de colores de chat/acentos (design L898).
const HUES = ["#25E0FF", "#C8FF1E", "#FF2E9A", "#FFD021", "#A78BFA", "#FF7847"];
// Emotes (design L877).
const EMOTES = ["🔥", "★", "♥", "♪", "✦", "⚡", "💥", "🎵"];
// Usuarios y pools de mensajes del chat (design L889-892, ampliados para variedad).
// Más usuarios → menos repetición obvia cuando varios mensajes conviven en pantalla.
const CHAT_USERS = [
  "ritmo_kun", "no_lifer", "pulse_fan", "kawaii_x", "beatmania",
  "otaku404", "syncwave", "mikulover", "pixelpro", "comboGOD",
  "bpm_addict", "lag_switch", "tofu_san", "neon_devil", "haru_h",
  "qtipie", "404_notfound", "vibecheck", "snare_kid", "yuki_uwu",
];
const CHAT_HIT = [
  "eso!", "vamos!!", "limpio", "pog", "sigue así", "crackk", "wepa", "nice", "GG", "uff",
  "ezpz", "clean", "vamoo", "que dedos", "sin esfuerzo", "W", "lesgooo", "manito arriba",
];
const CHAT_PERFECT = [
  "PERFECT!!", "INSANO 🔥", "noooo way", "POGGERS", "crackazo", "sin fallar??", "LIMPIO 💯", "GOD",
  "ESTÁ ON FIRE", "QUE NIVEL", "no falla una", "BUILT DIFFERENT", "imparable 🚀", "humano?? 😳",
  "CLIPEEN ESO", "modo dios", "FULL COMBO?!",
];
const CHAT_MISS = [
  "nooo", "F", "casi", "auch", "tranqui", "se viene", "ñooo",
  "uy", "F en el chat", "casi casi", "ouch", "se fue 💀", "noo eso era", "rip combo",
  "skill issue 😭", "duele", "concentrate", "naah", "ouf", "perdón??",
];
// Ambiente / relleno neutral — el chat respira aunque no pase nada (stream real).
// Tono NEUTRAL/HONESTO: ni aplaude ni hunde. Es el pool que más se ve (alimenta el
// goteo ambiental a hype bajo/medio), así que va BIEN poblado y variado para que no se
// repita obvio: saludos, expectativa, charla casual, aliento moderado y crítica suave.
const CHAT_NEUTRAL = [
  // saludos / entradas
  "hola chat", "primera vez aquí", "buenas 👋", "vine por el algoritmo", "saludos desde 🇦🇷",
  "holaa", "recién llego", "qué onda gente", "buenas buenas",
  // preguntas / contexto
  "que tema es?", "qué juego es", "pásame el link", "diff?", "le va bien?",
  "alguien más viendo?", "esto es nuevo?", "cuánto lleva jugando?", "qué bpm es esto",
  // casual / ambiente
  "sube el volumen", "este beat 🎧", "vamo a ver", "me quedo un rato", "el ritmo te atrapa",
  "👀", "buen tema igual", "qué tranqui esto", "café y stream ☕", "de fondo va perfecto",
  "me gusta la estética", "lofi vibes",
  // aliento moderado (sin euforia)
  "vamos que se puede", "dale tranqui", "concentración", "a calentar dedos", "ahí va",
  "tú puedes", "sin apurar",
  // crítica suave / expectativa honesta
  "se puede mejor", "a ver esa racha", "venga, enfócate", "uy casi", "ojo con el timing",
  "esperando el flow", "a ver qué tal sale",
  // misc de chat
  "gg de antemano", "f en el chat por si acaso", "ggwp chat", "lurkeando 👀", "+1",
];

type ChatKind = "hit" | "perfect" | "miss" | "neutral";

const rnd = (n: number): number => Math.floor(Math.random() * n);
const pick = <T>(arr: T[]): T => arr[rnd(arr.length)]!;

export interface StreamApi {
  /** Arranca la capa (loops visuales + decay del hype). */
  start(): void;
  /** Para y LIMPIA todo: rAF, timers, y vacía las capas. */
  stop(): void;
  /**
   * Reacciona a un veredicto REAL del motor. `combo` es el combo REAL del juego
   * (el mismo multiplicador del score). Alimenta hype/mult/chat/emotes/heat con
   * datos honestos — sin azar. Lo llama game.ts desde showJudgment.
   */
  react(verdict: "PERFECT" | "GOOD" | "MISS", combo: number): void;
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

  // Estado REAL (alimentado por react() desde el motor vía game.ts).
  let hype = 0; // 0..100 — sube en aciertos, se desploma en MISS, decae lento.
  let combo = 0; // combo REAL del juego (el mismo del multiplicador del score).
  let maxHypeLatched = false;

  // Alertas sub/unsub HONESTAS (estilo Twitch): SOLO reflejan rendimiento real.
  // missStreak = MISS consecutivos (se resetea en cualquier acierto). lastSubMs /
  // lastUnsubMs = timestamps del último toast para el COOLDOWN (no spamear).
  // lastSubCombo = combo del último sub disparado (un sub por hito, no por nota).
  let missStreak = 0;
  let lastSubMs = -1e9;
  let lastUnsubMs = -1e9;
  let lastSubCombo = 0;
  const SUB_COOLDOWN = 5500; // ms mínimo entre subs (no en cada nota buena).
  const UNSUB_COOLDOWN = 5000; // ms mínimo entre unsubs (no en cada MISS).
  const SUB_COMBO_STEP = 15; // hito de racha que dispara un sub (cada ~15 de combo).
  const SUB_HYPE_ZONE = 85; // hype alto: la racha está REALMENTE on fire.
  const UNSUB_MISS_STREAK = 3; // racha de MISS seguidos que castiga con un unsub.
  const UNSUB_HYPE_FLOOR = 10; // hype desplomado tras un MISS → la gente se va.
  const SUB_COLOR = "#C8FF1E"; // lima/accent: recompensa positiva.
  const UNSUB_COLOR = "#FF2E9A"; // magenta MISS: castigo negativo.

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

  // heat REAL (0..1): combo/12, con el combo REAL del juego.
  const heat = (): number => Math.min(1, combo / 12);

  // ---- curva del HYPE (calibración, fácil de re-tunear) ----
  // El hype sigue ligado al combo/veredicto REAL: no inventa rendimiento. Pero la
  // ganancia ESCALA con la racha (momentum) para que encadenar combos se SIENTA, y el
  // decay pasivo es suave para que el ritmo normal de juego (un acierto cada ~4 s) no
  // se lo coma. A ~4 s/acierto el decay borra ~8% entre dos notas; con estos números el
  // hype (a PERFECT) trepa de forma clara: ~60% a combo 8, ~80% a combo 10, satura a combo 13.
  const HYPE_GAIN_BASE = 9; // piso por acierto en combo bajo (h→0); GOOD. PERFECT suma +2 (ver react).
  const HYPE_GAIN_MOMENTUM = 10; // extra · heat: combo alto (h→1) más que DUPLICA la ganancia.
  const HYPE_DECAY = 0.5; // caída pasiva por tick de 240ms (≈ −2%/s). Honesto pero no agresivo.

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
  // El pool lo decide `kind`; quién llama (react / goteo) ya filtró por la VERDAD
  // del juego (acierto→hit/perfect, MISS→miss, neutral→relleno honesto). El feed
  // APILA varios mensajes a la vez: cada uno vive un rato y los viejos se evictan.
  const poolFor = (kind: ChatKind): string[] =>
    kind === "perfect" ? CHAT_PERFECT : kind === "miss" ? CHAT_MISS : kind === "neutral" ? CHAT_NEUTRAL : CHAT_HIT;

  // Cuántos mensajes deja vivos el feed antes de evictar por arriba (los más viejos).
  // ~5 visibles + 1 de respiro para que una ráfaga no se pise a sí misma.
  const CHAT_MAX = 6;

  function spawnChat(kind: ChatKind): void {
    const user = pick(CHAT_USERS);
    const msg = pick(poolFor(kind));
    const hue = pick(HUES);
    const row = document.createElement("div");
    row.className = "pl-chat-row";
    row.innerHTML =
      `<span class="pl-chat-user" style="color:${hue}">${user}</span>` +
      `<span class="pl-chat-msg">${msg}</span>`;
    refs.chatLayer.appendChild(row);
    // evicta los más viejos (por arriba) para acotar nodos y no trabar el render.
    while (refs.chatLayer.children.length > CHAT_MAX) {
      const old = refs.chatLayer.firstChild as HTMLElement | null;
      if (!old) break;
      refs.chatLayer.removeChild(old);
    }
    // vida en pantalla; el fade-out colapsa el alto (pl-chat-out) y empuja el resto.
    after(() => {
      row.classList.add("out");
      after(() => row.remove(), 420);
    }, 3200 + rnd(1400)); // 3.2–4.6s: con varios entrando, el feed se mantiene poblado.
  }

  // Ráfaga: VARIOS mensajes del mismo tono con micro-delays → se siente la MULTITUD
  // reaccionando (no todos en el mismo frame). Honesto: el `kind` ya viene filtrado.
  function burstChat(kind: ChatKind, count: number): void {
    const n = Math.max(1, count);
    for (let i = 0; i < n; i++) {
      if (i === 0) {
        spawnChat(kind);
      } else {
        after(() => spawnChat(kind), 70 + i * (60 + rnd(90))); // ~70–200ms escalonado.
      }
    }
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

  // ---- alertas sub/unsub HONESTAS (Twitch-like) ----
  // SUB = recompensa: SOLO cuando el jugador la rompe DE VERDAD (hito de combo alto
  // o hype en zona alta), con cooldown. UNSUB = castigo: SOLO cuando viene MAL DE
  // VERDAD (racha de MISS o hype desplomado), con cooldown. Reusan spawnAlert (y por
  // ende `after` trackeado → se limpian en stop()). Nada inventado, nada de spam.
  function spawnSubAlert(): void {
    const user = pick(CHAT_USERS);
    // ~30% "regalo de N meses" (resub), si no un sub nuevo. Honesto: es color de
    // recompensa, el copy es sabor. months 2..13.
    const text =
      Math.random() < 0.3
        ? `${user} se suscribió · ${2 + rnd(12)} meses`
        : `💜 ${user} se suscribió`;
    spawnAlert(text, SUB_COLOR);
  }
  function spawnUnsubAlert(): void {
    const user = pick(CHAT_USERS);
    const text = Math.random() < 0.5 ? `💔 ${user} se desuscribió` : `${user} dejó el canal`;
    spawnAlert(text, UNSUB_COLOR);
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

  // ---------------- reacción HONESTA a un veredicto real ----------------
  // El motor ya juzgó la nota; game.ts nos pasa el veredicto y el combo REALES.
  // Acá la capa reacciona con la VERDAD: nada de azar.
  function react(verdict: "PERFECT" | "GOOD" | "MISS", realCombo: number): void {
    combo = Math.max(0, realCombo); // combo REAL (= multiplicador del score).

    // ---- MISS: el hype se desploma, RÁFAGA negativa, glow del combo apagado ----
    if (verdict === "MISS") {
      // cuánto más alto venía el combo roto, más reacciona la multitud (2→4).
      const brokenStreak = combo; // combo ANTES de resetear (game.ts pasa el real).
      setHype(hype * 0.4 - 45); // caída fuerte (≈ -45 y ×0.4): perder duele.
      const missN = brokenStreak >= 8 ? 4 : brokenStreak >= 3 ? 3 : 2;
      burstChat("miss", missN); // VARIOS mensajes de decepción, no uno aislado.
      // mult vuelve al piso visual; el número de combo pierde su glow.
      refs.mult.textContent = "×1 PUNTOS";
      refs.mult.style.opacity = "0";
      refs.comboNum.style.transform = "scale(1)";
      refs.comboNum.style.filter = "none";

      // UNSUB HONESTO: viene MAL de verdad. Racha de ≥3 MISS seguidos, o el hype
      // recién desplomado bajo el piso. Con cooldown para no castigar cada nota.
      missStreak += 1;
      lastSubCombo = 0; // se cortó la racha buena: el próximo sub vuelve a exigir hito.
      const now = performance.now();
      const reallyBad = missStreak >= UNSUB_MISS_STREAK || hype <= UNSUB_HYPE_FLOOR;
      if (reallyBad && now - lastUnsubMs >= UNSUB_COOLDOWN) {
        lastUnsubMs = now;
        spawnUnsubAlert();
      }
      return;
    }

    // ---- acierto (PERFECT/GOOD): el hype sube según la calidad ----
    const isPerfect = verdict === "PERFECT";
    const h = heat(); // heat REAL = combo/12 (ya con el combo nuevo).
    // ganancia HONESTA con MOMENTUM: piso por acierto (+2 si PERFECT) + bonus·heat.
    // combo bajo (h→0) suma ~+9/11; combo alto (h→1) suma ~+19/21. La racha PESA:
    // encadenar combos hace que cada acierto valga más, así el hype trepa de verdad.
    setHype(hype + HYPE_GAIN_BASE + (isPerfect ? 2 : 0) + h * HYPE_GAIN_MOMENTUM);
    missStreak = 0; // un acierto corta cualquier racha de fallos.

    // MULTIPLICADOR honesto: ×{combo} literal (el combo ES el multiplicador del
    // score, ver main.ts applyResult). Piso ×1 cuando combo 0.
    refs.mult.textContent = `×${Math.max(1, combo)} PUNTOS`;
    refs.mult.style.opacity = combo >= 2 ? "1" : "0";

    // pop + glow del número de combo (es el MISMO #plg-combo del HUD). Sube con el
    // combo real → el destello es honesto: combo alto = más glow.
    refs.comboNum.style.transform = `scale(${(1.14 + h * 0.22).toFixed(3)})`;
    refs.comboNum.style.filter =
      h > 0.45 ? `drop-shadow(0 0 ${(8 + h * 22).toFixed(0)}px ${accent})` : "none";
    after(() => {
      refs.comboNum.style.transform = "scale(1)";
    }, 130);

    // emotes escalan con el combo real.
    const emoteN = 1 + Math.round(h * 3) + (isPerfect ? 1 : 0);
    for (let i = 0; i < emoteN; i++) spawnEmote(combo);

    // chat positivo HONESTO según la calidad del acierto:
    //  · PERFECT con combo alto (≥5) o hito de racha (cada 5) → RÁFAGA de euforia (2–3).
    //  · acierto normal (GOOD, o PERFECT con poco combo) → 1 mensaje, y no en cada nota.
    const isMilestone = combo > 0 && combo % 5 === 0;
    if (isPerfect && (combo >= 5 || isMilestone)) {
      burstChat("perfect", combo >= 10 ? 3 : 2); // euforia: la racha lo amerita.
    } else if (Math.random() < 0.45 + h * 0.45) {
      spawnChat("hit"); // acierto común: un grito suelto, sin saturar.
    }

    // hitos cada 5 de combo real.
    if (isMilestone) comboMilestone(combo);

    // SUB HONESTO: el jugador la está rompiendo DE VERDAD. Dispara al CRUZAR un hito
    // de combo (cada SUB_COMBO_STEP, una sola vez por hito) o con el hype en zona
    // alta. Cooldown para que NUNCA caiga en cada nota. honesto = solo si va bien.
    const now = performance.now();
    const crossedComboTier =
      combo >= SUB_COMBO_STEP && Math.floor(combo / SUB_COMBO_STEP) > Math.floor(lastSubCombo / SUB_COMBO_STEP);
    const onFire = hype >= SUB_HYPE_ZONE && combo >= 6; // hype alto respaldado por racha.
    if ((crossedComboTier || onFire) && now - lastSubMs >= SUB_COOLDOWN) {
      lastSubMs = now;
      lastSubCombo = combo;
      spawnSubAlert();
    }
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

    // grilla en perspectiva: opacity late con el beat + heat real (design lifeFx).
    refs.grid.style.opacity = (0.05 + beat * 0.07 + h * 0.12).toFixed(3);

    // speed lines: rampa con el heat REAL (combo alto → más líneas) (design lifeFx).
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
    missStreak = 0;
    lastSubMs = -1e9;
    lastUnsubMs = -1e9;
    lastSubCombo = 0;
    setHype(0);
    refs.mult.style.opacity = "0";
    refs.comboNum.style.transform = "scale(1)";
    refs.comboNum.style.filter = "none";

    // arranca el loop visual.
    rafId = requestAnimationFrame(frame);

    // decay lento de hype (HYPE_DECAY cada 240ms ≈ −2%/s). Loop visual legítimo:
    // si dejás de acertar, el hype baja solo (desde 80% tarda ~38 s en vaciarse). No
    // inventa rendimiento, pero es suave: el ritmo normal de juego (~4 s/acierto) no se
    // lo come. El MISS sigue desplomando fuerte aparte (ver react), eso NO cambia.
    every(() => {
      if (hype > 0) setHype(hype - HYPE_DECAY);
    }, 240);

    // goteo ambiental del chat — el feed SIEMPRE respira, a CUALQUIER hype (stream real:
    // nunca está vacío), pero el TONO sigue el hype HONESTAMENTE. Cada tick garantiza
    // ≥1 mensaje + chance de un 2º; con vida ~3.2–4.6s y tick ~1.4–2.4s eso sostiene
    // ~3–5 filas en idle sin caer nunca a 0. No auto-incrementa el combo ni inventa
    // rendimiento (el tono bajo JAMÁS celebra):
    //   · hype alto (>70)  → animado/positivo (venís bien, el chat lo celebra).
    //   · hype medio       → neutral/variado (a veces un "hit" suelto, nada eufórico).
    //   · hype bajo (<25)  → NEUTRAL/realista (expectativa, charla, crítica suave); nunca euforia.
    function ambientTick(): void {
      if (!running) return;
      const h = heat();
      if (hype > 70) {
        // racha buena: aplauso honesto (siempre 1) + a veces un 2º, + emote si el heat respalda.
        spawnChat("hit");
        if (Math.random() < 0.5) spawnChat(Math.random() < 0.7 ? "hit" : "neutral");
        if (h > 0.5 && Math.random() < h) spawnEmote(combo);
      } else if (hype >= 25) {
        // zona media: mayormente neutral, con algún positivo aislado (sin euforia).
        spawnChat(Math.random() < 0.3 ? "hit" : "neutral");
        if (Math.random() < 0.4) spawnChat("neutral"); // 2º ocasional para poblar el feed.
      } else {
        // arranque / racha de fallos: SOLO charla neutral, pero CONSTANTE (un chat real
        // no se calla porque al jugador le vaya mal). Siempre 1, a veces 2.
        spawnChat("neutral");
        if (Math.random() < 0.4) spawnChat("neutral");
      }
      after(ambientTick, 1400 + rnd(1000)); // 1.4–2.4s, jittered.
    }

    // PRECARGA: sembrá unos neutrales escalonados para que al ENTRAR a la partida el
    // chat ya esté poblado (sin los primeros segundos vacíos). 150/320/520ms aprox.
    const seed = 2 + rnd(2); // 2–3 mensajes de entrada.
    for (let i = 0; i < seed; i++) {
      after(() => { if (running) spawnChat("neutral"); }, 150 + i * (170 + rnd(80)));
    }
    after(ambientTick, 500 + rnd(500)); // primer tick pronto: el goteo arranca enseguida.
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
    missStreak = 0;
    lastSubMs = -1e9;
    lastUnsubMs = -1e9;
    lastSubCombo = 0;
  }

  function setAccent(hex: string): void {
    accent = hex;
    // la grilla usa --accent (heredado del root), así que no hace falta tocarla acá;
    // el combo-flair y el glow del combo se recolorean en su próximo spawn/hit.
  }

  return { start, stop, react, setAccent };
}
