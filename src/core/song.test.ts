// song.test.ts — La rampa de dificultad: dada una intensidad 0..1 (qué tan a tope
// está la música), cuántas flechas y cada cuántos beats. Pura, sin audio.

import { describe, it, expect } from "vitest";
import { rampAt, DIFFICULTIES } from "./song";

describe("rampAt — densidad según la intensidad de la música", () => {
  it("intensidad 0 (música calma) → piso de cada dificultad", () => {
    expect(rampAt(0, DIFFICULTIES.easy)).toEqual({ sequenceLength: 1, barStep: 8 });
    expect(rampAt(0, DIFFICULTIES.normal)).toEqual({ sequenceLength: 3, barStep: 8 });
    expect(rampAt(0, DIFFICULTIES.hard)).toEqual({ sequenceLength: 4, barStep: 8 });
  });

  it("intensidad 1 (música a tope) → techo de cada dificultad", () => {
    expect(rampAt(1, DIFFICULTIES.easy)).toEqual({ sequenceLength: 3, barStep: 6 });
    expect(rampAt(1, DIFFICULTIES.normal)).toEqual({ sequenceLength: 5, barStep: 5 });
    expect(rampAt(1, DIFFICULTIES.hard)).toEqual({ sequenceLength: 8, barStep: 4 });
  });

  it("interpola lineal en el medio", () => {
    // hard: seq 4->8 (round 6), step 8->4 (round 6)
    expect(rampAt(0.5, DIFFICULTIES.hard)).toEqual({ sequenceLength: 6, barStep: 6 });
  });

  it("clampa fuera de [0,1]", () => {
    expect(rampAt(-3, DIFFICULTIES.hard)).toEqual(rampAt(0, DIFFICULTIES.hard));
    expect(rampAt(99, DIFFICULTIES.hard)).toEqual(rampAt(1, DIFFICULTIES.hard));
  });

  it("Experto trepa más alto que Fácil a la misma intensidad", () => {
    expect(rampAt(1, DIFFICULTIES.hard).sequenceLength).toBeGreaterThan(
      rampAt(1, DIFFICULTIES.easy).sequenceLength,
    );
  });

  it("la cantidad de flechas nunca baja de 1", () => {
    expect(rampAt(0, DIFFICULTIES.easy).sequenceLength).toBeGreaterThanOrEqual(1);
  });
});
