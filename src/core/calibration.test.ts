// calibration.test.ts — Probamos la matemática de calibración SIN navegador.

import { describe, it, expect } from "vitest";
import { median, Calibrator } from "./calibration";

describe("median — robusta a errores", () => {
  it("lista impar: devuelve el del medio (y ordena sola)", () => {
    expect(median([1, 2, 3])).toBe(2);
    expect(median([3, 1, 2])).toBe(2);
  });

  it("lista par: promedio de los dos del medio", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("un mistap NO la arrastra (por eso mediana y no promedio)", () => {
    const muestras = [0.018, 0.02, 0.022, 0.5]; // 3 taps buenos + 1 desastre
    expect(median(muestras)).toBeCloseTo(0.021); // la mediana ignora el outlier
    const promedio = muestras.reduce((a, b) => a + b, 0) / muestras.length;
    expect(promedio).toBeCloseTo(0.14); // el promedio se va a la B
  });

  it("lista vacía => 0", () => {
    expect(median([])).toBe(0);
  });
});

describe("Calibrator", () => {
  it("junta hasta `target` taps y recomienda la mediana", () => {
    const c = new Calibrator(3);
    expect(c.done).toBe(false);
    expect(c.remaining).toBe(3);

    c.add(0.01);
    c.add(0.03);
    c.add(0.02);

    expect(c.done).toBe(true);
    expect(c.remaining).toBe(0);
    expect(c.offset).toBeCloseTo(0.02);
  });

  it("descarta los taps de más una vez completo", () => {
    const c = new Calibrator(2);
    c.add(0.02);
    c.add(0.02);
    c.add(0.9); // este ya no entra
    expect(c.count).toBe(2);
    expect(c.offset).toBeCloseTo(0.02);
  });
});
