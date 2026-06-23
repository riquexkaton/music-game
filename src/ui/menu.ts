// menu.ts — Pantallas START y SONG SELECT con estética "Pulse".
// No conoce el motor: recibe hooks (canciones reales + callbacks) e invoca los
// seams de main.ts (selectSong / play). El gameplay/editor viejo vive en #screen-game.

import "./pulse.css";
import type { SongConfig } from "../storage";

const ACCENTS = ["#c8ff1e", "#25e0ff", "#ff2e9a", "#ffd021", "#a78bfa", "#ff7847"];
const ARROW_GLYPHS = ["←", "↑", "→", "↓"];

export interface MenuHooks {
  /** Lista actual de canciones (se relee en cada render). */
  getSongs: () => SongConfig[];
  /** El usuario resaltó/eligió una canción (marca currentSong en el motor). */
  onSelect: (song: SongConfig) => void;
  /** El usuario confirmó: arrancar el juego con esa canción. */
  onPlay: (song: SongConfig) => void;
  /** El usuario quiere sincronizar una canción bloqueada: llevarlo al editor. */
  onSync: (song: SongConfig) => void;
}

export interface MenuApi {
  showStart: () => void;
  showSelect: () => void;
  showGame: () => void;
  /** Pantalla de gameplay real (#screen-play). */
  showPlay: () => void;
  /** Pantalla de resultados (#screen-result). */
  showResult: () => void;
  /** El acento de la card actualmente seleccionada (para teñir play/result). */
  currentAccent: () => string;
  /** Re-renderiza las cards (p. ej. tras subir una canción). */
  refresh: () => void;
}

type Screen = "start" | "select" | "game" | "play" | "result";

// Lenis (smooth scroll) llega por CDN en index.html. Tipado mínimo + fallback nativo.
interface LenisLike {
  raf: (time: number) => void;
  scrollTo: (target: Element, opts?: { offset?: number }) => void;
  destroy: () => void;
}
type LenisCtor = new (opts: Record<string, unknown>) => LenisLike;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      default: return "&quot;";
    }
  });
}

export function initMenu(hooks: MenuHooks): MenuApi {
  const $ = (id: string): HTMLElement => document.getElementById(id)!;
  const startScreen = $("screen-start");
  const selectScreen = $("screen-select");
  const gameScreen = $("screen-game");
  const playScreen = $("screen-play");
  const resultScreen = $("screen-result");

  let current: Screen = "start";
  let sel = 0;
  let lenis: LenisLike | null = null;
  let rafId = 0;

  // ---------- helpers de datos (siempre reales) ----------
  const songs = (): SongConfig[] => hooks.getSongs();
  const accentFor = (i: number): string => ACCENTS[i % ACCENTS.length]!;
  const bpmOf = (s: SongConfig): number | null =>
    s.tempoSource !== "none" && s.bpm > 0 ? Math.round(s.bpm) : null;
  const statusOf = (s: SongConfig): string =>
    s.tempoSource === "manual" ? "SYNC ✓" : s.tempoSource === "auto" ? "AUTO" : "SIN SYNC";
  /** Solo las sincronizadas A MANO son jugables: el tempo auto deriva y come misses
   *  (un error de 0.3 BPM ya son ~280 ms de desfase a los 2 min). */
  const isPlayable = (s: SongConfig): boolean => s.tempoSource === "manual";
  const segsOf = (s: SongConfig): number => {
    const b = bpmOf(s);
    if (!b) return 0;
    return b < 100 ? 2 : b < 130 ? 3 : 5;
  };

  // ---------- START ----------
  startScreen.innerHTML = `
    <div class="pl-start" id="pl-start-body">
      <div class="pl-eyebrow">[ JUEGO DE RITMO ]</div>
      <h1 class="pl-logo">PULSE<span class="pl-dot">.</span></h1>
      <div class="pl-system-word">SYSTEM</div>
      <div class="pl-play-block">
        <div class="pl-play">
          <div class="pl-play-icon">►</div>
          <div class="pl-play-label">JUGAR</div>
        </div>
        <div class="pl-start-hint">CLICK O PRESIONÁ <span class="pl-kbd">ENTER</span> <span class="pl-cursor">_</span></div>
      </div>
      <div class="pl-start-foot" id="pl-start-foot"></div>
      <button class="pl-edit-link" id="pl-edit-link" type="button">✎ EDITOR</button>
    </div>`;
  $("pl-start-body").addEventListener("click", () => transitionToSelect());
  $("pl-edit-link").addEventListener("click", (e) => {
    e.stopPropagation(); // que no dispare el "JUGAR" del cuerpo
    location.hash = "#editor";
  });

  function updateStartFoot(): void {
    const n = songs().length;
    $("pl-start-foot").innerHTML =
      `<span>${n} ${n === 1 ? "PISTA" : "PISTAS"}</span><span class="sep">·</span>` +
      `<span>NORMAL → EXPERT</span><span class="sep">·</span><span>v1.0</span>`;
  }

  // ---------- SONG SELECT (estructura fija; las cards se rellenan) ----------
  selectScreen.innerHTML = `
    <div class="pl-select-head">
      <button class="pl-back" id="pl-back">◄ ATRÁS</button>
      <div class="pl-select-title">Seleccionar pista</div>
      <div class="pl-grow"></div>
      <div class="pl-select-hints">↑↓ ←→ NAVEGAR · ENTER JUGAR</div>
    </div>
    <div class="pl-masonry-wrap" id="pl-scroll">
      <div class="pl-masonry" id="pl-masonry"></div>
    </div>
    <div class="pl-actionbar" id="pl-actionbar"></div>`;
  const masonry = $("pl-masonry");
  const scrollWrap = $("pl-scroll");
  const actionbar = $("pl-actionbar");
  $("pl-back").addEventListener("click", (e) => {
    e.stopPropagation();
    showStart();
  });

  function renderCards(): void {
    const list = songs();
    if (sel >= list.length) sel = Math.max(0, list.length - 1);
    masonry.innerHTML = "";
    list.forEach((song, i) => {
      const feature = i % 4 === 0;
      const card = document.createElement("div");
      card.className = `pl-card${feature ? " feature" : ""}${i === sel ? " on" : ""}${isPlayable(song) ? "" : " locked"}`;
      card.style.setProperty("--accent", accentFor(i));
      card.style.animationDelay = `${120 + i * 75}ms`;
      card.dataset.idx = String(i);
      const bpm = bpmOf(song);
      const segs = Array.from(
        { length: 5 },
        (_, k) => `<span class="pl-seg${k < segsOf(song) ? " on" : ""}"></span>`,
      ).join("");
      const arrows = feature
        ? `<div class="pl-arrows">${ARROW_GLYPHS.map((a) => `<span class="pl-arrow">${a}</span>`).join("")}</div>`
        : "";
      card.innerHTML = `
        <div class="pl-card-head">
          <div class="pl-card-meta"><span>PISTA ${String(i + 1).padStart(2, "0")}</span><span>${statusOf(song)}</span></div>
          <div class="pl-card-title">${escapeHtml(song.title)}</div>
          <div class="pl-card-artist">${song.source === "uploaded" ? "SUBIDA" : "BUILTIN"}</div>
        </div>
        <div class="pl-card-body">
          ${arrows}
          <div class="pl-card-foot">
            <div><div class="pl-bpm-label">BPM</div><div class="pl-bpm">${bpm ?? "—"}</div></div>
            <div class="pl-segs">${segs}</div>
          </div>
        </div>
        ${isPlayable(song) ? "" : `<div class="pl-lock"><span class="pl-lock-ico">🔒</span> SINCRONIZAR</div>`}`;
      card.addEventListener("click", () => pick(i));
      masonry.appendChild(card);
    });
    renderActionbar();
  }

  function renderActionbar(): void {
    const list = songs();
    const song = list[sel];
    if (!song) {
      actionbar.innerHTML = `<div class="pl-empty">— sin canciones —</div>`;
      return;
    }
    actionbar.style.setProperty("--accent", accentFor(sel));
    const bpm = bpmOf(song);
    actionbar.innerHTML = `
      <div class="pl-actionbar-accent"></div>
      <div class="pl-sel-info">
        <div class="pl-sel-label">PISTA ${String(sel + 1).padStart(2, "0")} SELECCIONADA</div>
        <div class="pl-sel-title">${escapeHtml(song.title)}</div>
      </div>
      <div class="pl-sel-meta">
        <div class="pl-sel-sub">${statusOf(song)}${bpm ? ` · ${bpm} BPM` : ""}</div>
      </div>
      <div class="pl-grow"><span class="pl-scroll-hint">DESLIZÁ / SCROLL ↔ PARA EXPLORAR</span></div>
      ${isPlayable(song)
        ? `<button class="pl-play-cta" id="pl-play-cta"><span>►</span><span>JUGAR</span></button>`
        : `<button class="pl-play-cta locked" id="pl-play-cta"><span>🔒</span><span>SINCRONIZAR</span></button>`}`;
    $("pl-play-cta").addEventListener("click", (e) => {
      e.stopPropagation();
      confirmPlay();
    });
  }

  function pick(i: number): void {
    sel = i;
    masonry.querySelectorAll<HTMLElement>(".pl-card").forEach((el) => {
      el.classList.toggle("on", Number(el.dataset.idx) === i);
    });
    renderActionbar();
    const song = songs()[i];
    if (song) hooks.onSelect(song);
  }

  function move(delta: number): void {
    const n = songs().length;
    if (n === 0) return;
    pick((sel + delta + n) % n);
    scrollToSel(sel);
  }

  function scrollToSel(i: number): void {
    const card = masonry.querySelector<HTMLElement>(`[data-idx="${i}"]`);
    if (!card) return;
    if (lenis) lenis.scrollTo(card, { offset: -140 });
    else card.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }

  function confirmPlay(): void {
    const song = songs()[sel];
    if (!song) return;
    hooks.onSelect(song);
    // Bloqueada (sin sync manual): en vez de jugar mal, la mandamos a sincronizar.
    if (!isPlayable(song)) {
      hooks.onSync(song);
      return;
    }
    transitionToGame(song);
  }

  // ---------- Lenis ----------
  function initLenis(tries = 0): void {
    if (lenis) return;
    const Lenis = (window as unknown as { Lenis?: LenisCtor }).Lenis;
    if (!Lenis) {
      if (tries < 50) window.setTimeout(() => initLenis(tries + 1), 100);
      return;
    }
    lenis = new Lenis({
      wrapper: scrollWrap,
      content: masonry,
      orientation: "horizontal",
      gestureOrientation: "both",
      smoothWheel: true,
      lerp: 0.085,
      wheelMultiplier: 1.1,
      duration: 1.1,
    });
    const raf = (time: number): void => {
      if (!lenis) return;
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    };
    rafId = requestAnimationFrame(raf);
  }
  function destroyLenis(): void {
    if (rafId) cancelAnimationFrame(rafId);
    if (lenis) {
      try {
        lenis.destroy();
      } catch {
        /* noop */
      }
      lenis = null;
    }
  }

  // ---------- transición wipe ----------
  function wipe(): void {
    const el = document.createElement("div");
    el.className = "pl-wipe";
    el.innerHTML = `<div class="pl-wipe-b-layer"></div><div class="pl-wipe-a-layer"><span>PULSE<span class="pl-dot">.</span></span></div>`;
    document.body.appendChild(el);
    window.setTimeout(() => el.remove(), 760);
  }

  function transitionToSelect(): void {
    wipe();
    window.setTimeout(() => showSelect(), 260);
  }
  function transitionToGame(song: SongConfig): void {
    wipe();
    window.setTimeout(() => {
      // El motor (onPlay) decide la pantalla real (showPlay). Sólo disparamos el play.
      hooks.onPlay(song);
    }, 360);
  }

  // ---------- teclado ----------
  window.addEventListener("keydown", (e) => {
    if (current === "start") {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        transitionToSelect();
      }
    } else if (current === "select") {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        move(1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        move(-1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        confirmPlay();
      } else if (e.key === "Escape") {
        showStart();
      }
    }
  });

  // ---------- router ----------
  function setScreen(s: Screen): void {
    current = s;
    startScreen.classList.toggle("hidden", s !== "start");
    selectScreen.classList.toggle("hidden", s !== "select");
    gameScreen.classList.toggle("hidden", s !== "game");
    playScreen.classList.toggle("hidden", s !== "play");
    resultScreen.classList.toggle("hidden", s !== "result");
  }
  function showStart(): void {
    destroyLenis();
    updateStartFoot();
    setScreen("start");
  }
  function showSelect(): void {
    setScreen("select");
    renderCards();
    requestAnimationFrame(() => {
      initLenis();
      scrollToSel(sel);
    });
  }
  function showGame(): void {
    destroyLenis();
    setScreen("game");
  }
  function showPlay(): void {
    destroyLenis();
    setScreen("play");
  }
  function showResult(): void {
    destroyLenis();
    setScreen("result");
  }
  function currentAccent(): string {
    return accentFor(sel);
  }

  function refresh(): void {
    updateStartFoot();
    renderCards();
  }

  updateStartFoot();
  return { showStart, showSelect, showGame, showPlay, showResult, currentAccent, refresh };
}
