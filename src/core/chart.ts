// chart.ts — EL DATO. Un beatmap es solo data, no comportamiento.
// Acá vive la "partitura": BPM, offset y la secuencia de flechas por barra.
// Todo es TypeScript puro: cero Three.js, cero navegador. Se testea de una.

/** Las cuatro direcciones. Esto es lo único que teclea el jugador (+ Espacio). */
export type Arrow = "left" | "up" | "right" | "down";

/** Una "barra" estilo Audition: tecleás la secuencia y confirmás en `commitBeat`. */
export interface Bar {
  /** El beat (entero) donde el jugador debe apretar ESPACIO. */
  commitBeat: number;
  /** La secuencia de flechas a cargar antes del commit. */
  sequence: Arrow[];
}

/** La canción jugable completa. */
export interface Chart {
  title: string;
  /** Pulsos por minuto. Define cuánto dura cada beat. */
  bpm: number;
  /** Offset en segundos: cuánto se corre el beat 0 respecto al audio (calibración). */
  offset: number;
  bars: Bar[];
}

/** Cuántos segundos dura un beat a este BPM. 120 BPM => 0.5 s. */
export function secondsPerBeat(chart: Chart): number {
  return 60 / chart.bpm;
}

/** beat (fraccionario) -> segundos en la línea de tiempo de la canción. */
export function beatToSeconds(chart: Chart, beat: number): number {
  return chart.offset + beat * secondsPerBeat(chart);
}

/** segundos -> beat (fraccionario). La inversa exacta de beatToSeconds. */
export function secondsToBeat(chart: Chart, seconds: number): number {
  return (seconds - chart.offset) / secondsPerBeat(chart);
}

/**
 * Chart de ejemplo para probar el motor SIN ningún asset de audio.
 * 120 BPM = un beat cada medio segundo. Las barras todavía no se usan
 * (eso es el siguiente milestone); por ahora el demo juzga contra cada beat.
 */
export const demoChart: Chart = {
  title: "Demo — Metrónomo",
  bpm: 120,
  offset: 0,
  bars: [
    { commitBeat: 4, sequence: ["left", "up", "right", "down"] },
    { commitBeat: 8, sequence: ["up", "up", "down", "down"] },
  ],
};
