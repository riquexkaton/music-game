// sfx.test.ts — Los efectos de sonido percusivos, probados con un AudioContext
// FALSO que cuenta osciladores y registra frecuencias. No verifica cómo SUENAN
// (eso es de oído), sí que cada disparo arma las voces correctas, que el golpe
// "cae" (pitch drop = percusivo), y que nunca rompe.

import { describe, it, expect } from "vitest";
import { createSfx } from "./sfx";

function makeMock(): {
  ctx: AudioContext;
  oscCount: () => number;
  from: number[];
  to: number[];
} {
  let oscCount = 0;
  const from: number[] = []; // frecuencias iniciales (setValueAtTime)
  const to: number[] = []; // frecuencias del drop (exponentialRampToValueAtTime)
  const osc = (): unknown => ({
    type: "",
    frequency: {
      setValueAtTime(v: number) {
        from.push(v);
      },
      exponentialRampToValueAtTime(v: number) {
        to.push(v);
      },
    },
    connect(target: unknown) {
      return target;
    },
    start() {},
    stop() {},
  });
  const gain = (): unknown => ({
    gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
    connect(target: unknown) {
      return target;
    },
  });
  const ctx = {
    currentTime: 0,
    destination: {},
    createOscillator() {
      oscCount += 1;
      return osc();
    },
    createGain() {
      return gain();
    },
  } as unknown as AudioContext;
  return { ctx, oscCount: () => oscCount, from, to };
}

describe("createSfx", () => {
  it("no rompe si el AudioContext no puede sintetizar (no-op silencioso)", () => {
    const ctx = { currentTime: 0, destination: {} } as unknown as AudioContext;
    const sfx = createSfx(ctx);
    expect(() => {
      sfx.key();
      sfx.perfect();
      sfx.good();
      sfx.miss();
    }).not.toThrow();
  });

  it("key es un solo golpe (un oscilador)", () => {
    const { ctx, oscCount } = makeMock();
    createSfx(ctx).key();
    expect(oscCount()).toBe(1);
  });

  it("el golpe es percusivo: la frecuencia CAE (pitch drop)", () => {
    const { ctx, from, to } = makeMock();
    createSfx(ctx).key();
    expect(from[0]).toBeGreaterThan(to[0]);
  });

  it("perfect arma tres voces (impacto + octavas)", () => {
    const { ctx, oscCount } = makeMock();
    createSfx(ctx).perfect();
    expect(oscCount()).toBe(3);
  });

  it("good y miss son un golpe cada uno", () => {
    const { ctx, oscCount } = makeMock();
    const sfx = createSfx(ctx);
    sfx.good();
    sfx.miss();
    expect(oscCount()).toBe(2);
  });
});
