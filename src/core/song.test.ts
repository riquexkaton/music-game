// song.test.ts — La RAMPA de dificultad y el generador de charts, probados SIN
// audio ni navegador. Inyectamos un randomArrow determinista para que el test no
// dependa del azar.

import { describe, it, expect } from "vitest";
import { buildChart, rampAt, DIFFICULTIES, type Song } from "./song";
import type { Arrow } from "./chart";

const always = (): Arrow => "left"; // secuencia determinista para los tests

const song: Song = {
  id: "neon-rush",
  title: "Neon Rush",
  audioUrl: "/songs/neon-rush/audio.mp3",
  bpm: 128,
  offset: 0,
  durationBeats: 200, // largo para que la rampa tenga recorrido completo
};

describe("rampAt — intensidad progresiva según el avance", () => {
  it("al empezar (0%) usa el piso de cada dificultad", () => {
    expect(rampAt(0, DIFFICULTIES.easy)).toEqual({ sequenceLength: 1, barStep: 8 });
    expect(rampAt(0, DIFFICULTIES.normal)).toEqual({ sequenceLength: 3, barStep: 8 });
    expect(rampAt(0, DIFFICULTIES.hard)).toEqual({ sequenceLength: 4, barStep: 8 });
  });

  it("alcanza el techo al 60% del avance (PEAK_AT), no recién al final", () => {
    expect(rampAt(0.6, DIFFICULTIES.hard)).toEqual({ sequenceLength: 8, barStep: 4 });
    expect(rampAt(0.6, DIFFICULTIES.normal)).toEqual({ sequenceLength: 5, barStep: 5 });
    expect(rampAt(0.6, DIFFICULTIES.easy)).toEqual({ sequenceLength: 3, barStep: 6 });
  });

  it("se mantiene en el techo del 60% al 100% (meseta)", () => {
    expect(rampAt(0.8, DIFFICULTIES.hard)).toEqual(rampAt(0.6, DIFFICULTIES.hard));
    expect(rampAt(1, DIFFICULTIES.hard)).toEqual(rampAt(0.6, DIFFICULTIES.hard));
  });

  it("interpola antes del pico", () => {
    // hard a la mitad del tramo de subida (progress 0.3 → t 0.5):
    // seq round(4+4·0.5)=6, step round(8−4·0.5)=6.
    expect(rampAt(0.3, DIFFICULTIES.hard)).toEqual({ sequenceLength: 6, barStep: 6 });
  });

  it("clampa por debajo de 0 (nunca menos que el piso)", () => {
    expect(rampAt(-3, DIFFICULTIES.hard)).toEqual(rampAt(0, DIFFICULTIES.hard));
  });

  it("la cantidad de flechas nunca baja de 1", () => {
    expect(rampAt(0, DIFFICULTIES.easy).sequenceLength).toBeGreaterThanOrEqual(1);
  });
});

describe("buildChart — camina la canción con la rampa", () => {
  it("hereda el BPM y el offset de la canción", () => {
    const chart = buildChart(song, DIFFICULTIES.normal, always);
    expect(chart.bpm).toBe(128);
    expect(chart.offset).toBe(0);
  });

  it("el título lleva el label legible de la dificultad", () => {
    expect(buildChart(song, DIFFICULTIES.hard, always).title).toContain("Experto");
  });

  it("la primera barra arranca en el piso de la dificultad", () => {
    expect(buildChart(song, DIFFICULTIES.easy, always).bars[0].sequence).toHaveLength(1);
    expect(buildChart(song, DIFFICULTIES.hard, always).bars[0].sequence).toHaveLength(4);
  });

  it("la última barra llega al techo de la dificultad", () => {
    const hard = buildChart(song, DIFFICULTIES.hard, always);
    expect(hard.bars[hard.bars.length - 1].sequence).toHaveLength(8);
  });

  it("termina más intenso de lo que arranca", () => {
    const chart = buildChart(song, DIFFICULTIES.hard, always);
    const first = chart.bars[0].sequence.length;
    const last = chart.bars[chart.bars.length - 1].sequence.length;
    expect(last).toBeGreaterThan(first);
  });

  it("Experto trepa más alto que Fácil al final de la canción", () => {
    const easy = buildChart(song, DIFFICULTIES.easy, always);
    const hard = buildChart(song, DIFFICULTIES.hard, always);
    const lastLen = (c: typeof easy): number => c.bars[c.bars.length - 1].sequence.length;
    expect(lastLen(hard)).toBeGreaterThan(lastLen(easy));
  });

  it("usa el randomArrow inyectado (determinista)", () => {
    const chart = buildChart(song, DIFFICULTIES.hard, always);
    expect(chart.bars[0].sequence.every((a) => a === "left")).toBe(true);
  });

  it("las barras avanzan en orden y no se pasan del largo de la canción", () => {
    const chart = buildChart(song, DIFFICULTIES.normal, always);
    expect(chart.bars.length).toBeGreaterThan(0);
    for (const bar of chart.bars) {
      expect(bar.commitBeat).toBeLessThanOrEqual(song.durationBeats);
    }
    for (let i = 1; i < chart.bars.length; i += 1) {
      expect(chart.bars[i].commitBeat).toBeGreaterThan(chart.bars[i - 1].commitBeat);
    }
  });
});
