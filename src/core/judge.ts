// judge.ts — EL JUEZ. Función pura: dada la distancia al beat, devuelve la nota.
// Nada de estado, nada de DOM, nada de audio. Por eso se testea en milisegundos.

export type Grade = "perfect" | "cool" | "good" | "miss";

/**
 * Ventanas de timing en SEGUNDOS (medio-ancho a cada lado del beat).
 * Ordenadas de la más exigente a la más laxa. Estos números son el "feel"
 * del juego: más chico = más difícil. Después los calibrás a gusto.
 */
export const TIMING_WINDOWS: ReadonlyArray<{ grade: Grade; window: number }> = [
  { grade: "perfect", window: 0.045 },
  { grade: "cool", window: 0.09 },
  { grade: "good", window: 0.135 },
];

/**
 * Juzga un input según su distancia (en segundos) al beat objetivo.
 * `delta = tiempoDelInput - tiempoDelObjetivo`. El signo no afecta la nota
 * (apretar antes o después se castiga igual), por eso tomamos el valor absoluto.
 */
export function judge(delta: number): Grade {
  const d = Math.abs(delta);
  for (const { grade, window } of TIMING_WINDOWS) {
    if (d <= window) return grade;
  }
  return "miss";
}

/** Puntaje base por nota. El combo lo multiplica afuera, en el scoring. */
export const GRADE_SCORE: Record<Grade, number> = {
  perfect: 1000,
  cool: 500,
  good: 100,
  miss: 0,
};
