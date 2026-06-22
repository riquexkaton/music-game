// song.test.ts — El generador de charts, probado SIN audio ni navegador.
// Inyectamos un randomArrow determinista para que el test no dependa del azar.

import { describe, it, expect } from "vitest";
import { buildChart, DIFFICULTIES, type Song } from "./song";
import type { Arrow } from "./chart";

const always = (): Arrow => "left"; // secuencia determinista para los tests

const song: Song = {
  id: "neon-rush",
  title: "Neon Rush",
  audioUrl: "/songs/neon-rush/audio.mp3",
  bpm: 128,
  offset: 0,
  durationBeats: 32,
};

describe("buildChart — genera el chart por dificultad", () => {
  it("hereda el BPM y el offset de la canción", () => {
    const chart = buildChart(song, DIFFICULTIES.normal, always);
    expect(chart.bpm).toBe(128);
    expect(chart.offset).toBe(0);
  });

  it("pone una barra cada beatsPerCommit beats sobre la grilla", () => {
    const chart = buildChart(song, DIFFICULTIES.normal, always); // cada 4 beats
    expect(chart.bars.map((b) => b.commitBeat)).toEqual([4, 8, 12, 16, 20, 24, 28, 32]);
  });

  it("HARD es más denso y con secuencias más largas que EASY", () => {
    const easy = buildChart(song, DIFFICULTIES.easy, always);
    const hard = buildChart(song, DIFFICULTIES.hard, always);
    expect(hard.bars.length).toBeGreaterThan(easy.bars.length); // más barras
    expect(hard.bars[0].sequence.length).toBeGreaterThan(easy.bars[0].sequence.length);
  });

  it("la secuencia respeta el largo que pide la dificultad", () => {
    const chart = buildChart(song, DIFFICULTIES.hard, always);
    expect(chart.bars[0].sequence).toHaveLength(6);
    expect(chart.bars[0].sequence.every((a) => a === "left")).toBe(true);
  });
});
