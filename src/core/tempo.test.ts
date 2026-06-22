// tempo.test.ts — Probamos la detección de tempo SIN navegador ni audio.

import { describe, it, expect } from "vitest";
import { fitTempo, AnchorCollector, type Anchor } from "./tempo";

describe("fitTempo — la recta t(beat) = offset + beat*(60/bpm)", () => {
  it("dos anclas exactas => BPM y offset directos", () => {
    // beat 0 en 2.0s, beat 64 en 34.0s => 32s / 64 beats = 0.5 s/beat = 120 BPM.
    const fit = fitTempo([
      { beatIndex: 0, timeSec: 2.0 },
      { beatIndex: 64, timeSec: 34.0 },
    ]);
    expect(fit.bpm).toBeCloseTo(120);
    expect(fit.offset).toBeCloseTo(2.0);
  });

  it("5 anclas perfectamente colineales => R²≈1 y residual≈0", () => {
    // bpm 128 => 0.46875 s/beat; offset 0.3.
    const spb = 60 / 128;
    const offset = 0.3;
    const anchors: Anchor[] = [0, 4, 8, 12, 16].map((beatIndex) => ({
      beatIndex,
      timeSec: offset + beatIndex * spb,
    }));
    const fit = fitTempo(anchors);
    expect(fit.bpm).toBeCloseTo(128);
    expect(fit.offset).toBeCloseTo(0.3);
    expect(fit.rSquared).toBeCloseTo(1);
    expect(fit.residualMs).toBeCloseTo(0);
  });

  it("n<3 => confianza null (NUNCA NaN): es degenerado", () => {
    const una = fitTempo([{ beatIndex: 0, timeSec: 1.0 }]);
    expect(una.rSquared).toBeNull();
    expect(una.residualMs).toBeNull();

    const dos = fitTempo([
      { beatIndex: 0, timeSec: 1.0 },
      { beatIndex: 8, timeSec: 5.0 },
    ]);
    expect(dos.rSquared).toBeNull();
    expect(dos.residualMs).toBeNull();
    // Y el BPM igual sale bien con 2 anclas (la recta existe, solo falta confianza).
    expect(dos.bpm).toBeCloseTo(120);
  });

  it("palanca: dos anclas lejanas (32s) clavan el BPM real dentro de ±0.1", () => {
    // BPM real 120 => 0.5 s/beat. 32s => 64 beats exactos.
    const fit = fitTempo([
      { beatIndex: 0, timeSec: 0 },
      { beatIndex: 64, timeSec: 32 },
    ]);
    expect(Math.abs(fit.bpm - 120)).toBeLessThanOrEqual(0.1);
  });
});

describe("AnchorCollector — de taps crudos a un fit", () => {
  it("taps cada ~0.5s (120 BPM) con seed 120 => fit.bpm≈120", () => {
    const c = new AnchorCollector(120);
    for (let i = 0; i < 8; i++) c.add(i * 0.5);
    expect(c.count).toBe(8);
    expect(c.fit.bpm).toBeCloseTo(120);
  });

  it("reset deja la cuenta en 0", () => {
    const c = new AnchorCollector(120);
    c.add(0);
    c.add(0.5);
    expect(c.count).toBe(2);
    c.reset();
    expect(c.count).toBe(0);
    expect(c.anchors).toEqual([]);
  });
});
