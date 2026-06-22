// song.ts — De un Chart suelto a una CANCIÓN con varias dificultades.
// Una Song es metadata + audio; los charts se GENERAN por dificultad desde la
// grilla del BPM. Todo puro: se testea sin audio ni navegador, como siempre.

import type { Arrow, Bar, Chart } from "./chart";

export type DifficultyName = "easy" | "normal" | "hard";

/** Las perillas que definen qué tan complejo es un chart generado. */
export interface DifficultyPreset {
  name: DifficultyName;
  level: number; // 1-10, solo para mostrar
  beatsPerCommit: number; // cada cuántos beats hay una confirmación (menos = más denso)
  sequenceLength: number; // flechas por barra
}

/**
 * Presets globales. Cualquier canción se puede jugar en cualquiera de los tres.
 * Estos números SON el balance del juego: tuneables, no sagrados.
 */
export const DIFFICULTIES: Record<DifficultyName, DifficultyPreset> = {
  easy: { name: "easy", level: 2, beatsPerCommit: 8, sequenceLength: 2 },
  normal: { name: "normal", level: 5, beatsPerCommit: 4, sequenceLength: 4 },
  hard: { name: "hard", level: 8, beatsPerCommit: 2, sequenceLength: 6 },
};

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
 * Genera el Chart de una canción en una dificultad, poniendo una barra cada
 * `beatsPerCommit` beats sobre la grilla del BPM. `randomArrow` se INYECTA para
 * poder testear con una secuencia determinista (mismo truco que el reloj falso).
 */
export function buildChart(
  song: Song,
  difficulty: DifficultyPreset,
  randomArrow: () => Arrow,
): Chart {
  const bars: Bar[] = [];
  for (
    let beat = difficulty.beatsPerCommit;
    beat <= song.durationBeats;
    beat += difficulty.beatsPerCommit
  ) {
    const sequence: Arrow[] = [];
    for (let i = 0; i < difficulty.sequenceLength; i += 1) sequence.push(randomArrow());
    bars.push({ commitBeat: beat, sequence });
  }
  return {
    title: `${song.title} [${difficulty.name}]`,
    bpm: song.bpm,
    offset: song.offset,
    bars,
  };
}
