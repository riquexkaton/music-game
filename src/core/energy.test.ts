// energy.test.ts — El mapa de energía, probado con ondas sintéticas (sin audio
// ni navegador): silencio, tono constante y amplitud creciente.

import { describe, it, expect } from "vitest";
import { analyzeEnergy, energyAt, warmupFactor, intensityAt } from "./energy";

const SR = 8000; // sample rate chico: tests rápidos

/** Una senoidal de 220 Hz con amplitud por sample (para modelar volumen variable). */
function tone(n: number, amp: (i: number) => number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) out[i] = amp(i) * Math.sin((2 * Math.PI * 220 * i) / SR);
  return out;
}

describe("analyzeEnergy", () => {
  it("silencio → energía 0 en todo el mapa", () => {
    const map = analyzeEnergy(new Float32Array(SR * 2), SR);
    expect(map.values.length).toBeGreaterThan(0);
    expect(map.values.every((v) => v === 0)).toBe(true);
  });

  it("normaliza al pico: el máximo queda en ~1", () => {
    const map = analyzeEnergy(tone(SR * 2, () => 0.5), SR);
    const max = Math.max(...map.values);
    expect(max).toBeGreaterThan(0.99);
    expect(max).toBeLessThanOrEqual(1);
  });

  it("amplitud creciente → energía creciente (el final supera al inicio)", () => {
    const n = SR * 4;
    const map = analyzeEnergy(tone(n, (i) => i / n), SR); // amplitud 0 → 1
    const q = Math.max(1, Math.floor(map.values.length / 4));
    const avg = (arr: number[]): number => arr.reduce((s, v) => s + v, 0) / arr.length;
    expect(avg(map.values.slice(-q))).toBeGreaterThan(avg(map.values.slice(0, q)));
  });

  it("reporta frameSec para poder mapear tiempo → índice", () => {
    const map = analyzeEnergy(tone(SR, () => 0.3), SR);
    expect(map.frameSec).toBeGreaterThan(0);
  });
});

describe("energyAt", () => {
  it("clampa a los bordes cuando el tiempo se sale del rango", () => {
    const map = analyzeEnergy(tone(SR * 2, () => 0.5), SR);
    expect(energyAt(map, -5)).toBe(map.values[0]);
    expect(energyAt(map, 9999)).toBe(map.values[map.values.length - 1]);
  });

  it("mapa vacío → 0 (nunca rompe)", () => {
    expect(energyAt({ values: [], frameSec: 0.05 }, 1)).toBe(0);
  });
});

describe("warmupFactor (arranque suave)", () => {
  it("0 al empezar, 1 pasado el warmup, lineal en el medio", () => {
    expect(warmupFactor(0, 8)).toBe(0);
    expect(warmupFactor(4, 8)).toBeCloseTo(0.5);
    expect(warmupFactor(8, 8)).toBe(1);
    expect(warmupFactor(20, 8)).toBe(1);
  });

  it("warmup 0 → siempre 1 (sin arranque suave)", () => {
    expect(warmupFactor(0, 0)).toBe(1);
  });
});

describe("intensityAt (energía limitada por el arranque)", () => {
  it("durante el warmup capa los picos de energía", () => {
    const map = { values: [1, 1, 1, 1], frameSec: 1 }; // energía full todo el tiempo
    // en t=2 con warmup 8: warmup = 0.25 → intensity = min(1, 0.25)
    expect(intensityAt(map, 2, 8)).toBeCloseTo(0.25);
  });

  it("pasado el warmup, la energía manda pura", () => {
    const map = { values: [0.3, 0.3, 0.3], frameSec: 1 };
    expect(intensityAt(map, 2, 1)).toBeCloseTo(0.3);
  });
});
