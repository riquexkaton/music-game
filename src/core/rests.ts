// rests.ts — DESCANSOS puntuales. El usuario marca en qué beat empieza cada
// descanso y cuánto dura (en beats). El runner consulta esta lista: si el beat
// actual cae dentro de un descanso, no tira flechas. Pura: cero DOM, cero audio.

export interface Rest {
  /** Beat donde empieza el descanso. */
  atBeat: number;
  /** Cuánto dura, en beats. */
  durationBeats: number;
}

/** El descanso que CUBRE este beat, o null si en este beat se juega. */
export function restAt(beat: number, rests: Rest[]): Rest | null {
  for (const r of rests) {
    if (beat >= r.atBeat && beat < r.atBeat + r.durationBeats) return r;
  }
  return null;
}

/**
 * El beat donde TERMINA el descanso activo (para saltarlo). Si en `beat` no hay
 * descanso, devuelve el mismo `beat`. Encadena descansos pegados, por las dudas.
 */
export function restEndBeat(beat: number, rests: Rest[]): number {
  let b = beat;
  let r = restAt(b, rests);
  while (r) {
    b = r.atBeat + r.durationBeats;
    r = restAt(b, rests);
  }
  return b;
}

/** Copia ordenada por `atBeat` (para mostrar y guardar prolijo). */
export function sortRests(rests: Rest[]): Rest[] {
  return [...rests].sort((a, b) => a.atBeat - b.atBeat);
}
