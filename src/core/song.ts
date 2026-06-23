// song.ts — La DIFICULTAD define cuántas flechas tiene cada secuencia: dada una
// intensidad 0..1 (qué tan "a tope" está el momento, hoy la ENERGÍA de la música),
// devuelve la cantidad de flechas. El ESPACIADO entre secuencias es FIJO — la
// energía NO lo toca. Todo puro: se testea sin audio ni navegador.

export type DifficultyName = "easy" | "normal" | "hard";

// Espaciado FIJO entre secuencias, en beats. Son 2 compases (múltiplo de
// BEATS_PER_BAR=4 en main.ts → cada commit cae en un downbeat, la grilla musical
// estilo Audition). Es constante a propósito: el ritmo no se acelera con la
// energía, solo cambia la cantidad de flechas. Cadencia: compás activo + descanso.
const SPACING_BEATS = 8;

/**
 * La dificultad define el RANGO de flechas por secuencia. Con la música calma
 * (intensidad 0) se teclean `seqStart` flechas; con la música a tope (intensidad
 * 1) se llega a `seqEnd` — el techo de esta dificultad. Entre medio se interpola.
 * El espaciado entre secuencias NO depende de esto: es fijo (SPACING_BEATS).
 */
export interface DifficultyPreset {
  name: DifficultyName;
  label: string; // lo que ve el jugador: "Fácil" | "Medio" | "Experto"
  seqStart: number; // flechas con la música calma (intensidad 0)
  seqEnd: number; // flechas con la música a tope (intensidad 1) — el techo
}

/**
 * Presets globales. Cualquier canción se puede jugar en cualquiera de los tres.
 * Estos números SON el balance del juego: tuneables, no sagrados.
 */
export const DIFFICULTIES: Record<DifficultyName, DifficultyPreset> = {
  easy: { name: "easy", label: "Fácil", seqStart: 1, seqEnd: 3 },
  normal: { name: "normal", label: "Medio", seqStart: 3, seqEnd: 5 },
  hard: { name: "hard", label: "Experto", seqStart: 4, seqEnd: 8 },
};

/** La densidad instantánea de la rampa para una intensidad dada. */
export interface Ramp {
  sequenceLength: number; // cuántas flechas teclear en esta secuencia
  barStep: number; // cada cuántos beats cae la próxima secuencia (FIJO)
}

/** Interpola lineal entre a y b según t (0..1), redondeando al entero más cercano. */
function lerpRound(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/**
 * La densidad para una INTENSIDAD (0..1): 0 = música calma → piso del preset;
 * 1 = música a tope → techo. Se clampa a [0,1]. Pura y determinista — el corazón
 * que comparte el runner con cualquier fuente de intensidad (hoy, la energía del
 * audio en energy.ts).
 *
 * La energía maneja SOLO la CANTIDAD de flechas (sequenceLength). El espaciado
 * (barStep) es FIJO en SPACING_BEATS: así el ritmo no se acelera y cada commit
 * cae en un downbeat.
 */
export function rampAt(intensity: number, preset: DifficultyPreset): Ramp {
  const t = Math.max(0, Math.min(1, intensity));
  return {
    sequenceLength: Math.max(1, lerpRound(preset.seqStart, preset.seqEnd, t)),
    barStep: SPACING_BEATS,
  };
}
