// scheduler.ts — Programación de beats con LOOKAHEAD.
//
// Patrón clásico "A Tale of Two Clocks" (Chris Wilson). El problema:
// el reloj de audio es preciso pero no podés "pollearlo" con un timer fino
// sin matar la CPU; y el rAF tiembla (16ms, y se frena si la pestaña lagea).
//
// La solución: un setInterval grueso (cada 25ms) que mira un poquito hacia
// ADELANTE y agenda los sonidos en el reloj de audio (osc.start(time)), que
// los dispara con precisión de sample. Los visuales (rAF) solo leen una cola.

import type { Conductor } from "./conductor";

interface ScheduledBeat {
  beat: number;
  time: number; // instante en el reloj de audio (audio.currentTime) del beat
}

export class Scheduler {
  private timer: number | null = null;
  /** Índice del próximo beat (entero) que falta programar. */
  private nextBeat = 0;

  /** Cuánto miramos hacia adelante al agendar (segundos). */
  private readonly scheduleAhead = 0.1;
  /** Cada cuánto corre el scheduler (milisegundos). */
  private readonly intervalMs = 25;

  /** Beats ya agendados, para que los visuales sepan cuándo dibujar el flash. */
  readonly queue: ScheduledBeat[] = [];

  constructor(
    private readonly conductor: Conductor,
    private readonly beatsPerBar = 4,
  ) {}

  start(): void {
    this.nextBeat = Math.max(0, Math.ceil(this.conductor.beat));
    this.queue.length = 0;
    this.timer = window.setInterval(() => this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.queue.length = 0;
  }

  /** Agenda todos los beats que caigan dentro de la ventana de lookahead. */
  private tick(): void {
    const ctx = this.conductor.audio;
    while (this.conductor.audioTimeForBeat(this.nextBeat) < ctx.currentTime + this.scheduleAhead) {
      const time = this.conductor.audioTimeForBeat(this.nextBeat);
      const accent = this.nextBeat % this.beatsPerBar === 0; // el "1" de cada compás
      this.scheduleClick(time, accent);
      this.queue.push({ beat: this.nextBeat, time });
      this.nextBeat += 1;
    }
  }

  /** Un beep cortito EXACTAMENTE en `time`. El downbeat suena más agudo y fuerte. */
  private scheduleClick(time: number, accent: boolean): void {
    const ctx = this.conductor.audio;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = accent ? 1320 : 880;
    const peak = accent ? 0.35 : 0.22;
    // Envolvente rápida para que suene "tick" y no "beeeep".
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(peak, time + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.06);
  }
}
