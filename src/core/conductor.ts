// conductor.ts — EL RELOJ MAESTRO. El corazón de TODO juego rítmico.
//
// Regla de oro que casi nadie respeta y por eso sus juegos se sienten rotos:
// la fuente de verdad del tiempo es `AudioContext.currentTime`, NO el
// `requestAnimationFrame`, NI el `currentTime` de un <audio>. El reloj de la
// Web Audio API está atado a los samples de la placa de sonido: es preciso al
// microsegundo y nunca se desincroniza del audio que se está escuchando.

import { type Chart, beatToSeconds, secondsToBeat } from "./chart";

export class Conductor {
  /** El AudioContext: nuestro reloj físico, atado a la salida de audio. */
  readonly audio: AudioContext;
  /** bpm/offset/bars. Mutable: se setea al cargar una canción (BPM detectado). */
  chart: Chart;

  /** El audio decodificado (null = solo metrónomo, sin canción todavía). */
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;

  /** `audio.currentTime` en el instante en que arrancó la canción. */
  private startTime = 0;
  /** Posición (en seg) donde se pausó, para poder reanudar sin saltos. */
  private pausedAt = 0;
  private running = false;

  constructor(chart: Chart, audio: AudioContext = new AudioContext()) {
    this.chart = chart;
    this.audio = audio;
  }

  /**
   * El AudioContext nace "suspended" por política del navegador. Hay que
   * reanudarlo desde un gesto del usuario (un click / una tecla). Si no,
   * `audio.currentTime` se queda clavado en 0 y nada avanza.
   */
  async resume(): Promise<void> {
    if (this.audio.state !== "running") {
      await this.audio.resume();
    }
  }

  /** Descarga y decodifica el audio. Devuelve el AudioBuffer (para detectar BPM). */
  async load(url: string): Promise<AudioBuffer> {
    const response = await fetch(url);
    const data = await response.arrayBuffer();
    this.buffer = await this.audio.decodeAudioData(data);
    return this.buffer;
  }

  /** Arranca (o reanuda) desde `pausedAt`. `playAudio=false` => solo metrónomo. */
  start(playAudio = true): void {
    this.startTime = this.audio.currentTime - this.pausedAt;
    if (playAudio && this.buffer) {
      // Un AudioBufferSourceNode es de UN solo uso: hay que crear uno nuevo cada vez.
      this.source = this.audio.createBufferSource();
      this.source.buffer = this.buffer;
      this.source.connect(this.audio.destination);
      this.source.start(this.audio.currentTime, this.pausedAt); // 2º arg = desde qué seg
    }
    this.running = true;
  }

  pause(): void {
    this.pausedAt = this.time;
    this.running = false;
    this.stopSource();
  }

  /** Vuelve al principio (posición 0): para arrancar una canción desde el inicio. */
  reset(): void {
    this.pausedAt = 0;
    this.running = false;
    this.stopSource();
  }

  private stopSource(): void {
    if (this.source) {
      this.source.stop();
      this.source.disconnect();
      this.source = null;
    }
  }

  /** Posición de la canción en SEGUNDOS. Esta es la única fuente de verdad. */
  get time(): number {
    return this.running ? this.audio.currentTime - this.startTime : this.pausedAt;
  }

  /** Posición de la canción en BEATS (fraccionario). Derivado de `time`. */
  get beat(): number {
    return secondsToBeat(this.chart, this.time);
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Latencia de salida del audio (entre que el sample sale del grafo y suena en el parlante). Best-effort: en algunos browsers (Safari) puede no estar disponible. */
  get audioOffsetSec(): number {
    const out = this.audio.outputLatency;
    if (typeof out === "number" && isFinite(out) && out > 0) return out;
    const base = this.audio.baseLatency;
    return typeof base === "number" && isFinite(base) ? base : 0;
  }

  /**
   * En qué instante del reloj de AUDIO suena un beat dado.
   * Lo usa el Scheduler para programar los clicks con anticipación.
   */
  audioTimeForBeat(beat: number): number {
    return this.startTime + beatToSeconds(this.chart, beat);
  }
}
