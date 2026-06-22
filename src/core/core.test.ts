// core.test.ts — La PRUEBA de que el dominio vive sin Three.js ni navegador.
// Esto corre en Node, en milisegundos, con `npm test`. Si mañana cambiás todo
// el render, estos tests siguen verdes. ESO es separar dominio de presentación.

import { describe, it, expect } from "vitest";
import { judge } from "./judge";
import { beatToSeconds, secondsToBeat, secondsPerBeat, demoChart } from "./chart";

describe("judge", () => {
  it("clava PERFECT pegado al beat", () => {
    expect(judge(0)).toBe("perfect");
    expect(judge(0.03)).toBe("perfect");
  });

  it("degrada la nota según la distancia", () => {
    expect(judge(0.07)).toBe("cool");
    expect(judge(0.12)).toBe("good");
    expect(judge(0.5)).toBe("miss");
  });

  it("castiga igual apretar antes o después (el signo no importa)", () => {
    expect(judge(-0.03)).toBe("perfect");
    expect(judge(-0.5)).toBe("miss");
  });

  it("respeta los bordes EXACTOS de cada ventana (inclusivos)", () => {
    expect(judge(0.045)).toBe("perfect"); // justo en el borde => entra
    expect(judge(0.0451)).toBe("cool"); // un pelo afuera => baja
    expect(judge(0.135)).toBe("good");
    expect(judge(0.1351)).toBe("miss");
  });
});

describe("conversión beats <-> segundos", () => {
  it("a 120 BPM, un beat dura medio segundo", () => {
    expect(secondsPerBeat(demoChart)).toBeCloseTo(0.5);
    expect(beatToSeconds(demoChart, 1)).toBeCloseTo(0.5);
  });

  it("ida y vuelta da el mismo beat", () => {
    const t = beatToSeconds(demoChart, 8);
    expect(secondsToBeat(demoChart, t)).toBeCloseTo(8);
  });
});
