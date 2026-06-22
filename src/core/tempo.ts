// tempo.ts — Detecta BPM + offset desde "anclas" que el jugador marca tocando
// los downbeats. Pura lógica de dominio: cero DOM, cero audio. Entran tiempos
// (segundos) y beats, sale una recta. El modelo es EL MISMO que el del chart:
//   t(beat) = offset + beat * (60 / bpm)
// o sea una recta y = a*x + b con x=beatIndex, y=timeSec, a=segundosPorBeat.

import { median } from "./calibration";

/** Una ancla: el jugador dice "este downbeat (beatIndex) cayó en este timeSec". */
export interface Anchor {
  beatIndex: number;
  timeSec: number;
}

/**
 * El resultado de ajustar la recta a las anclas. Además del BPM y el offset,
 * trae métricas de confianza para que la UI sepa si fiarse o pedir más taps.
 */
export interface TempoFit {
  bpm: number;
  offset: number;
  /** R² del ajuste (1 = recta perfecta). null si hay <3 anclas (degenerado). */
  rSquared: number | null;
  /** Desvío residual en milisegundos. null si hay <3 anclas (degenerado). */
  residualMs: number | null;
  anchorCount: number;
  /** Rango temporal cubierto por las anclas (max - min timeSec), en segundos. */
  spanSec: number;
}

/**
 * Regresión lineal por mínimos cuadrados (forma de Nayuki) sobre (x=beatIndex,
 * y=timeSec), modelo y = a*x + b. La pendiente a son los segundos por beat, así
 * que bpm = 60/a; la ordenada b es el offset.
 *
 * Casos borde (NUNCA devolvemos NaN/Infinity): con <2 anclas, determinante ~0
 * o pendiente <=0 (datos sin información de tempo) caemos a un fit "seguro"
 * con bpm 120 y el offset apuntando al primer tap.
 *
 * Confianza: SOLO la calculamos con n>=3. Con 2 puntos la recta SIEMPRE es
 * perfecta (R²=1 trivial) y el desvío residual divide por (n-2)=0 => NaN; son
 * casos degenerados, así que ahí devolvemos null en vez de mentir.
 */
export function fitTempo(anchors: Anchor[]): TempoFit {
  const n = anchors.length;
  const spanSec = n === 0 ? 0 : spanOf(anchors);

  // Acumuladores de la regresión (forma de Nayuki).
  let Sx = 0;
  let Sy = 0;
  let Sxx = 0;
  let Syy = 0;
  let Sxy = 0;
  for (const { beatIndex: x, timeSec: y } of anchors) {
    Sx += x;
    Sy += y;
    Sxx += x * x;
    Syy += y * y;
    Sxy += x * y;
  }

  const D = n * Sxx - Sx * Sx;
  const a = (n * Sxy - Sx * Sy) / D;
  const b = (Sy * Sxx - Sx * Sxy) / D;

  // Datos sin información de tempo: caemos al fit seguro (sin seed acá => 120).
  if (n < 2 || Math.abs(D) < 1e-9 || a <= 0) {
    return {
      bpm: 120,
      offset: anchors[0]?.timeSec ?? 0,
      rSquared: null,
      residualMs: null,
      anchorCount: n,
      spanSec,
    };
  }

  const bpm = 60 / a;
  const offset = b;

  // Confianza: solo con n>=3 (con n<3 es degenerado, ver JSDoc).
  let rSquared: number | null = null;
  let residualMs: number | null = null;
  if (n >= 3) {
    const Vxx = n * Sxx - Sx * Sx;
    const Vyy = n * Syy - Sy * Sy;
    const Vxy = n * Sxy - Sx * Sy;
    rSquared = (Vxy * Vxy) / (Vxx * Vyy);
    residualMs = Math.sqrt(Math.max(0, (Vyy - (Vxy * Vxy) / Vxx) / n / (n - 2))) * 1000;
  }

  return { bpm, offset, rSquared, residualMs, anchorCount: n, spanSec };
}

/** El rango temporal (max - min timeSec) de un set de anclas no vacío. */
function spanOf(anchors: Anchor[]): number {
  let min = Infinity;
  let max = -Infinity;
  for (const { timeSec } of anchors) {
    if (timeSec < min) min = timeSec;
    if (timeSec > max) max = timeSec;
  }
  return max - min;
}

/**
 * Acumula los taps (timeSec) del jugador y arma las anclas asignando a cada uno
 * su beatIndex. El truco: el primer tap es el beat 0, y a partir de un periodo
 * PROVISORIO (la mediana de los intervalos entre taps) redondeamos cada tap al
 * beat entero más cercano. Después fitTempo afina BPM y offset con la recta.
 *
 * ¿Por qué la mediana para el periodo? Misma razón que en la calibración: un
 * tap tardío o doble no nos rompe el redondeo. Robustez ante outliers.
 */
export class AnchorCollector {
  private readonly taps: number[] = [];
  private readonly seedBpm: number;

  constructor(seedBpm: number = 120) {
    this.seedBpm = seedBpm;
  }

  /** Registra un tap en su instante (segundos). */
  add(timeSec: number): void {
    this.taps.push(timeSec);
  }

  /** Vacía los taps acumulados. */
  reset(): void {
    this.taps.length = 0;
  }

  get count(): number {
    return this.taps.length;
  }

  /**
   * Las anclas derivadas de los taps. El primero es beatIndex 0; el resto se
   * redondea contra el periodo provisorio (mediana de los intervalos). Si no
   * hay con qué estimar el periodo, usamos el seedBpm.
   */
  get anchors(): Anchor[] {
    if (this.taps.length === 0) return [];

    const t0 = this.taps[0];

    // Intervalos entre taps consecutivos => periodo provisorio (mediana).
    const intervals: number[] = [];
    for (let i = 1; i < this.taps.length; i++) {
      intervals.push(this.taps[i] - this.taps[i - 1]);
    }
    const periodFromTaps = median(intervals);
    const period = intervals.length >= 1 && periodFromTaps > 0
      ? periodFromTaps
      : 60 / (this.seedBpm || 120);

    return this.taps.map((timeSec) => ({
      beatIndex: Math.round((timeSec - t0) / period),
      timeSec,
    }));
  }

  /** El ajuste final de la recta sobre las anclas actuales. */
  get fit(): TempoFit {
    return fitTempo(this.anchors);
  }
}
