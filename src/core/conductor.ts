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

  /**
   * Cadena de salida del audio de la canción: source -> gain (mute) -> analyser -> destination.
   * Se crea perezosamente y SOLO si el AudioContext expone los métodos (en los
   * tests el AudioContext es falso y no los tiene; ahí queda todo en null y no se toca).
   */
  private gain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private freqData: Uint8Array<ArrayBuffer> | null = null;
  private muted = false;

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
      this.source.connect(this.outputNode());
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

  /**
   * Salta a una posición arbitraria (segundos) de la canción. Lo usa el editor para
   * moverse sin tener que escuchar todo (p. ej. ir al final a marcar la 2ª ancla).
   * Un AudioBufferSourceNode NO se re-posiciona: si está sonando, lo paramos y
   * arrancamos uno nuevo desde el destino (mismo patrón que start()); si está en
   * pausa, sólo movemos pausedAt para que el próximo start() arranque desde ahí.
   * Se clampa a [0, duración]. `start(hadAudio)` preserva si sonaba audio o sólo
   * el reloj (calibración con start(false)).
   */
  seek(seconds: number): void {
    const max = this.buffer ? this.buffer.duration : Infinity;
    const target = Math.max(0, Math.min(seconds, max));
    const wasRunning = this.running;
    const hadAudio = this.source !== null;
    if (wasRunning) this.pause();
    this.pausedAt = target;
    if (wasRunning) this.start(hadAudio);
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

  /**
   * Construye (una vez) la cadena gain -> analyser -> destination y devuelve el
   * nodo al que conectar el source. Best-effort: si el AudioContext no tiene
   * `createGain`/`createAnalyser` (tests con un clock falso) cae a `destination`.
   */
  private outputNode(): AudioNode {
    const ctx = this.audio as AudioContext & {
      createGain?: () => GainNode;
      createAnalyser?: () => AnalyserNode;
    };
    if (!this.analyser && typeof ctx.createAnalyser === "function" && typeof ctx.createGain === "function") {
      try {
        this.gain = ctx.createGain();
        this.analyser = ctx.createAnalyser();
        this.analyser.fftSize = 256;
        this.freqData = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
        this.gain.gain.value = this.muted ? 0 : 1;
        this.gain.connect(this.analyser);
        this.analyser.connect(this.audio.destination);
      } catch {
        this.gain = null;
        this.analyser = null;
        this.freqData = null;
      }
    }
    return this.gain ?? this.audio.destination;
  }

  /** Silencia/activa el audio de la canción (no afecta el reloj ni el scheduler). */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.gain) this.gain.gain.value = muted ? 0 : 1;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /**
   * Espectro de frecuencias del audio que suena AHORA (0..255 por bin), o null
   * si todavía no hay analyser (sin audio o entorno sin Web Audio real).
   * Lo consume waves.ts para reaccionar al audio real.
   */
  getFrequencyData(): Uint8Array | null {
    if (!this.analyser || !this.freqData) return null;
    this.analyser.getByteFrequencyData(this.freqData);
    return this.freqData;
  }

  /** Duración en segundos del audio cargado (0 si no hay buffer). */
  get duration(): number {
    return this.buffer ? this.buffer.duration : 0;
  }
}
