// song.ts — La DIFICULTAD como una rampa: dada una intensidad 0..1 (qué tan "a
// tope" está el momento), devuelve cuántas flechas y cada cuántos beats. Hoy esa
// intensidad viene de la ENERGÍA de la música (ver energy.ts). Cada dificultad
// define el piso (música calma) y el techo (música a tope). Todo puro: se testea
// sin audio ni navegador.

export type DifficultyName = "easy" | "normal" | "hard";

/**
 * La dificultad como una RAMPA, no como números fijos. Con la música calma
 * (intensidad 0) se teclean `seqStart` flechas cada `stepStart` beats — suave.
 * Con la música a tope (intensidad 1) se llega a `seqEnd` flechas cada `stepEnd`
 * beats — el techo de esta dificultad. Entre medio se interpola lineal.
 *
 * OJO: `stepEnd` (lo más rápido) NO debe bajar de APPROACH_BEATS (4) del runner:
 * el cabezal de la barra de timing necesita esos beats para viajar hasta el
 * commit. Si dos secuencias quedaran a menos de 4 beats, se pisarían.
 */
export interface DifficultyPreset {
  name: DifficultyName;
  label: string; // lo que ve el jugador: "Fácil" | "Medio" | "Experto"
  seqStart: number; // flechas con la música calma (intensidad 0)
  seqEnd: number; // flechas con la música a tope (intensidad 1) — el techo
  stepStart: number; // beats entre secuencias, música calma (más = espaciado)
  stepEnd: number; // beats entre secuencias, música a tope (menos = más seguido)
}

/**
 * Presets globales. Cualquier canción se puede jugar en cualquiera de los tres.
 * Estos números SON el balance del juego: tuneables, no sagrados.
 */
export const DIFFICULTIES: Record<DifficultyName, DifficultyPreset> = {
  easy: { name: "easy", label: "Fácil", seqStart: 1, seqEnd: 3, stepStart: 8, stepEnd: 6 },
  normal: { name: "normal", label: "Medio", seqStart: 3, seqEnd: 5, stepStart: 8, stepEnd: 5 },
  hard: { name: "hard", label: "Experto", seqStart: 4, seqEnd: 8, stepStart: 8, stepEnd: 4 },
};

/** La densidad instantánea de la rampa para una intensidad dada. */
export interface Ramp {
  sequenceLength: number; // cuántas flechas teclear en esta secuencia
  barStep: number; // cada cuántos beats cae la próxima secuencia
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
 */
export function rampAt(intensity: number, preset: DifficultyPreset): Ramp {
  const t = Math.max(0, Math.min(1, intensity));
  return {
    sequenceLength: Math.max(1, lerpRound(preset.seqStart, preset.seqEnd, t)),
    barStep: Math.max(1, lerpRound(preset.stepStart, preset.stepEnd, t)),
  };
}
