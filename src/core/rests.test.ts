// rests.test.ts — Probamos la lógica de descansos sin navegador ni audio.

import { describe, it, expect } from "vitest";
import { restAt, restEndBeat, sortRests, type Rest } from "./rests";

const RESTS: Rest[] = [
  { atBeat: 16, durationBeats: 8 }, // descanso de beats 16 a 24
  { atBeat: 40, durationBeats: 4 }, // descanso de beats 40 a 44
];

describe("restAt", () => {
  it("detecta cuando un beat cae dentro de un descanso", () => {
    expect(restAt(16, RESTS)?.durationBeats).toBe(8); // borde inicial: incluido
    expect(restAt(20, RESTS)?.atBeat).toBe(16);
    expect(restAt(40, RESTS)?.durationBeats).toBe(4);
  });

  it("devuelve null cuando se está jugando", () => {
    expect(restAt(15, RESTS)).toBeNull();
    expect(restAt(24, RESTS)).toBeNull(); // borde final: ya se juega (exclusivo)
    expect(restAt(100, RESTS)).toBeNull();
  });
});

describe("restEndBeat", () => {
  it("devuelve el beat donde termina el descanso activo", () => {
    expect(restEndBeat(20, RESTS)).toBe(24);
    expect(restEndBeat(41, RESTS)).toBe(44);
  });

  it("si no hay descanso, devuelve el mismo beat", () => {
    expect(restEndBeat(10, RESTS)).toBe(10);
  });

  it("encadena descansos pegados", () => {
    const pegados: Rest[] = [
      { atBeat: 8, durationBeats: 4 },
      { atBeat: 12, durationBeats: 4 }, // arranca justo donde termina el anterior
    ];
    expect(restEndBeat(9, pegados)).toBe(16);
  });
});

describe("sortRests", () => {
  it("ordena por atBeat sin mutar el original", () => {
    const desordenado: Rest[] = [{ atBeat: 40, durationBeats: 4 }, { atBeat: 16, durationBeats: 8 }];
    const ordenado = sortRests(desordenado);
    expect(ordenado.map((r) => r.atBeat)).toEqual([16, 40]);
    expect(desordenado[0].atBeat).toBe(40); // el original quedó intacto
  });
});
