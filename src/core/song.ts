// song.ts — De un Chart suelto a una CANCIÓN con dificultad PROGRESIVA.
// La dificultad ya no es un número fijo: la cantidad de flechas y la frecuencia
// de las secuencias CRECEN a medida que avanza la canción (0% → 100%). Cada
// dificultad define hasta dónde trepa esa rampa (su "techo"). Todo puro: se
// testea sin audio ni navegador, como siempre.

import type { Arrow, Bar, Chart } from "./chart";

export type DifficultyName = "easy" | "normal" | "hard";

/**
 * La dificultad como una RAMPA, no como números fijos. Al empezar la canción
 * (progress 0) se teclean `seqStart` flechas cada `stepStart` beats — suave. Al
 * final (progress 1) se llega a `seqEnd` flechas cada `stepEnd` beats — el techo
 * de esta dificultad. Entre medio se interpola lineal.
 *
 * OJO: `stepEnd` (lo más rápido) NO debe bajar de APPROACH_BEATS (4) del runner:
 * el cabezal de la barra de timing necesita esos beats para viajar hasta el
 * commit. Si dos secuencias quedaran a menos de 4 beats, se pisarían.
 */
export interface DifficultyPreset {
  name: DifficultyName;
  label: string; // lo que ve el jugador: "Fácil" | "Medio" | "Experto"
  seqStart: number; // flechas al empezar (0%)
  seqEnd: number; // flechas al final (100%) — el techo
  stepStart: number; // beats entre secuencias al empezar (más = espaciado)
  stepEnd: number; // beats entre secuencias al final (menos = más seguido)
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

/** La intensidad instantánea de la rampa en un punto del avance. */
export interface Ramp {
  sequenceLength: number; // cuántas flechas teclear en esta secuencia
  barStep: number; // cada cuántos beats cae la próxima secuencia
}

/** Interpola lineal entre a y b según t (0..1), redondeando al entero más cercano. */
function lerpRound(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/**
 * El avance (0..1) al que se alcanza el TECHO de la rampa. Pasado este punto, la
 * dificultad se queda en su máximo hasta el final (meseta): el jugador llega a la
 * intensidad máxima al 60% de la canción, no recién sobre el final.
 */
const PEAK_AT = 0.6;

/**
 * La rampa en un punto del avance. El progreso se "estira" para que el techo se
 * alcance en PEAK_AT (no al 100%) y se clampa a [0,1]: nunca por debajo del piso
 * ni por encima del techo. Pura y determinista — el corazón compartido por el
 * runner (en vivo) y por buildChart (para los tests).
 */
export function rampAt(progress: number, preset: DifficultyPreset): Ramp {
  const t = Math.max(0, Math.min(1, progress / PEAK_AT));
  return {
    sequenceLength: Math.max(1, lerpRound(preset.seqStart, preset.seqEnd, t)),
    barStep: Math.max(1, lerpRound(preset.stepStart, preset.stepEnd, t)),
  };
}

/** Una canción: el audio + su metadata. El BPM puede venir de detección. */
export interface Song {
  id: string;
  title: string;
  artist?: string;
  audioUrl: string;
  bpm: number;
  offset: number; // segundos hasta el beat 1 (se afina a mano: detección no lo da)
  durationBeats: number; // beats jugables (= duración del audio / secondsPerBeat)
}

/**
 * Genera el Chart completo de una canción en una dificultad, CAMINANDO la grilla
 * con la rampa: cada barra usa la cantidad de flechas y el espaciado que toca en
 * su punto de avance. Las barras NO quedan equiespaciadas (se juntan hacia el
 * final). `randomArrow` se inyecta para testear con una secuencia determinista.
 */
export function buildChart(
  song: Song,
  difficulty: DifficultyPreset,
  randomArrow: () => Arrow,
): Chart {
  const bars: Bar[] = [];
  let beat = rampAt(0, difficulty).barStep; // primera barra tras el espaciado inicial
  while (beat <= song.durationBeats) {
    const progress = song.durationBeats > 0 ? beat / song.durationBeats : 0;
    const { sequenceLength, barStep } = rampAt(progress, difficulty);
    const sequence: Arrow[] = [];
    for (let i = 0; i < sequenceLength; i += 1) sequence.push(randomArrow());
    bars.push({ commitBeat: beat, sequence });
    beat += barStep;
  }
  return {
    title: `${song.title} [${difficulty.label}]`,
    bpm: song.bpm,
    offset: song.offset,
    bars,
  };
}
