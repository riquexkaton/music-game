// grid.ts — Snapping de beats a la grilla de compases. Pura: cero DOM, cero audio.
// La diferencia con el gridBeat() del runner (floor+1, "avanzá SIEMPRE al próximo
// downbeat") es deliberada: acá redondeamos al downbeat MÁS CERCANO. Sirve para fijar
// el INICIO DEL JUEGO exactamente donde el usuario lo marcó, no un compás después.

/** Beats por compás. La grilla musical estilo Audition es de 4/4. */
export const BEATS_PER_BAR = 4;

/**
 * Redondea un beat (fraccionario) al downbeat (múltiplo de beatsPerBar) MÁS CERCANO.
 * snapNearBar(16) === 16 (no lo mueve), snapNearBar(17.9) === 16, snapNearBar(18.1) === 20.
 * Contrastá con gridBeat (floor+1) que de 16 saltaría a 20: ese sirve para el espaciado
 * ENTRE secuencias; este, para clavar un beat ya elegido.
 */
export function snapNearBar(beat: number, beatsPerBar: number = BEATS_PER_BAR): number {
  return Math.round(beat / beatsPerBar) * beatsPerBar;
}
