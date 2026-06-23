// energy.ts — El MAPA DE ENERGÍA de una canción: qué tan fuerte suena en cada
// momento (0..1). El gameplay lo usa para que la DENSIDAD de flechas siga a la
// música: cuanto más fuerte la canción, más flechas. Puro: entra un Float32Array
// de samples, sale un mapa. Cero DOM, cero audio (se testea con ondas sintéticas).

const FRAME_SEC = 0.05; // ~50 ms por frame de análisis (resolución del mapa)
const SMOOTH_SEC = 1.5; // ventana de suavizado: la densidad sigue SECCIONES, no golpes sueltos

export interface EnergyMap {
  values: number[]; // energía 0..1 por frame (ya suavizada y normalizada al pico)
  frameSec: number; // duración de cada frame, en segundos
}

/**
 * Analiza los samples de un canal y devuelve la ENVOLVENTE de energía 0..1.
 * Pipeline: RMS por frame → suavizado (promedio móvil ~SMOOTH_SEC) → normalizado
 * al pico. El suavizado a escala de ~1.5 s es a propósito: queremos que la
 * densidad siga la ESTRUCTURA de la canción (intro, estribillo, break), no cada
 * golpe de bombo, que haría oscilar la dificultad de forma errática.
 */
export function analyzeEnergy(samples: Float32Array, sampleRate: number): EnergyMap {
  const frameLen = Math.max(1, Math.round(FRAME_SEC * sampleRate));

  // 1) RMS (raíz cuadrática media) por frame: el "volumen" de ese tramo.
  const rms: number[] = [];
  for (let i = 0; i < samples.length; i += frameLen) {
    const end = Math.min(i + frameLen, samples.length);
    let sum = 0;
    for (let j = i; j < end; j += 1) sum += samples[j] * samples[j];
    rms.push(Math.sqrt(sum / Math.max(1, end - i)));
  }

  // 2) Suavizado: promedio móvil de ~SMOOTH_SEC (en frames, a cada lado).
  const half = Math.max(1, Math.round(SMOOTH_SEC / FRAME_SEC / 2));
  const smooth: number[] = [];
  for (let i = 0; i < rms.length; i += 1) {
    const from = Math.max(0, i - half);
    const to = Math.min(rms.length - 1, i + half);
    let sum = 0;
    for (let k = from; k <= to; k += 1) sum += rms[k];
    smooth.push(sum / (to - from + 1));
  }

  // 3) Normalizar al pico → 0..1 (clamp defensivo). Sin pico (silencio) → todo 0.
  const peak = smooth.reduce((m, v) => (v > m ? v : m), 0);
  const values = peak > 0 ? smooth.map((v) => Math.min(1, v / peak)) : smooth.map(() => 0);

  return { values, frameSec: FRAME_SEC };
}

/** La energía 0..1 en un instante (segundos). Clamp a los bordes del mapa. */
export function energyAt(map: EnergyMap, timeSec: number): number {
  if (map.values.length === 0) return 0;
  const idx = Math.floor(timeSec / map.frameSec);
  if (idx < 0) return map.values[0];
  if (idx >= map.values.length) return map.values[map.values.length - 1];
  return map.values[idx];
}

/**
 * Factor de ARRANQUE SUAVE (0..1): durante los primeros `warmupSec` segundos
 * sube linealmente de 0 a 1; después es 1. Sirve para no tirar una pared de
 * flechas si la canción arranca fuerte de entrada.
 */
export function warmupFactor(timeSec: number, warmupSec: number): number {
  if (warmupSec <= 0) return 1;
  return Math.max(0, Math.min(1, timeSec / warmupSec));
}

/**
 * La INTENSIDAD jugable 0..1 en un instante: la energía de la música, pero
 * limitada por el arranque suave. Es el número que mueve la densidad entre el
 * piso y el techo de la dificultad. (min: durante el warmup capa los picos, pero
 * respeta los tramos calmos.)
 */
export function intensityAt(map: EnergyMap, timeSec: number, warmupSec: number): number {
  return Math.min(energyAt(map, timeSec), warmupFactor(timeSec, warmupSec));
}
