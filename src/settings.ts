// settings.ts — Ajustes GLOBALES de la app (persistidos en localStorage).
//
// Hoy sólo guarda la SKIN del gameplay (#screen-play). Mismo patrón simple que
// `inputOffset` en main.ts: una clave por ajuste, lectura tolerante a valores viejos
// o corruptos (cae al default). No conoce el juego ni el DOM: es pura persistencia.

/** Piel del gameplay: la clásica del proyecto o la "Alt 2 · Streamer" de Claude Design. */
export type GameSkin = "classic" | "alt2";

const SKIN_KEY = "ritmo:gameSkin";
const DEFAULT_SKIN: GameSkin = "classic";

/** Lee la skin guardada. Cualquier valor desconocido/ausente → default (compat). */
export function loadSkin(): GameSkin {
  const raw = localStorage.getItem(SKIN_KEY);
  return raw === "classic" || raw === "alt2" ? raw : DEFAULT_SKIN;
}

/** Persiste la skin elegida. */
export function saveSkin(skin: GameSkin): void {
  localStorage.setItem(SKIN_KEY, skin);
}
