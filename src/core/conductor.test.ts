// conductor.test.ts — El reloj maestro, probado con un AudioContext FALSO (un reloj
// controlable). El audio real no se puede testear en Node ni de forma determinista en
// un navegador headless (el contexto nace suspendido), pero la MATEMÁTICA del reloj
// (start/pause/reset/seek) sí: entran ticks de currentTime, sale conductor.time.

import { describe, it, expect } from "vitest";
import { Conductor } from "./conductor";
import { demoChart } from "./chart";

/** AudioContext mínimo: un currentTime controlable + lo justo para start/seek. */
class FakeAudio {
  currentTime = 0;
  state: "suspended" | "running" = "running";
  destination = {} as AudioDestinationNode;
  async resume(): Promise<void> {
    this.state = "running";
  }
  createBufferSource(): AudioBufferSourceNode {
    return {
      buffer: null,
      connect() {
        return this as unknown as AudioNode;
      },
      start() {},
      stop() {},
      disconnect() {},
    } as unknown as AudioBufferSourceNode;
  }
}

function makeConductor(): { conductor: Conductor; audio: FakeAudio } {
  const audio = new FakeAudio();
  const conductor = new Conductor({ ...demoChart }, audio as unknown as AudioContext);
  return { conductor, audio };
}

/** Inyecta un buffer falso (con duración) sin pasar por load()/fetch/decode. */
function setBuffer(conductor: Conductor, duration: number): void {
  (conductor as unknown as { buffer: AudioBuffer }).buffer = { duration } as AudioBuffer;
}

describe("Conductor.seek — salto arbitrario de posición (para el editor)", () => {
  it("salta a una posición y el reloj sigue desde ahí", () => {
    const { conductor, audio } = makeConductor();
    conductor.start(false); // arranca sólo el reloj (sin audio)
    audio.currentTime = 10;
    expect(conductor.time).toBeCloseTo(10);

    conductor.seek(3);
    expect(conductor.time).toBeCloseTo(3); // saltó a 3
    audio.currentTime = 12; // pasaron 2s desde el salto
    expect(conductor.time).toBeCloseTo(5); // 3 + 2
  });

  it("clampa por debajo a 0 (no hay tiempo negativo)", () => {
    const { conductor } = makeConductor();
    conductor.start(false);
    conductor.seek(-5);
    expect(conductor.time).toBeCloseTo(0);
  });

  it("clampa por arriba a la duración del buffer", () => {
    const { conductor } = makeConductor();
    setBuffer(conductor, 180);
    conductor.start(false);
    conductor.seek(999);
    expect(conductor.time).toBeCloseTo(180);
  });

  it("en pausa mueve la posición sin correr; el próximo start arranca ahí", () => {
    const { conductor, audio } = makeConductor();
    conductor.start(false);
    audio.currentTime = 4;
    conductor.pause();

    conductor.seek(20);
    expect(conductor.isRunning).toBe(false);
    expect(conductor.time).toBeCloseTo(20); // pausado: time = pausedAt

    conductor.start(false); // reanuda desde 20
    audio.currentTime = 6; // 2s "reales" más
    expect(conductor.time).toBeCloseTo(22); // 20 + 2
  });

  it("sonando, re-crea el source y sigue corriendo desde la nueva posición", () => {
    const { conductor, audio } = makeConductor();
    setBuffer(conductor, 200);
    conductor.start(true); // crea el source (hay buffer)
    audio.currentTime = 5;

    conductor.seek(50);
    expect(conductor.time).toBeCloseTo(50);
    expect(conductor.isRunning).toBe(true);
  });
});
