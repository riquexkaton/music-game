// sfx.ts — Efectos de sonido del gameplay, SINTETIZADOS con Web Audio. Son
// PERCUSIVOS (sin nota/tonalidad definida): cada uno es un "pitch drop" — el tono
// cae instantáneamente de agudo a grave, así el oído lo percibe como un GOLPE y
// no como una nota. ¿Por qué? Una nota tiene tonalidad y choca con canciones en
// otra tonalidad; un golpe percusivo pega con CUALQUIER canción. El "perfect"
// suma un riser de RUIDO (neutro) + un impacto en octavas (armónicos naturales,
// neutros) para que inspire sin desafinar. Cero archivos. Best-effort: si el
// AudioContext no expone los métodos, cada disparo es un no-op silencioso.

interface Hit {
  from: number; // frecuencia inicial (Hz)
  to: number; // frecuencia final — el "drop" rápido hasta acá es lo percusivo
  dur?: number; // largo del golpe en segundos
  peak?: number; // volumen pico (0..1)
  type?: OscillatorType;
  delay?: number; // segundos desde "ahora" (para capas/remates)
}

export interface Sfx {
  /** Tecla apretada: un "tok" corto y percusivo. Neutro: pega con cualquier canción. */
  key(): void;
  /** Acierto perfecto: riser de ruido que eleva + impacto en octavas. Fuerte, inspirador. */
  perfect(): void;
  /** Acierto bueno: un golpe simple, medio. */
  good(): void;
  /** Fallo: un "thud" grave y áspero. */
  miss(): void;
}

export function createSfx(ctx: AudioContext): Sfx {
  const canSynth =
    typeof ctx.createOscillator === "function" && typeof ctx.createGain === "function";
  const canNoise =
    canSynth &&
    typeof ctx.createBuffer === "function" &&
    typeof ctx.createBufferSource === "function" &&
    typeof ctx.createBiquadFilter === "function";

  /** Un golpe percusivo: oscilador con pitch drop + ataque instantáneo (transient). */
  function hit({ from, to, dur = 0.07, peak = 0.28, type = "sine", delay = 0 }: Hit): void {
    if (!canSynth) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, to), t + dur * 0.9);
    amp.gain.setValueAtTime(peak, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(amp).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** Un "riser": ruido blanco con un bandpass que sube → el fshhh ascendente que eleva. */
  function noiseSweep(dur: number, peak: number, fromHz: number, toHz: number): void {
    if (!canNoise) return;
    const t = ctx.currentTime;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.setValueAtTime(1.2, t);
    bp.frequency.setValueAtTime(fromHz, t);
    bp.frequency.exponentialRampToValueAtTime(toHz, t + dur);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(peak, t + dur * 0.7);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(amp).connect(ctx.destination);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  // Sample del "perfect": un orchestra hit (public/sfx/). Se carga en background;
  // hasta que llegue (o si falla la carga), el perfect cae al sintetizado.
  let perfectBuf: AudioBuffer | null = null;
  if (canSynth && typeof ctx.decodeAudioData === "function" && typeof fetch === "function") {
    fetch("/sfx/orchestra-hit.mp3")
      .then((r) => r.arrayBuffer())
      .then((b) => ctx.decodeAudioData(b))
      .then((buf) => {
        perfectBuf = buf;
      })
      .catch(() => {
        perfectBuf = null;
      });
  }

  /** Reproduce un sample (AudioBuffer) una vez, a `peak` de volumen. */
  function playSample(buf: AudioBuffer, peak: number): void {
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = buf;
    gain.gain.value = peak;
    src.connect(gain).connect(ctx.destination);
    src.start(ctx.currentTime);
  }

  return {
    key() {
      hit({ from: 840, to: 300, dur: 0.05, peak: 0.26, type: "triangle" });
    },
    perfect() {
      // El orchestra hit (sample) que pidió el usuario. Si todavía no cargó, cae al
      // sintetizado: riser que sube + impacto en octavas (armónicos naturales).
      if (perfectBuf) {
        playSample(perfectBuf, 0.85);
        return;
      }
      noiseSweep(0.2, 0.22, 700, 6500);
      hit({ from: 760, to: 380, dur: 0.16, peak: 0.32, type: "triangle", delay: 0.12 });
      hit({ from: 1520, to: 760, dur: 0.2, peak: 0.22, type: "triangle", delay: 0.12 });
      hit({ from: 2280, to: 1140, dur: 0.22, peak: 0.14, type: "sine", delay: 0.13 });
    },
    good() {
      hit({ from: 720, to: 280, dur: 0.06, peak: 0.22, type: "triangle" });
    },
    miss() {
      hit({ from: 320, to: 120, dur: 0.18, peak: 0.3, type: "sawtooth" });
    },
  };
}
