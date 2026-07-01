// menu-music.ts — Música de fondo de los MENÚS (START / SELECT / RESULT).
// Es un loop INDEPENDIENTE del motor de ritmo (Conductor): un HTMLAudioElement
// nativo, no un AudioContext. ¿Por qué separado? El Conductor se resetea y re-carga
// con cada canción jugable; la música de menú es sólo ambiente en loop, otra
// responsabilidad. Nada de mezclarlas.
//
// AUTOPLAY POLICY: los navegadores BLOQUEAN play() hasta que hay un gesto del
// usuario. Por eso, si el primer play() se rechaza, armamos un listener de "primer
// gesto" (pointerdown/keydown) y arrancamos ahí. Como el START pide un click/ENTER
// para entrar, la música empieza casi de inmediato de todos modos.

export interface MenuMusic {
  /** Estamos en un menú: sonar en loop (respeta la autoplay policy). */
  enter(): void;
  /** Salimos al gameplay/editor: pausar (sin resetear la posición del loop). */
  leave(): void;
  /** Silenciar/activar sin cortar la reproducción. */
  setMuted(muted: boolean): void;
}

interface MenuMusicOpts {
  /** Volumen 0..1 (default 0.6): presente, pero sin tapar la UI. */
  volume?: number;
}

export function createMenuMusic(url: string, opts: MenuMusicOpts = {}): MenuMusic {
  const audio = new Audio(url);
  audio.loop = true;
  audio.preload = "auto";
  audio.volume = opts.volume ?? 0.6;

  let wantPlaying = false; // fuente de verdad: ¿deberíamos estar sonando ahora?
  let armed = false; // ¿ya enganchamos el listener del "primer gesto"?

  // Arranca play(); si el autoplay está bloqueado (promesa rechazada) arma el unlock.
  function tryPlay(): void {
    void audio.play().catch(() => armUnlock());
  }

  // Espera el primer gesto del usuario y ahí reintenta. Removemos AMBOS listeners al
  // primero que dispare (no usamos {once} porque hay que sacar el otro también).
  function armUnlock(): void {
    if (armed) return;
    armed = true;
    const unlock = (): void => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      armed = false;
      if (wantPlaying) void audio.play().catch(() => {});
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
  }

  return {
    enter(): void {
      wantPlaying = true;
      tryPlay();
    },
    leave(): void {
      wantPlaying = false;
      audio.pause();
      // Rebobinamos al salir de los menús (a jugar o al editor): la próxima vez que
      // volvés al lobby, la música arranca DESDE EL PRINCIPIO, no desde donde quedó.
      // Navegar ENTRE menús (start↔select↔result) nunca pasa por leave() → no se corta.
      audio.currentTime = 0;
    },
    setMuted(muted: boolean): void {
      audio.muted = muted;
    },
  };
}
