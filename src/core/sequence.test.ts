// sequence.test.ts — Probamos la máquina de estados SIN navegador ni teclado.
// Cada transición posible tiene su test. Eso es testear una FSM como la gente.

import { describe, it, expect } from "vitest";
import { SequenceTracker } from "./sequence";
import type { Arrow } from "./chart";

const SEQ: Arrow[] = ["left", "up", "right", "down"];

describe("SequenceTracker", () => {
  it("arranca cargando y cuenta las flechas correctas en orden", () => {
    const s = new SequenceTracker(SEQ);
    expect(s.state).toBe("loading");
    expect(s.press("left")).toBe("loading");
    expect(s.press("up")).toBe("loading");
    expect(s.loaded).toBe(2);
    expect(s.total).toBe(4);
  });

  it("queda LISTA al completar la secuencia entera", () => {
    const s = new SequenceTracker(SEQ);
    s.press("left");
    s.press("up");
    s.press("right");
    expect(s.isReady).toBe(false);
    expect(s.press("down")).toBe("ready");
    expect(s.isReady).toBe(true);
  });

  it("se ROMPE con una flecha equivocada", () => {
    const s = new SequenceTracker(SEQ);
    s.press("left");
    expect(s.press("down")).toBe("broken"); // esperaba 'up'
    expect(s.isBroken).toBe(true);
  });

  it("una vez rota es TERMINAL: ignora todo lo demás", () => {
    const s = new SequenceTracker(SEQ);
    s.press("right"); // mal de entrada
    expect(s.isBroken).toBe(true);
    s.press("left"); // ya no cuenta
    s.press("up");
    expect(s.isBroken).toBe(true);
    expect(s.loaded).toBe(0);
  });

  it("una vez lista, ignora las flechas de más", () => {
    const s = new SequenceTracker(["left"]);
    expect(s.press("left")).toBe("ready");
    expect(s.press("up")).toBe("ready"); // ignorada
    expect(s.loaded).toBe(1);
  });

  it("secuencia vacía nace lista", () => {
    expect(new SequenceTracker([]).isReady).toBe(true);
  });
});
