// editor.ts — Vista "PULSE.EDITOR" (pantalla #screen-editor, estética Pulse, brutalist).
//
// FASE 1: ANDAMIAJE. Construye TODO el DOM del editor por JS (igual que game.ts y
// menu.ts) y expone una `EditorApi` con hooks (que main.ts cablea) + métodos de
// render. NO conoce el motor: la "vida" real (waveform decodificado, transport en
// vivo, tap-tempo, sync-por-anclas conectado, marcado de descansos sobre la onda,
// monitor en vivo, Probar→#screen-play, Export) la cablea FASE 2 sobre los huecos
// que esta API ya deja declarados.
//
// El diseño es la fuente de verdad del markup/clases/colores: portado de
// claude.ai/design "Pulse Editor". La lógica de demo (estado mock) NO se copia.

import "./pulse.css";
import type { DifficultyName } from "../core/song";

const ACCENTS = ["#c8ff1e", "#25e0ff", "#ff2e9a", "#ffd021", "#a78bfa", "#ff7847"];
const DIFFS: { name: DifficultyName; label: string }[] = [
  { name: "easy", label: "FÁCIL" },
  { name: "normal", label: "MEDIO" },
  { name: "hard", label: "EXPERTO" },
];

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      default: return "&quot;";
    }
  });
}

// ---------------- tipos de datos que main.ts pasa por render ----------------

/** Una fila de la lista de pistas (izquierda). Derivada de SongConfig por main.ts. */
export interface TrackInfo {
  id: string;
  /** "01", "02", … (índice 1-based, padded). */
  num: string;
  title: string;
  /** BPM ya redondeado, o "—" si no hay tempo. */
  bpm: string;
  /** Etiqueta de dificultad ("MEDIO"). */
  diff: string;
  /** Duración "m:ss", o "—" si el audio no se midió aún. */
  len: string;
  accent: string;
  /** true = jugable (sync manual): badge ✓ SYNC con accent vivo. false = ◆ AUTO. */
  synced: boolean;
  /** Cantidad de descansos marcados (para el dot + label). */
  breaks: number;
  /** Sólo las subidas se pueden borrar (las builtin no). Controla el ✕. */
  removable: boolean;
}

/** Datos del song header + monitor para la canción en edición. */
export interface EditorSongInfo {
  title: string;
  artist: string;
  /** Duración "m:ss". */
  len: string;
  /** BPM (número como string) o "—". */
  bpm: string;
  /** Origen del tempo: "manual" | "auto" | "—". */
  source: string;
  accent: string;
  difficulty: DifficultyName;
}

/** Estado del status pill del header (esquina derecha del song header). */
export interface EditorStatus {
  label: string;
  /** Color del borde + texto del pill (hex). */
  color: string;
}

/** Lectura del panel 02 Sync (sync por 2 anclas). main.ts la alimenta desde TempoFit. */
export interface SyncReadout {
  /** BPM ajustado, o "—". */
  bpm: string;
  /** Offset "+N ms", o "—". */
  offset: string;
  /** Estado/instrucción del flujo de marcado. */
  confidence: string;
  /** "N / 2 marcas", o "—". */
  count: string;
  /** ¿Hay un sync en curso? (activa el bloque y habilita cancelar; deshabilita empezar). */
  active: boolean;
  /** ¿Se puede guardar ya? (las 2 anclas marcadas). Si se omite, cae a `active`. */
  canSave?: boolean;
}

/** Una fila de la lista de descansos (panel 03). */
export interface BreakInfo {
  /** id estable para borrar. */
  id: string;
  /** Rango "m:ss → m:ss". */
  range: string;
  /** Duración legible "N.N s de pausa" o "N compases". */
  dur: string;
}

/** Monitor inferior (en vivo en Fase 2). */
export interface MonitorInfo {
  /** Texto del beat actual ("0.00"). */
  beat: string;
  /** Estado ("RITMO" | "INTRO" | "DESCANSO"). */
  state: string;
  /** Color del estado (hex). */
  stateColor: string;
}

// ---------------- hooks (main.ts los cablea) ----------------

/**
 * Hooks de la vista. En FASE 1 main.ts cablea los SIMPLES (marcados ✅); el resto
 * son huecos que FASE 2 conecta al motor (marcados 🔜).
 */
export interface EditorHooks {
  /** ✅ El usuario eligió otra pista en la lista. */
  onSelectSong: (id: string) => void;
  /** ✅ Botón SUBIR PISTA → abre el file picker (la vista dispara el <input>). */
  onUpload: (file: File) => void;
  /** ✅ ✕ en una card → borrar pista (sólo subidas; main.ts confirma). */
  onDeleteSong: (id: string) => void;
  /** ✅ Cambió la dificultad (3 botones del header). */
  onSetDifficulty: (diff: DifficultyName) => void;

  // ---- panel 01 Tempo (🔜 Fase 2 los conecta a core/tempo + detección) ----
  /** 🔜 DETECTAR AUTO (web-audio-beat-detector). */
  onDetect: () => void;
  /** 🔜 BPM manual ± (delta +1/-1). */
  onBpmStep: (delta: number) => void;
  /** 🔜 TAP (un golpe de tap-tempo). */
  onTap: () => void;
  /** 🔜 APLICAR el BPM del tap-tempo. */
  onApplyTap: () => void;

  // ---- panel 02 Sync (sync por 2 anclas lejanas: 2 downbeats con ESPACIO) ----
  /** Iniciar el sync por 2 anclas (arranca audio desde 0). */
  onSyncStart: () => void;
  /** Una marca del sync (un downbeat). Normalmente lo dispara ESPACIO. */
  onSyncTap: () => void;
  /** Guardar la grilla de las 2 anclas (tempoSource:'manual'). */
  onSyncSave: () => void;
  /** Cancelar el sync en curso. */
  onSyncCancel: () => void;
  /** Ajustar el conteo de compases entre las 2 marcas (±1). */
  onAnchorBarsStep: (delta: number) => void;
  /** Fijar el INICIO DEL JUEGO en el cabezal (▶ ARRANCAR EN EL CABEZAL). */
  onFixStart: () => void;
  /** 🔜 Offset fino ± (delta en ms: ±5 / ±1). */
  onOffsetStep: (deltaMs: number) => void;

  // ---- panel 03 Descansos (🔜 Fase 2: marcado SOBRE la onda) ----
  /** 🔜 Toggle del modo "marcar descanso" (clic-clic sobre la onda). */
  onToggleMark: () => void;
  /** 🔜 Borrar un descanso de la lista. */
  onDelRest: (id: string) => void;

  // ---- transport (🔜 Fase 2: play/pausa/seek del audio) ----
  /** 🔜 Play / pausa. */
  onPlay: () => void;
  /** 🔜 Volver al inicio (⏮). */
  onRestart: () => void;
  /** 🔜 Clic sobre la onda: mover el cabezal (o marcar descanso si está en modo). */
  onWaveClick: (fraction: number) => void;

  // ---- acciones (✅ GUARDAR; 🔜 Probar/Export) ----
  /** 🔜 ►PROBAR → salta al gameplay real (#screen-play). */
  onProbar: () => void;
  /** 🔜 ⤓EXPORTAR el chart a JSON. */
  onExport: () => void;
  /** ✅ ▣GUARDAR la config (persistir). */
  onSave: () => void;
}

// ---------------- API pública (main.ts pinta con esto) ----------------

export interface EditorApi {
  /** Re-renderiza la lista de pistas y marca la seleccionada. */
  renderTrackList: (songs: TrackInfo[], selId: string | null) => void;
  /** Setea el song header + monitor (título/artista/dur/BPM/source/dificultad). */
  setSong: (info: EditorSongInfo | null) => void;
  /** Refleja el BPM en el header y en el contador del panel Tempo. */
  setBpm: (bpm: string) => void;
  /** Status pill del header (FALTA SYNC / LISTA / …). */
  setStatus: (status: EditorStatus) => void;
  /** Displays del panel 02 Sync (BPM/offset/estado/marcas). */
  setSyncReadout: (readout: SyncReadout) => void;
  /** Stepper "compases entre marcas" del sync por 2 anclas (valor + activo). */
  setAnchorBars: (label: string, active: boolean) => void;
  /** Texto del readout del tap-tempo + estado del botón APLICAR (panel 01). */
  setTapReadout: (text: string, canApply: boolean, applyLabel?: string) => void;
  /** Etiqueta + color del INICIO DEL JUEGO (panel 02): "m:ss.d s" rosa / "sin definir". */
  setGameStart: (label: string, color: string) => void;
  /** Offset fino mostrado (panel 02). */
  setOffset: (label: string) => void;
  /** Lista de descansos (panel 03) + contador. */
  renderBreaks: (breaks: BreakInfo[]) => void;
  /** Monitor inferior (beat/estado en vivo en Fase 2). */
  setMonitor: (info: MonitorInfo) => void;
  /** Reloj del transport ("0:00.0"). */
  setTime: (clock: string) => void;
  /** Posición del cabezal sobre la onda (0..1). */
  setPlayhead: (fraction: number) => void;
  /** Estado visual del botón play (playing = glyph ❚❚). */
  setPlaying: (playing: boolean) => void;
  /** Activa/desactiva el modo "marcar descanso" (cambia botón + pill + cursor). */
  setMarkMode: (marking: boolean, pendingStart: boolean) => void;
  /** Toast brutalist efímero (texto + color de fondo). */
  toast: (text: string, color?: string) => void;
  /** Muestra/oculta el tooltip "no se puede pausar durante el sync" (anclado al play). */
  setSyncLock: (active: boolean) => void;
  /** Sacude el tooltip del sync-lock (si está visible) cuando el usuario insiste en pausar. */
  bumpSyncLock: () => void;
  /** El <canvas> de la onda — Fase 2 dibuja el waveform real acá. */
  getCanvas: () => HTMLCanvasElement;
  /** El contenedor de la onda — Fase 2 mide su tamaño y posiciona overlays acá. */
  getWaveBox: () => HTMLElement;
  /** El acento de la canción actual (para teñir #screen-play al Probar). */
  currentAccent: () => string;
}

export function createEditor(root: HTMLElement, hooks: EditorHooks): EditorApi {
  let accent = ACCENTS[0]!;

  // ---------------- DOM (portado del diseño "Pulse Editor") ----------------
  // Estructura: SYSTEM BAR · HEADER · MAIN[ lista de pistas | workspace ].
  // El workspace: SONG HEADER · WAVEFORM+TRANSPORT · 3 PANELES · MONITOR+ACTIONS.
  // Los <input type=file> y las clases viven en pulse.css (#screen-editor …).
  root.innerHTML = `
    <input type="file" id="ple-file" accept="audio/*" class="ple-file-input" />

    <div class="ple-shell">
      <!-- HEADER -->
      <div class="ple-header">
        <div class="ple-header-logo">
          <span class="ple-logo-word">PULSE<span class="ple-logo-dot">.</span>EDITOR</span>
        </div>
        <div class="ple-header-sub">CHARTING · SYNC · DESCANSOS</div>
        <div class="pl-grow"></div>
        <div class="ple-header-kbd"><kbd class="ple-kbd">ESPACIO</kbd> PLAY / PAUSA</div>
      </div>

      <!-- MAIN -->
      <div class="ple-main">

        <!-- ===== LEFT: TRACK LIST ===== -->
        <aside class="ple-tracks">
          <div class="ple-tracks-head">
            <span class="ple-tracks-title">Pistas</span>
            <span class="ple-tracks-count" id="ple-track-count">0 TOTAL</span>
          </div>
          <div class="ple-tracks-scroll ed-scroll" id="ple-track-list"></div>
          <div class="ple-tracks-foot">
            <button type="button" class="ple-upload-btn" id="ple-upload">
              <span class="ple-upload-plus">＋</span> SUBIR PISTA
            </button>
            <div class="ple-upload-note">MP3 · WAV · OGG — ARRASTRÁ O ELEGÍ</div>
          </div>
        </aside>

        <!-- ===== RIGHT: WORKSPACE ===== -->
        <section class="ple-workspace">

          <!-- SONG HEADER -->
          <div class="ple-song-header">
            <div class="ple-song-accent" id="ple-song-accent"></div>
            <div class="ple-song-id">
              <div class="ple-song-title" id="ple-song-title">—</div>
              <div class="ple-song-meta" id="ple-song-meta">—</div>
            </div>
            <div class="ple-song-tempo">
              <div class="ple-field-label">TEMPO</div>
              <div class="ple-tempo-row">
                <span class="ple-tempo-bpm" id="ple-song-bpm">—</span>
                <span class="ple-tempo-unit" id="ple-song-source">BPM · —</span>
              </div>
            </div>
            <div class="ple-song-diff">
              <div class="ple-field-label">DIFICULTAD</div>
              <div class="ple-diff-btns" id="ple-diff-btns"></div>
            </div>
            <div class="ple-song-status">
              <span class="ple-status-pill" id="ple-status-pill">—</span>
            </div>
          </div>

          <!-- WAVEFORM + TRANSPORT -->
          <div class="ple-wave-section">
            <!-- transport row -->
            <div class="ple-transport">
              <button type="button" class="ple-play-btn" id="ple-play">►</button>
              <button type="button" class="ple-restart-btn" id="ple-restart">⏮</button>
              <div class="ple-clock">
                <span class="ple-clock-now" id="ple-time">0:00.0</span>
                <span class="ple-clock-total">/ <span id="ple-len-total">0:00</span></span>
              </div>
              <div class="pl-grow"></div>
              <div class="ple-mark-pill" id="ple-mark-pill">CLIC EN LA ONDA = MOVER CABEZAL</div>
              <!-- tooltip anclado al play: durante el sync no se puede pausar
                   (ESPACIO marca anclas). Lo prende/apaga setSyncLock desde main.ts. -->
              <div class="ple-sync-lock" id="ple-sync-lock" hidden>
                <span class="ple-sync-lock-ico">⏸</span>
                <span>NO SE PUEDE PAUSAR DURANTE EL SYNC — MARCÁ <kbd class="ple-kbd">ESPACIO</kbd> O CANCELÁ</span>
              </div>
            </div>
            <!-- wave: <canvas> + overlays (Fase 2 los dibuja/posiciona) -->
            <div class="ple-wave-box" id="ple-wave-box">
              <canvas class="ple-wave-canvas" id="ple-wave-canvas"></canvas>
              <!-- overlays de descansos (Fase 2 los puebla) -->
              <div class="ple-wave-overlays" id="ple-wave-overlays"></div>
              <!-- cabezal (lo mueve setPlayhead) -->
              <div class="ple-playhead" id="ple-playhead"></div>
              <!-- placeholder mientras Fase 2 no dibuja la onda -->
              <div class="ple-wave-placeholder" id="ple-wave-ph">ONDA — SE DIBUJA EN FASE 2</div>
            </div>
            <!-- ruler (Fase 2 puebla los ticks) -->
            <div class="ple-ruler" id="ple-ruler"></div>
          </div>

          <!-- TOOL PANELS -->
          <div class="ple-panels-scroll ed-scroll">
            <div class="ple-panels">

              <!-- 01 TEMPO -->
              <div class="ple-panel ple-panel-bordered">
                <div class="ple-panel-head">
                  <span class="ple-panel-num lime">01</span>
                  <span class="ple-panel-title">Tempo / BPM</span>
                </div>
                <button type="button" class="ple-detect-btn" id="ple-detect">⟳ DETECTAR AUTO</button>

                <div class="ple-field-label ple-mb9">BPM MANUAL</div>
                <div class="ple-stepper ple-mb18">
                  <button type="button" class="ple-step-btn" id="ple-bpm-down">−</button>
                  <div class="ple-step-val"><span id="ple-bpm-val">—</span></div>
                  <button type="button" class="ple-step-btn" id="ple-bpm-up">＋</button>
                </div>

                <div class="ple-field-label ple-mb9">TAP TEMPO — MARCÁ EL PULSO</div>
                <button type="button" class="ple-tap-btn" id="ple-tap">
                  <span class="ple-tap-word">TAP</span>
                  <span class="ple-tap-readout" id="ple-tap-readout">tocá 4+ veces</span>
                </button>
                <button type="button" class="ple-apply-tap-btn" id="ple-apply-tap" disabled>APLICAR (4+ taps)</button>
              </div>

              <!-- 02 SYNC (sync-por-anclas + tap-tempo + offset fino — decisión del usuario) -->
              <div class="ple-panel ple-panel-bordered">
                <div class="ple-panel-head">
                  <span class="ple-panel-num lime">02</span>
                  <span class="ple-panel-title">Sync</span>
                </div>

                <!-- bloque SYNC POR 2 ANCLAS (marcar 2 downbeats lejanos con ESPACIO) -->
                <div class="ple-field-label ple-mb9">SYNC POR 2 ANCLAS — MARCÁ 2 DOWNBEATS</div>
                <div class="ple-sync-block" id="ple-sync-block">
                  <div class="ple-sync-readout">
                    <div class="ple-sync-row">BPM <b id="ple-sync-bpm">—</b></div>
                    <div class="ple-sync-row">OFFSET <b id="ple-sync-offset">—</b></div>
                    <div class="ple-sync-row">ESTADO <b id="ple-sync-conf">marcá 2 downbeats lejanos</b></div>
                    <div class="ple-sync-row ple-sync-count" id="ple-sync-count">—</div>
                  </div>
                  <div class="ple-anchor-bars" id="ple-anchor-bars">
                    <span class="ple-field-label">COMPASES ENTRE MARCAS</span>
                    <div class="ple-stepper">
                      <button type="button" class="ple-step-btn" id="ple-bars-down" disabled>−</button>
                      <div class="ple-step-val"><span id="ple-bars-val">—</span></div>
                      <button type="button" class="ple-step-btn" id="ple-bars-up" disabled>＋</button>
                    </div>
                  </div>
                  <div class="ple-sync-actions">
                    <button type="button" class="ple-sync-start-btn" id="ple-sync-start">◉ EMPEZAR · 2 MARCAS</button>
                    <button type="button" class="ple-sync-save-btn" id="ple-sync-save" disabled>✓ GUARDAR SYNC</button>
                    <button type="button" class="ple-sync-cancel-btn" id="ple-sync-cancel" disabled>CANCELAR</button>
                  </div>
                </div>
                <div class="ple-panel-note">Marcá <strong>ESPACIO</strong> en el <strong>"1"</strong> de un compás al principio, y en otro <strong>"1"</strong> bien al final. Cuanto más lejos la 2ª marca, más preciso. Confirmá los compases y guardá.</div>

                <!-- bloque INICIO DEL JUEGO (las flechas arrancan acá; el intro no exige input) -->
                <div class="ple-field-label ple-mb9 ple-mt18">INICIO DEL JUEGO</div>
                <div class="ple-start-block">
                  <div class="ple-start-readout">
                    <span class="ple-start-val" id="ple-start-val">sin definir</span>
                  </div>
                  <button type="button" class="ple-start-btn" id="ple-fix-start">▶ ARRANCAR EN EL CABEZAL</button>
                </div>
                <div class="ple-panel-note ple-mb20">Las flechas arrancan acá. Tiene que ir <strong>antes del primer descanso</strong> — el editor no te deja chocarlo.</div>

                <!-- bloque OFFSET FINO -->
                <div class="ple-field-label ple-mb9">SYNC FINO — OFFSET</div>
                <div class="ple-offset-stepper">
                  <button type="button" class="ple-off-btn" data-off="-5">−5</button>
                  <button type="button" class="ple-off-btn" data-off="-1">−1</button>
                  <div class="ple-off-val"><span id="ple-offset-val">+0 ms</span></div>
                  <button type="button" class="ple-off-btn" data-off="1">+1</button>
                  <button type="button" class="ple-off-btn" data-off="5">+5</button>
                </div>
                <div class="ple-panel-note ple-mt10">Corrige la latencia de teclado/audio en milisegundos.</div>
              </div>

              <!-- 03 DESCANSOS -->
              <div class="ple-panel ple-panel-breaks">
                <div class="ple-panel-head ple-panel-head-spread">
                  <div class="ple-panel-head-left">
                    <span class="ple-panel-num yellow">03</span>
                    <span class="ple-panel-title">Descansos</span>
                  </div>
                  <span class="ple-breaks-count" id="ple-breaks-count">0</span>
                </div>
                <button type="button" class="ple-mark-btn" id="ple-mark">＋ MARCAR DESCANSO</button>
                <div class="ple-mark-instr" id="ple-mark-instr">Marcá tramos sin input. El cabezal espera y la canción no exige flechas.</div>
                <div class="ple-breaks-list ed-scroll" id="ple-breaks-list"></div>
              </div>

            </div>
          </div>

          <!-- MONITOR + ACTIONS -->
          <div class="ple-footbar">
            <div class="ple-monitor ed-scroll">
              <div class="ple-mon-cell">
                <span class="ple-mon-label">CANCIÓN</span>
                <span class="ple-mon-val" id="ple-mon-song">—</span>
              </div>
              <div class="ple-mon-cell">
                <span class="ple-mon-label">BEAT</span>
                <span class="ple-mon-val" id="ple-mon-beat">0.00</span>
              </div>
              <div class="ple-mon-cell">
                <span class="ple-mon-label">ESTADO</span>
                <span class="ple-mon-val" id="ple-mon-state">RITMO</span>
              </div>
              <div class="ple-mon-cell">
                <span class="ple-mon-label">DESCANSOS</span>
                <span class="ple-mon-val yellow" id="ple-mon-breaks">0</span>
              </div>
            </div>
            <div class="ple-actions">
              <button type="button" class="ple-act-probar" id="ple-probar">► PROBAR</button>
              <button type="button" class="ple-act-export" id="ple-export">⤓ EXPORTAR</button>
              <button type="button" class="ple-act-save" id="ple-save">▣ GUARDAR</button>
            </div>
          </div>

        </section>
      </div>

      <!-- TOAST -->
      <div class="ple-toast" id="ple-toast" hidden></div>
    </div>`;

  const $ = (id: string): HTMLElement => root.querySelector(`#${id}`) as HTMLElement;

  // ----- refs -----
  const fileInput = $("ple-file") as HTMLInputElement;
  const trackCountEl = $("ple-track-count");
  const trackListEl = $("ple-track-list");
  const uploadBtn = $("ple-upload") as HTMLButtonElement;
  const songTitleEl = $("ple-song-title");
  const songMetaEl = $("ple-song-meta");
  const songBpmEl = $("ple-song-bpm");
  const songSourceEl = $("ple-song-source");
  const diffBtnsEl = $("ple-diff-btns");
  const statusPillEl = $("ple-status-pill");
  // transport
  const playBtn = $("ple-play") as HTMLButtonElement;
  const restartBtn = $("ple-restart") as HTMLButtonElement;
  const timeEl = $("ple-time");
  const lenTotalEl = $("ple-len-total");
  const markPillEl = $("ple-mark-pill");
  const syncLockEl = $("ple-sync-lock");
  // wave
  const waveBox = $("ple-wave-box");
  const waveCanvas = $("ple-wave-canvas") as HTMLCanvasElement;
  const playheadEl = $("ple-playhead");
  // panel 01
  const detectBtn = $("ple-detect") as HTMLButtonElement;
  const bpmDownBtn = $("ple-bpm-down") as HTMLButtonElement;
  const bpmUpBtn = $("ple-bpm-up") as HTMLButtonElement;
  const bpmValEl = $("ple-bpm-val");
  const tapBtn = $("ple-tap") as HTMLButtonElement;
  const tapReadoutEl = $("ple-tap-readout");
  const applyTapBtn = $("ple-apply-tap") as HTMLButtonElement;
  // panel 02
  const syncBpmEl = $("ple-sync-bpm");
  const syncOffsetEl = $("ple-sync-offset");
  const syncConfEl = $("ple-sync-conf");
  const syncCountEl = $("ple-sync-count");
  const syncStartBtn = $("ple-sync-start") as HTMLButtonElement;
  const syncSaveBtn = $("ple-sync-save") as HTMLButtonElement;
  const syncCancelBtn = $("ple-sync-cancel") as HTMLButtonElement;
  const anchorBarsRow = $("ple-anchor-bars");
  const barsDownBtn = $("ple-bars-down") as HTMLButtonElement;
  const barsUpBtn = $("ple-bars-up") as HTMLButtonElement;
  const barsValEl = $("ple-bars-val");
  const startValEl = $("ple-start-val");
  const fixStartBtn = $("ple-fix-start") as HTMLButtonElement;
  const offsetValEl = $("ple-offset-val");
  // panel 03
  const breaksCountEl = $("ple-breaks-count");
  const markBtn = $("ple-mark") as HTMLButtonElement;
  const markInstrEl = $("ple-mark-instr");
  const breaksListEl = $("ple-breaks-list");
  // monitor + actions
  const monSongEl = $("ple-mon-song");
  const monBeatEl = $("ple-mon-beat");
  const monStateEl = $("ple-mon-state");
  const monBreaksEl = $("ple-mon-breaks");
  const probarBtn = $("ple-probar") as HTMLButtonElement;
  const exportBtn = $("ple-export") as HTMLButtonElement;
  const saveBtn = $("ple-save") as HTMLButtonElement;
  const toastEl = $("ple-toast");

  // ---------------- acento de la canción ----------------
  function applyAccent(hex: string): void {
    accent = hex;
    root.style.setProperty("--ed-accent", hex);
  }

  // ---------------- botones de dificultad (header) ----------------
  // Se construyen una vez; setSong marca el activo según la canción.
  for (const d of DIFFS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ple-diff-btn";
    btn.dataset.diff = d.name;
    btn.textContent = d.label;
    btn.addEventListener("click", () => hooks.onSetDifficulty(d.name));
    diffBtnsEl.appendChild(btn);
  }
  function markDiff(diff: DifficultyName): void {
    diffBtnsEl.querySelectorAll<HTMLElement>(".ple-diff-btn").forEach((el) => {
      el.classList.toggle("on", el.dataset.diff === diff);
    });
  }

  // ---------------- upload (✅ real: file input oculto) ----------------
  uploadBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) hooks.onUpload(file);
    fileInput.value = ""; // permitir re-subir el mismo archivo
  });

  // ---------------- cableado de hooks a los botones ----------------
  // transport
  playBtn.addEventListener("click", () => hooks.onPlay());
  restartBtn.addEventListener("click", () => hooks.onRestart());
  waveBox.addEventListener("click", (e) => {
    const rect = waveBox.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    hooks.onWaveClick(frac);
  });
  // panel 01
  detectBtn.addEventListener("click", () => hooks.onDetect());
  bpmDownBtn.addEventListener("click", () => hooks.onBpmStep(-1));
  bpmUpBtn.addEventListener("click", () => hooks.onBpmStep(1));
  tapBtn.addEventListener("click", () => hooks.onTap());
  applyTapBtn.addEventListener("click", () => hooks.onApplyTap());
  // panel 02
  syncStartBtn.addEventListener("click", () => hooks.onSyncStart());
  syncSaveBtn.addEventListener("click", () => hooks.onSyncSave());
  syncCancelBtn.addEventListener("click", () => hooks.onSyncCancel());
  barsDownBtn.addEventListener("click", () => hooks.onAnchorBarsStep(-1));
  barsUpBtn.addEventListener("click", () => hooks.onAnchorBarsStep(1));
  fixStartBtn.addEventListener("click", () => hooks.onFixStart());
  root.querySelectorAll<HTMLButtonElement>(".ple-off-btn").forEach((btn) => {
    btn.addEventListener("click", () => hooks.onOffsetStep(Number(btn.dataset.off)));
  });
  // panel 03
  markBtn.addEventListener("click", () => hooks.onToggleMark());
  // acciones
  probarBtn.addEventListener("click", () => hooks.onProbar());
  exportBtn.addEventListener("click", () => hooks.onExport());
  saveBtn.addEventListener("click", () => hooks.onSave());

  // ---------------- render: lista de pistas ----------------
  function renderTrackList(songs: TrackInfo[], selId: string | null): void {
    trackCountEl.textContent = `${songs.length} TOTAL`;
    trackListEl.innerHTML = "";
    songs.forEach((s, i) => {
      const on = s.id === selId;
      const card = document.createElement("div");
      card.className = `ple-track-card${on ? " on" : ""}`;
      card.style.setProperty("--card-accent", s.accent);
      card.style.animationDelay = `${i * 45}ms`;
      card.dataset.id = s.id;
      const badgeCls = s.synced ? "ple-track-badge synced" : "ple-track-badge auto";
      const badgeLabel = s.synced ? "✓ SYNC" : "◆ AUTO";
      const delBtn = s.removable
        ? `<span class="ple-track-del" data-del="${escapeHtml(s.id)}" title="Borrar pista">✕</span>`
        : "";
      const breakLabel = s.breaks
        ? `${s.breaks} ${s.breaks === 1 ? "descanso" : "descansos"}`
        : "sin descansos";
      card.innerHTML = `
        <div class="ple-track-top">
          <span class="ple-track-num">PISTA ${s.num}</span>
          <div class="ple-track-top-right">
            <span class="${badgeCls}">${badgeLabel}</span>
            ${delBtn}
          </div>
        </div>
        <div class="ple-track-title">${escapeHtml(s.title)}</div>
        <div class="ple-track-meta">
          <span class="ple-track-bpm">${escapeHtml(s.bpm)}</span><span>BPM</span>
          <span class="ple-track-sep">·</span><span>${escapeHtml(s.diff)}</span>
          <span class="ple-track-sep">·</span><span>${escapeHtml(s.len)}</span>
        </div>
        <div class="ple-track-breaks">
          <span class="ple-track-dot${s.breaks ? " on" : ""}"></span>
          <span class="ple-track-break-label">${breakLabel}</span>
        </div>`;
      // clic en la card = seleccionar; clic en ✕ = borrar (sin propagar).
      card.addEventListener("click", () => hooks.onSelectSong(s.id));
      const del = card.querySelector<HTMLElement>(".ple-track-del");
      if (del) {
        del.addEventListener("click", (e) => {
          e.stopPropagation();
          hooks.onDeleteSong(s.id);
        });
      }
      trackListEl.appendChild(card);
    });
  }

  // ---------------- render: song header + monitor ----------------
  function setSong(info: EditorSongInfo | null): void {
    if (!info) {
      songTitleEl.textContent = "—";
      songMetaEl.textContent = "—";
      songBpmEl.textContent = "—";
      songSourceEl.textContent = "BPM · —";
      bpmValEl.textContent = "—";
      lenTotalEl.textContent = "0:00";
      monSongEl.textContent = "—";
      return;
    }
    applyAccent(info.accent);
    songTitleEl.textContent = info.title;
    songMetaEl.textContent = `${info.artist} · ${info.len}`;
    songBpmEl.textContent = info.bpm;
    songSourceEl.textContent = `BPM · ${info.source}`;
    bpmValEl.textContent = info.bpm;
    lenTotalEl.textContent = info.len;
    monSongEl.textContent = info.title;
    markDiff(info.difficulty);
  }

  function setBpm(bpm: string): void {
    songBpmEl.textContent = bpm;
    bpmValEl.textContent = bpm;
  }

  function setStatus(status: EditorStatus): void {
    statusPillEl.textContent = status.label;
    statusPillEl.style.setProperty("--pill-color", status.color);
  }

  // ---------------- render: panel 02 Sync ----------------
  function setSyncReadout(r: SyncReadout): void {
    syncBpmEl.textContent = r.bpm;
    syncOffsetEl.textContent = r.offset;
    syncConfEl.textContent = r.confidence;
    syncCountEl.textContent = r.count;
    // GUARDAR se habilita sólo con las 2 anclas (canSave); CANCELAR mientras haya sync.
    syncSaveBtn.disabled = !(r.canSave ?? r.active);
    syncCancelBtn.disabled = !r.active;
    syncStartBtn.disabled = r.active;
    root.querySelector(".ple-sync-block")?.classList.toggle("active", r.active);
  }

  // Stepper "compases entre marcas" (sync por 2 anclas): valor + activo/inactivo.
  function setAnchorBars(label: string, active: boolean): void {
    barsValEl.textContent = label;
    anchorBarsRow.classList.toggle("active", active);
    barsDownBtn.disabled = !active;
    barsUpBtn.disabled = !active;
  }

  // Readout del tap-tempo + estado del botón APLICAR. `applyLabel` permite a Fase 2
  // mostrar "✓ APLICAR 128 BPM"; si se omite, queda la leyenda por defecto.
  function setTapReadout(text: string, canApply: boolean, applyLabel?: string): void {
    tapReadoutEl.textContent = text;
    applyTapBtn.disabled = !canApply;
    applyTapBtn.textContent = canApply
      ? applyLabel ?? "✓ APLICAR TEMPO"
      : "APLICAR (4+ taps)";
  }

  function setGameStart(label: string, color: string): void {
    startValEl.textContent = label;
    startValEl.style.color = color;
  }

  function setOffset(label: string): void {
    offsetValEl.textContent = label;
  }

  // ---------------- render: panel 03 Descansos ----------------
  function renderBreaks(breaks: BreakInfo[]): void {
    breaksCountEl.textContent = String(breaks.length);
    monBreaksEl.textContent = String(breaks.length);
    breaksListEl.innerHTML = "";
    if (breaks.length === 0) {
      breaksListEl.innerHTML = `<div class="ple-breaks-empty">— sin descansos —</div>`;
      return;
    }
    for (const b of breaks) {
      const row = document.createElement("div");
      row.className = "ple-break-row";
      row.innerHTML = `
        <span class="ple-break-bar"></span>
        <div class="ple-break-text">
          <div class="ple-break-range">${escapeHtml(b.range)}</div>
          <div class="ple-break-dur">${escapeHtml(b.dur)}</div>
        </div>
        <span class="ple-break-del" data-del="${escapeHtml(b.id)}">✕</span>`;
      row.querySelector<HTMLElement>(".ple-break-del")!.addEventListener("click", () =>
        hooks.onDelRest(b.id),
      );
      breaksListEl.appendChild(row);
    }
  }

  // ---------------- render: monitor / transport ----------------
  function setMonitor(info: MonitorInfo): void {
    monBeatEl.textContent = info.beat;
    monStateEl.textContent = info.state;
    monStateEl.style.color = info.stateColor;
  }

  function setTime(clock: string): void {
    timeEl.textContent = clock;
  }

  function setPlayhead(fraction: number): void {
    playheadEl.style.left = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  }

  function setPlaying(playing: boolean): void {
    playBtn.textContent = playing ? "❚❚" : "►";
    playBtn.classList.toggle("playing", playing);
  }

  // ---------------- modo "marcar descanso" ----------------
  function setMarkMode(marking: boolean, pendingStart: boolean): void {
    markBtn.classList.toggle("marking", marking);
    markBtn.textContent = marking ? "✕ CANCELAR MARCADO" : "＋ MARCAR DESCANSO";
    markInstrEl.classList.toggle("marking", marking);
    markInstrEl.textContent = marking
      ? pendingStart
        ? "② Clic donde TERMINA el descanso."
        : "① Clic donde EMPIEZA el descanso, sobre la onda."
      : "Marcá tramos sin input. El cabezal espera y la canción no exige flechas.";
    markPillEl.classList.toggle("marking", marking);
    markPillEl.textContent = marking
      ? pendingStart
        ? "CLIC: FINAL DEL DESCANSO"
        : "CLIC: INICIO DEL DESCANSO"
      : "CLIC EN LA ONDA = MOVER CABEZAL";
    waveBox.classList.toggle("marking", marking);
  }

  // ---------------- toast ----------------
  let toastTimer = 0;
  function toast(text: string, color = "#c8ff1e"): void {
    clearTimeout(toastTimer);
    toastEl.textContent = text;
    toastEl.style.setProperty("--toast-color", color);
    toastEl.hidden = false;
    // re-trigger de la animación
    toastEl.style.animation = "none";
    void toastEl.offsetWidth;
    toastEl.style.animation = "";
    toastTimer = window.setTimeout(() => {
      toastEl.hidden = true;
    }, 2000);
  }

  // ---------------- tooltip "no se puede pausar durante el sync" ----------------
  // Vive anclado al botón play. main.ts lo prende en editorSyncStart y lo apaga al
  // frenar el sync. bumpSyncLock lo sacude si el usuario insiste en tocar play.
  function setSyncLock(active: boolean): void {
    syncLockEl.hidden = !active;
    if (!active) syncLockEl.classList.remove("bump");
  }
  function bumpSyncLock(): void {
    if (syncLockEl.hidden) return;
    syncLockEl.classList.remove("bump");
    void syncLockEl.offsetWidth; // reiniciar la animación del shake
    syncLockEl.classList.add("bump");
  }

  return {
    renderTrackList,
    setSong,
    setBpm,
    setStatus,
    setSyncReadout,
    setAnchorBars,
    setTapReadout,
    setGameStart,
    setOffset,
    renderBreaks,
    setMonitor,
    setTime,
    setPlayhead,
    setPlaying,
    setMarkMode,
    toast,
    setSyncLock,
    bumpSyncLock,
    getCanvas: () => waveCanvas,
    getWaveBox: () => waveBox,
    currentAccent: () => accent,
  };
}
