// ui-sfx.ts — Efectos de sonido de la INTERFAZ (one-shot): el "woosh" de la transición
// de página y el "tick" al cambiar de canción en el listado. Samples reales por
// HTMLAudioElement, independientes del motor de ritmo (Conductor) y de la música de
// menú. Se disparan SIEMPRE por un gesto del usuario (click/tecla), así que la autoplay
// policy ya está desbloqueada cuando suenan — no hace falta el rearme que sí necesita
// la música de fondo (ver menu-music.ts).

export interface UiSfx {
  /** Woosh de la transición de página (el wipe START → SELECT → juego). */
  transition(): void;
  /** Tick al resaltar OTRA canción en el listado. */
  select(): void;
}

interface UiSfxOpts {
  /** Volumen del woosh (0..1, default 0.55). */
  transitionVolume?: number;
  /** Volumen del tick de selección (0..1, default 0.5). */
  selectVolume?: number;
}

export function createUiSfx(opts: UiSfxOpts = {}): UiSfx {
  // Disparador one-shot: reinicia el sample desde 0 en cada uso (re-dispara al toque,
  // aunque el anterior siga sonando, sin acumular elementos en el DOM). play() puede
  // rechazar si algo raro pasa con el audio — lo tragamos (best-effort, es sólo UI).
  const oneShot = (url: string, volume: number): (() => void) => {
    const audio = new Audio(url);
    audio.preload = "auto";
    audio.volume = volume;
    return () => {
      try {
        audio.currentTime = 0;
        void audio.play().catch(() => {});
      } catch {
        /* noop */
      }
    };
  };

  return {
    transition: oneShot("/sfx/woosh-transition.mp3", opts.transitionVolume ?? 0.55),
    select: oneShot("/sfx/select-song.mp3", opts.selectVolume ?? 0.5),
  };
}
