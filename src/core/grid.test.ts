// grid.test.ts — snapNearBar: redondeo al downbeat más cercano. Sin DOM ni audio.

import { describe, it, expect } from "vitest";
import { snapNearBar } from "./grid";

describe("snapNearBar — redondea al downbeat (múltiplo de 4) MÁS CERCANO", () => {
  it("un downbeat exacto NO se mueve", () => {
    expect(snapNearBar(0)).toBe(0);
    expect(snapNearBar(16)).toBe(16);
    expect(snapNearBar(64)).toBe(64);
  });

  it("redondea hacia abajo cuando está más cerca del downbeat anterior", () => {
    expect(snapNearBar(16.853)).toBe(16);
    expect(snapNearBar(17.9)).toBe(16); // 17.9/4 = 4.475 -> round 4 -> 16
  });

  it("redondea hacia arriba cuando está más cerca del próximo downbeat", () => {
    expect(snapNearBar(18.1)).toBe(20); // 18.1/4 = 4.525 -> round 5 -> 20
    expect(snapNearBar(19.5)).toBe(20);
  });

  it("a diferencia de un floor+1, un beat clavado en downbeat NO sobre-avanza un compás", () => {
    // gridBeat(16) daría 20; snapNearBar respeta el 16.
    expect(snapNearBar(16)).not.toBe(20);
    expect(snapNearBar(16)).toBe(16);
  });

  it("beats negativos (intro antes del beat 0) caen a 0 o al downbeat más cercano", () => {
    // Math.round(-0.05) devuelve -0 (quirk de JS); numéricamente es 0 (String(-0)==="0").
    expect(snapNearBar(-0.2)).toBeCloseTo(0);
    expect(snapNearBar(-2.1)).toBe(-4);
  });

  it("respeta un beatsPerBar custom", () => {
    expect(snapNearBar(7, 8)).toBe(8);
    expect(snapNearBar(3.9, 8)).toBe(0);
  });
});
