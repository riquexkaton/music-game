// play.ts — La lógica de "qué pasó cuando el jugador confirmó".
// Antes esto vivía ENTERRADO dentro de main.ts (atado al DOM) y por eso no se
// podía testear. Lo extrajimos al dominio como función PURA: entra un chart y
// un instante, sale el resultado. Sin DOM, sin audio. Ahora SÍ se prueba.

import { type Chart, beatToSeconds, secondsToBeat } from "./chart";
import { judge, type Grade } from "./judge";

export interface CommitResult {
  /** El beat (entero) más cercano que el jugador intentó clavar. */
  beat: number;
  /** Distancia en segundos: negativo = temprano, positivo = tarde. */
  delta: number;
  grade: Grade;
}

/**
 * Dado el chart y el instante (en segundos de la canción) en que el jugador
 * apretó ESPACIO, busca el beat más cercano y lo juzga. 100% determinista.
 * `inputOffset` (seg) corrige la latencia medida del jugador: se RESTA a su
 * input antes de juzgar, sin tocar el beep. Por defecto 0 = sin calibrar.
 */
export function judgeCommit(
  chart: Chart,
  inputTime: number,
  inputOffset = 0,
): CommitResult {
  // Clave de la calibración: ajustamos SOLO el momento de la tecla del jugador.
  // El beep no se mueve, así que no hay re-sincronización ni círculo vicioso.
  const adjusted = inputTime - inputOffset;
  const nearestBeat = Math.round(secondsToBeat(chart, adjusted));
  const targetTime = beatToSeconds(chart, nearestBeat);
  const delta = adjusted - targetTime;
  return { beat: nearestBeat, delta, grade: judge(delta) };
}

export interface BarResult {
  grade: Grade;
  /** Distancia en segundos al commitBeat (negativo = temprano). */
  delta: number;
  /** Si la secuencia de flechas estaba bien cargada al confirmar. */
  sequenceOk: boolean;
}

/**
 * Juzga la confirmación de UNA barra concreta (estilo Audition): combina el
 * timing del ESPACIO contra su `commitBeat` con si la secuencia estaba lista.
 * Regla dura: si la secuencia no se cargó bien, el timing no importa, es MISS.
 */
export function judgeBarCommit(
  chart: Chart,
  commitBeat: number,
  sequenceReady: boolean,
  inputTime: number,
  inputOffset = 0,
): BarResult {
  const adjusted = inputTime - inputOffset;
  const targetTime = beatToSeconds(chart, commitBeat);
  const delta = adjusted - targetTime;
  const grade = sequenceReady ? judge(delta) : "miss";
  return { grade, delta, sequenceOk: sequenceReady };
}
