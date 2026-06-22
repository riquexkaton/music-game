// sequence.ts — La MÁQUINA DE ESTADOS de la secuencia (el corazón de Audition).
// El jugador teclea ← ↑ → ↓ EN ORDEN. Tres estados, y nada más:
//   loading -> cargando, falta(n) flecha(s)
//   ready   -> secuencia completa, lista para confirmar con Espacio
//   broken  -> tecleaste mal, se rompió (terminal hasta la próxima barra)
// Pura: no sabe de tiempo, ni audio, ni DOM. Solo "¿esta flecha va o no va?".

import type { Arrow } from "./chart";

export type SequenceStatus = "loading" | "ready" | "broken";

export class SequenceTracker {
  private index = 0;
  private status: SequenceStatus;

  constructor(private readonly sequence: Arrow[]) {
    // Caso borde: una secuencia vacía ya nace lista. Hay que contemplarlo.
    this.status = sequence.length === 0 ? "ready" : "loading";
  }

  /** Procesa una flecha. Correcta => avanza. Equivocada => se rompe. */
  press(arrow: Arrow): SequenceStatus {
    if (this.status !== "loading") return this.status; // ya terminó: ignorar
    if (arrow === this.sequence[this.index]) {
      this.index += 1;
      if (this.index >= this.sequence.length) this.status = "ready";
    } else {
      this.status = "broken";
    }
    return this.status;
  }

  get loaded(): number {
    return this.index;
  }
  get total(): number {
    return this.sequence.length;
  }
  get state(): SequenceStatus {
    return this.status;
  }
  get isReady(): boolean {
    return this.status === "ready";
  }
  get isBroken(): boolean {
    return this.status === "broken";
  }
}
