// tempo.test.ts — Probamos la detección de tempo SIN navegador ni audio.

import { describe, it, expect } from "vitest";
import {
  fitTempo,
  fitTwoAnchors,
  beatsBetweenTaps,
  AnchorCollector,
  type Anchor,
} from "./tempo";

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

describe("fitTwoAnchors — sync por 2 anclas lejanas", () => {
  it("2 marcas con beatsBetween declarado => BPM y offset exactos", () => {
    // beat 0 en 1.5s, beat 128 en 61.5s => 60s / 128 beats = 0.46875 s/beat = 128 BPM.
    const fit = fitTwoAnchors(1.5, 61.5, 128);
    expect(fit.bpm).toBeCloseTo(128);
    expect(fit.offset).toBeCloseTo(1.5);
  });

  it("span grande => el BPM real queda clavado (palanca de la distancia)", () => {
    // 120 BPM real: beat 0 @0s, beat 240 (60 compases) @120s.
    const fit = fitTwoAnchors(0, 120, 240);
    expect(Math.abs(fit.bpm - 120)).toBeLessThanOrEqual(0.05);
  });

  it("un conteo errado por 1 beat corre TODO el BPM (por eso se confirma)", () => {
    // Marcas reales de 128 BPM (beat 128 @60s desde beat0@0s) pero declarando 127.
    const ok = fitTwoAnchors(0, 60, 128);
    const off = fitTwoAnchors(0, 60, 127);
    expect(ok.bpm).toBeCloseTo(128);
    expect(off.bpm).toBeCloseTo(127); // 127 beats / 60s -> 127 BPM, no 128
  });

  it("con 2 puntos no hay confianza estadística (rSquared/residual null)", () => {
    const fit = fitTwoAnchors(0, 30, 64);
    expect(fit.rSquared).toBeNull();
    expect(fit.residualMs).toBeNull();
  });
});

describe("beatsBetweenTaps — semilla del conteo de beats entre marcas", () => {
  it("estima los beats redondeando contra el BPM semilla", () => {
    // 30s a 128 BPM semilla => 30 / (60/128) = 64 beats.
    expect(beatsBetweenTaps(0, 30, 128)).toBe(64);
  });

  it("una semilla cercana al BPM real acierta el conteo en spans moderados", () => {
    // Marcas reales de 128 BPM: beat 64 @30s. Semilla 127 (casi) => round(30/(60/127))=64.
    expect(beatsBetweenTaps(0, 30, 127)).toBe(64);
  });

  it("BPM semilla <=0 cae a 120 sin romper", () => {
    expect(beatsBetweenTaps(0, 2, 0)).toBe(4); // 2s a 120 => 4 beats
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
