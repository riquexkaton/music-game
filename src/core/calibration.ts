// calibration.ts — La MATEMÁTICA de la calibración. Pura y testeable.
// El objetivo: medir la latencia del jugador (su "tendencia") y convertirla
// en un input-offset. Acá no hay DOM ni audio: entran números, sale un número.

/**
 * Mediana: el valor del medio de una lista ordenada.
 * ¿Por qué mediana y NO promedio? Porque si en la calibración pegás UN tap
 * desastroso (te distrajiste, doble tap), el promedio se va a la B, pero la
 * mediana ni se inmuta. Robustez ante outliers. Es así.
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Junta los deltas CRUDOS de unos cuantos taps al beat y, cuando completa,
 * recomienda el input-offset (la mediana). Pura lógica de dominio: la UI le
 * pasa cada delta y le pregunta si ya terminó. No sabe nada de audio ni DOM.
 */
export class Calibrator {
  private readonly samples: number[] = [];

  constructor(readonly target: number = 8) {}

  add(rawDelta: number): void {
    if (!this.done) this.samples.push(rawDelta);
  }

  get count(): number {
    return this.samples.length;
  }

  get remaining(): number {
    return Math.max(0, this.target - this.samples.length);
  }

  get done(): boolean {
    return this.samples.length >= this.target;
  }

  /** El offset recomendado: la mediana de los taps (robusta a errores). */
  get offset(): number {
    return median(this.samples);
  }

  reset(): void {
    this.samples.length = 0;
  }
}
