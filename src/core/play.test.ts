// play.test.ts — Acá comprobamos que el MOTOR es correcto, SIN un humano.
// Si estos tests dan verde, el código está bien. Punto. No hay opinión.

import { describe, it, expect } from "vitest";
import { Conductor } from "./conductor";
import { judgeCommit, judgeBarCommit } from "./play";
import { beatToSeconds, demoChart } from "./chart";

// Un AudioContext FALSO con un reloj que movemos a mano. Truco clave:
// inyectamos la dependencia para que el tiempo sea determinista. Así testeamos
// el Conductor sin navegador, sin placa de sonido y sin esperar en tiempo real.
class FakeClock {
  currentTime = 0;
  state: AudioContextState = "running";
  async resume(): Promise<void> {
    this.state = "running";
  }
}

describe("Conductor — reloj determinista (clock inyectado)", () => {
  it("mide tiempo y beat exactos según el reloj de audio", () => {
    const clock = new FakeClock();
    clock.currentTime = 2.0;
    const c = new Conductor(demoChart, clock as unknown as AudioContext);
    c.start(); // ancla startTime = 2.0

    clock.currentTime = 2.5;
    expect(c.time).toBeCloseTo(0.5);
    expect(c.beat).toBeCloseTo(1); // 0.5s / (0.5s por beat) = beat 1

    clock.currentTime = 4.0;
    expect(c.beat).toBeCloseTo(4);
  });

  it("pausar y reanudar no pierde la posición", () => {
    const clock = new FakeClock();
    const c = new Conductor(demoChart, clock as unknown as AudioContext);
    c.start();
    clock.currentTime = 0.5;
    c.pause();
    clock.currentTime = 10; // pasa el tiempo real...
    expect(c.time).toBeCloseTo(0.5); // ...pero quedamos congelados donde pausamos
    c.start(); // reanuda desde 0.5
    clock.currentTime = 10.5;
    expect(c.time).toBeCloseTo(1.0);
  });
});

describe("judgeCommit — el jugador ROBOT (sin humano, sin azar)", () => {
  it("clavando cada beat exacto: siempre PERFECT y delta 0, toda la canción", () => {
    for (let n = 0; n < 32; n++) {
      const r = judgeCommit(demoChart, beatToSeconds(demoChart, n));
      expect(r.beat).toBe(n);
      expect(r.delta).toBeCloseTo(0);
      expect(r.grade).toBe("perfect");
    }
  });

  it("70 ms tarde => COOL, con delta positivo", () => {
    const r = judgeCommit(demoChart, beatToSeconds(demoChart, 4) + 0.07);
    expect(r.grade).toBe("cool");
    expect(r.delta).toBeGreaterThan(0);
  });

  it("siempre elige el beat más cercano", () => {
    expect(judgeCommit(demoChart, 0.6).beat).toBe(1); // 0.6 más cerca de 0.5 que de 1.0
    expect(judgeCommit(demoChart, 0.9).beat).toBe(2); // 0.9 más cerca de 1.0 que de 0.5
  });
});

describe("judgeCommit con input-offset (calibración aplicada)", () => {
  it("el input-offset rescata una tendencia que sin calibrar daría peor nota", () => {
    const t = beatToSeconds(demoChart, 4) + 0.06; // el jugador pega 60 ms tarde
    expect(judgeCommit(demoChart, t, 0).grade).toBe("cool"); // sin calibrar: COOL
    const r = judgeCommit(demoChart, t, 0.06); // calibrado a +60 ms
    expect(r.delta).toBeCloseTo(0); // su latencia quedó anulada...
    expect(r.grade).toBe("perfect"); // ...y ahora SÍ es PERFECT
  });
});

describe("judgeBarCommit — confirmación de una barra (Audition)", () => {
  it("secuencia lista + justo en el commitBeat => PERFECT", () => {
    const t = beatToSeconds(demoChart, 8);
    const r = judgeBarCommit(demoChart, 8, true, t);
    expect(r.grade).toBe("perfect");
    expect(r.sequenceOk).toBe(true);
  });

  it("secuencia ROTA => MISS aunque el timing sea perfecto", () => {
    const t = beatToSeconds(demoChart, 8);
    const r = judgeBarCommit(demoChart, 8, false, t);
    expect(r.grade).toBe("miss");
    expect(r.sequenceOk).toBe(false);
  });

  it("secuencia lista pero tarde => baja la nota por timing", () => {
    const t = beatToSeconds(demoChart, 8) + 0.07;
    expect(judgeBarCommit(demoChart, 8, true, t).grade).toBe("cool");
  });
});
