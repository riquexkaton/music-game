// main.ts — Juego + EDITOR en dos vistas separadas (routing por hash):
//   (raíz)   -> JUGAR: elegir canción y jugar.
//   #editor  -> EDITAR: subir, sincronizar, marcar descansos en una barra, guardar.
// El motor (Conductor, Scheduler, sync, runner) y el área de gameplay se comparten.

import { Conductor } from "./core/conductor";
import { Scheduler } from "./core/scheduler";
import { type Arrow, type Bar, type Chart } from "./core/chart";
import { judgeCommit, judgeBarCommit, type BarResult } from "./core/play";
import { SequenceTracker } from "./core/sequence";
import { Calibrator } from "./core/calibration";
import { GRADE_SCORE } from "./core/judge";
import { AnchorCollector } from "./core/tempo";
import { type Rest, restAt, restEndBeat, sortRests } from "./core/rests";
import { DIFFICULTIES, rampAt, type DifficultyPreset, type DifficultyName } from "./core/song";
import { analyzeEnergy, intensityAt, type EnergyMap } from "./core/energy";
import { createSfx } from "./core/sfx";
import {
  listSongs,
  uploadSong,
  deleteSong,
  getAudioUrl,
  saveConfig,
  loadConfig,
  slugify,
  type SongConfig,
} from "./storage";
import { guess } from "web-audio-beat-detector";
import { initMenu } from "./ui/menu";
import { createGame, type ArrowCellState, type GameApi } from "./ui/game";
import { createResult } from "./ui/result";
import {
  createEditor,
  type EditorApi,
  type TrackInfo,
  type EditorStatus,
} from "./ui/editor";
import { EditorWave, computePeaks, columnsForWidth } from "./ui/editor-wave";

const BEATS_PER_BAR = 4;
const COMMIT_WINDOW_BEATS = 1.5;
const MISS_BEATS = 0.5;
const APPROACH_BEATS = 4;
const AFTER_BEATS = 1;
const LEAD_IN_BEATS = 8; // "preparate" antes de la primera secuencia (siempre)
const WARMUP_SEC = 8; // arranque suave: la densidad por energía se "abre" en estos segundos
// Ventana de la cuenta regresiva del intro (segundos antes del INICIO DEL JUEGO). La
// usan a la vez: la cuenta "3·2·1·¡VAMOS!" (renderCountdown) Y el PREVIEW de la primera
// secuencia (que aparece quieta al iniciar la cuenta, en el "3"). Mismo número → la
// secuencia se ve durante TODA la cuenta.
const COUNTDOWN_LEAD_SEC = 3;

const chart: Chart = { title: "Metrónomo", bpm: 120, offset: 0, bars: [] };
const conductor = new Conductor(chart);
const scheduler = new Scheduler(conductor, BEATS_PER_BAR);
const calibrator = new Calibrator(8);
const sfx = createSfx(conductor.audio);

type Mode = "idle" | "playing" | "calibrating" | "syncing";
let mode: Mode = "idle";

const ARROW_LIST: Arrow[] = ["left", "up", "right", "down"];
const ARROW_GLYPH: Record<Arrow, string> = { left: "←", up: "↑", right: "→", down: "↓" };

// --- librería de canciones ---
let songs: SongConfig[] = [];
let currentSong: SongConfig | null = null;

// --- estado del runner ---
let activeBar: Bar | null = null;
let tracker: SequenceTracker | null = null;
let nextBarCommit = 0;
let pendingSpawn = false;
// ¿La barra pendiente es la PRIMERA de la partida? La primera se adelanta para que las
// flechas se vean en PREVIEW (quietas) desde el arranque de la cuenta regresiva (~3s
// antes del commit), no en su ventana normal de spawn. Las demás barras spawnean igual
// que siempre (APPROACH_BEATS). El commit real NO cambia (sigue en gameStart).
let firstBarPending = false;
let waitMessage = "";
let currentRests: Rest[] = [];
// INICIO DEL JUEGO efectivo de la canción en juego (segundos). 0 = arranca como
// siempre (sin intro): canciones sin gameStartSet (builtins/viejas) caen acá → compat.
let currentGameStart = 0;
// Tiempo de audio (segundos) en que ARRANCAN las flechas = el tiempo del primer
// commit (firstCommitBeat → segundos). Lo capturamos al programar la primera barra
// en play() y NO cambia durante la partida. La cuenta regresiva del intro (game.ts)
// se dispara contra esto en el loop. <0 hasta que se arranca una partida.
let gameStartTime = -1;
// Último estado de cuenta regresiva ENVIADO a la vista (para no recalcular labels en
// cada frame). El anti-spam real vive en game.setCountdown; esto es la fuente del
// timer de "¡VAMOS!" (lo apagamos ~0.6s después de cruzar el inicio).
let countdownGoUntil = 0;

// --- editor / timeline ---
let editingRests: Rest[] = [];
let totalBeats = 0; // largo de la canción en beats (para mapear la barra)
let pendingStartBeat: number | null = null; // primer clic de un descanso a medio marcar
let syncCollector: AnchorCollector | null = null;
let syncIntent = false; // venimos del "🔒 SINCRONIZAR" del SONG SELECT: orientar al sync

// --- editor NUEVO (#screen-editor, editor.ts) — estado de Fase 2 ---
// El editor reusa el MISMO conductor para reproducir audio, pero NO el scheduler
// (sin metrónomo) ni el runner del juego: es sólo audición. Como el Conductor no
// expone seek arbitrario (arranca desde pausedAt), el "cabezal" del editor es:
//   - durante PLAY: sigue conductor.time en vivo (audio real, fuente de verdad).
//   - en PAUSA: un scrub VISUAL (edWaveTime) que se mueve al clic en la onda y
//     alimenta monitor/beat/reloj, SIN saltar el audio (eso requeriría tocar core/).
let editorWave: EditorWave | null = null;
let edPlaying = false; // transport del editor activo (audio sonando para audición)
let edSyncing = false; // sync-por-anclas en curso en el editor (ESPACIO = palmeo)
let edSyncCollector: AnchorCollector | null = null;
let edWaveTime = 0; // posición del cabezal del editor en segundos (scrub visual en pausa)
let edMarking = false; // modo "marcar descanso" (clic-clic sobre la onda)
let edPendingStartBeat: number | null = null; // inicio del descanso a medio marcar (en beats)
let edTapTimes: number[] = []; // timestamps (ms, performance.now) del tap-tempo
let edTapBpm: number | null = null; // BPM derivado del tap-tempo (o null)
let edTapResetTimer = 0;
let edLooping = false; // rAF del editor (monitor/cabezal en vivo) activo
let returnToEditorAfterPlay = false; // Probar: al salir/terminar el juego, volver a #screen-editor
// Duración real "m:ss" por canción, medida al decodificar el audio (la lista la usa).
const songDurations = new Map<string, string>();

let score = 0;
let combo = 0;
const recentDeltas: number[] = [];

// --- vista de render del runner: "panel" (editor "Probar") o "play" (juego real) ---
type RunnerView = "panel" | "play";
let runnerView: RunnerView = "panel";

// --- estadísticas de la partida (para la pantalla RESULT) ---
let bestCombo = 0;
let perfects = 0;
let goods = 0;
let misses = 0;
let exprTimer = 0;
let songEnded = false;

// Vista de juego (game.ts) y resultados (result.ts). Se instancian al final,
// cuando `menu` ya existe (necesitan su acento y el router). Hasta entonces null.
let game: GameApi | null = null;
let currentAccent = "#c8ff1e";

// Vista nueva del EDITOR (#screen-editor, editor.ts). Se instancia al final (necesita
// `menu`). El editor VIEJO (#controls-editor) sigue existiendo hasta que Fase 2 lo
// limpie; esta vista nueva es la que se muestra al entrar a #editor.
let editor: EditorApi | null = null;
const ACCENTS = ["#c8ff1e", "#25e0ff", "#ff2e9a", "#ffd021", "#a78bfa", "#ff7847"];
const accentForIndex = (i: number): string => ACCENTS[i % ACCENTS.length]!;

let loadedSongId: string | null = null;
let currentBuffer: AudioBuffer | null = null;
let currentEnergy: EnergyMap | null = null; // mapa de energía de la canción cargada

const INPUT_OFFSET_KEY = "ritmo:inputOffset";
let inputOffset = loadInputOffset();
function loadInputOffset(): number {
  const raw = localStorage.getItem(INPUT_OFFSET_KEY);
  return raw === null ? 0 : Number(raw);
}
function saveInputOffset(value: number): void {
  localStorage.setItem(INPUT_OFFSET_KEY, String(value));
}

// --- DOM ---
const $ = (id: string): HTMLElement => document.getElementById(id)!;
const gameControls = $("controls-game");
const editorControls = $("controls-editor");
const editorScreen = $("screen-editor"); // pantalla nueva del editor (editor.ts)
const navGameBtn = $("nav-game") as HTMLButtonElement;
const navEditorBtn = $("nav-editor") as HTMLButtonElement;

const songsEl = $("songs");
const startBtn = $("start") as HTMLButtonElement;
const calibBtn = $("calibrate") as HTMLButtonElement;
const offsetMinusBtn = $("offset-minus") as HTMLButtonElement;
const offsetPlusBtn = $("offset-plus") as HTMLButtonElement;
const statusEl = $("status");
const sequenceEl = $("sequence");
const timingEl = $("timing");
const timingHead = $("timing-head");
const cueEl = $("cue");
const timeEl = $("time");
const beatEl = $("beat");
const scoreEl = $("score");
const comboEl = $("combo");
const gradeEl = $("grade");
const biasEl = $("bias");
const offsetEl = $("offset");
const bpmEl = $("bpm");
const songOffsetEl = $("song-offset");
const flashEl = $("flash");

const syncBtn = $("sync-btn") as HTMLButtonElement;
const syncPanel = $("sync-panel");
const syncBpmEl = $("sync-bpm");
const syncOffsetEl = $("sync-offset");
const syncConfEl = $("sync-conf");
const syncCountEl = $("sync-count");
const syncSaveBtn = $("sync-save") as HTMLButtonElement;
const syncCancelBtn = $("sync-cancel") as HTMLButtonElement;

const uploadInput = $("upload") as HTMLInputElement;
const probarBtn = $("probar") as HTMLButtonElement;
const timelineEl = $("timeline");
const tlRegions = $("tl-regions");
const tlPlayhead = $("tl-playhead");
const tlTotalEl = $("tl-total");
const restListEl = $("rest-list");
const saveRestsBtn = $("save-rests") as HTMLButtonElement;
const editorHintEl = $("editor-hint");

// --- selector de dificultad del editor (rampa progresiva, por canción) ---
const diffButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("#difficulty-picker button"),
);

/** Marca el botón de la dificultad guardada para la canción en edición. */
function renderDifficultyPicker(): void {
  const current = currentSong?.difficulty ?? "normal";
  for (const btn of diffButtons) {
    btn.classList.toggle("selected", btn.dataset.diff === current);
  }
}

for (const btn of diffButtons) {
  btn.addEventListener("click", () => {
    if (!currentSong) return;
    const diff = btn.dataset.diff as DifficultyName;
    persistSong(currentSong, { difficulty: diff });
    renderDifficultyPicker();
    editorHintEl.textContent = `Dificultad: ${DIFFICULTIES[diff].label}. Se aplica la próxima vez que juegues esta canción.`;
  });
}

offsetEl.textContent = formatMs(inputOffset);

async function initLibrary(): Promise<void> {
  songs = await listSongs();
  if (!currentSong) currentSong = songs[0] ?? null;
  renderSongPicker();
  showSongInfo();
  if (location.hash === "#editor") {
    void openEditor();
    refreshEditorView(); // poblar la lista/header del editor nuevo una vez cargada la librería
  }
}

// ---------------- routing ----------------
// #editor → muestra la pantalla NUEVA del editor (#screen-editor, editor.ts). El
// panel viejo (#controls-editor en #screen-game) ya no se enruta acá; sigue en el
// DOM hasta que Fase 2 lo elimine. Mantenemos los toggles viejos por las dudas.
function route(): void {
  const isEditor = location.hash === "#editor";
  editorControls.classList.toggle("hidden", !isEditor);
  gameControls.classList.toggle("hidden", isEditor);
  navGameBtn.classList.toggle("selected", !isEditor);
  navEditorBtn.classList.toggle("selected", isEditor);
  if (mode !== "idle") stopPlayback();
  if (isEditor) {
    runnerView = "panel"; // el "Probar" del editor manda a #screen-play (editorProbar)
    showEditorScreen();
  } else if (!editorScreen.classList.contains("hidden")) {
    // Salimos del editor (estaba visible) → cortar audición y volver al START.
    editorStopPlayback();
    editorScreen.classList.add("hidden");
    menu.showStart();
  }
}

// ---------------- pantalla nueva del editor (#screen-editor) ----------------
/** Muestra #screen-editor: oculta TODAS las otras pantallas y refresca la vista. */
function showEditorScreen(): void {
  // Ocultamos las pantallas del menú (start/select/play/result/game) y mostramos
  // la del editor. menu.showGame() apaga las 5 que conoce; luego tapamos #screen-game.
  menu.showGame();
  $("screen-game").classList.add("hidden");
  editorScreen.classList.remove("hidden");
  refreshEditorView();
}

/** Re-renderiza la lista + el header + (Fase 2) prepara onda/transport/descansos. */
function refreshEditorView(): void {
  if (!editor) return;
  editor.renderTrackList(buildTrackList(), currentSong?.id ?? null);
  renderEditorSong();
  // Fase 2: sincronizar el estado en edición de descansos + dibujar la onda real.
  editingRests = sortRests((loadConfig(currentSong?.id ?? "")?.rests ?? currentSong?.rests ?? []).map((r) => ({ ...r })));
  edPendingStartBeat = null;
  edMarking = false;
  edWaveTime = 0;
  editor.setMarkMode(false, false);
  editorRenderBreaks();
  editor.setTapReadout("tocá 4+ veces", false);
  editorRenderSyncReadout();
  if (currentSong) editor.setOffset(formatMs(chart.offset));
  void editorPrepareSong();
}

/** Carga el audio de la canción actual (si hace falta), pinta la onda y el transport. */
async function editorPrepareSong(): Promise<void> {
  if (!editor) return;
  if (!currentSong) {
    editorWave?.clear();
    return;
  }
  // Setear chart al tempo guardado de la canción (para grilla/beat correctos).
  const saved = loadConfig(currentSong.id) ?? currentSong;
  const t = songTempo(saved);
  chart.bpm = t?.bpm ?? 120;
  chart.offset = t?.offset ?? 0;
  editor.setOffset(formatMs(chart.offset));
  try {
    await editorEnsureLoaded();
  } catch {
    editorWave?.clear();
    editor.toast("NO PUDE CARGAR EL AUDIO", "#ff3b30");
    return;
  }
  // Duración real → header + lista + clock total.
  editorApplyDuration();
  editorRenderBreaks();
  editorDrawWave();
  editorRefreshTransport();
}

/** Vuelca la duración real del buffer al header (len) re-renderizando lista + header. */
function editorApplyDuration(): void {
  if (!editor || !currentBuffer) return;
  // songDurations ya tiene la duración (la cacheó editorEnsureLoaded). Re-renderizamos
  // lista + header para que la fila y el "/ m:ss" del transport tomen el valor real
  // (setSong ya escribe lenTotalEl desde info.len).
  editor.renderTrackList(buildTrackList(), currentSong?.id ?? null);
  renderEditorSong();
}

/** Construye las filas de la lista de pistas desde `songs` (con su accent por índice). */
function buildTrackList(): TrackInfo[] {
  return songs.map((s, i) => {
    const synced = s.tempoSource === "manual";
    const accent = synced ? accentForIndex(i) : "#8a8590";
    const t = songTempo(s);
    return {
      id: s.id,
      num: String(i + 1).padStart(2, "0"),
      title: s.title,
      bpm: t ? String(Math.round(t.bpm)) : "—",
      diff: DIFFICULTIES[s.difficulty].label.toUpperCase(),
      len: songDurations.get(s.id) ?? "—", // duración real una vez decodificado el audio
      accent,
      synced,
      breaks: (loadConfig(s.id)?.rests ?? s.rests ?? []).length,
      removable: s.source === "uploaded",
    };
  });
}

/** Setea el song header + status + monitor + dificultad para la canción actual. */
function renderEditorSong(): void {
  if (!editor) return;
  const song = currentSong;
  if (!song) {
    editor.setSong(null);
    editor.setStatus({ label: "— SIN PISTA —", color: "#71717a" });
    editor.renderBreaks([]);
    return;
  }
  const i = songs.findIndex((s) => s.id === song.id);
  const synced = song.tempoSource === "manual";
  const accent = synced ? accentForIndex(Math.max(0, i)) : "#8a8590";
  currentAccent = accent;
  const t = songTempo(song);
  editor.setSong({
    title: song.title,
    artist: song.source === "uploaded" ? "SUBIDA" : "BUILTIN",
    len: songDurations.get(song.id) ?? "—",
    bpm: t ? String(Math.round(t.bpm)) : "—",
    source: song.tempoSource === "none" ? "—" : song.tempoSource,
    accent,
    difficulty: song.difficulty,
  });
  editor.setStatus(editorStatusFor(song));
  editor.setOffset(formatMs(song.offset));
  const gs = editorGameStart();
  editor.setGameStart(
    gs.gameStartSet ? `${formatClock(gs.gameStart)} s` : "sin definir",
    gs.gameStartSet ? "#ff2e9a" : "#52525b",
  );
  editor.setMonitor({ beat: "0.00", state: "—", stateColor: accent });
  // descansos guardados → lista del panel 03
  const rests = sortRests(loadConfig(song.id)?.rests ?? song.rests ?? []);
  const spb = 60 / (t?.bpm || 120);
  editor.renderBreaks(
    rests.map((r, k) => {
      const startSec = (t?.offset ?? 0) + r.atBeat * spb;
      const endSec = startSec + r.durationBeats * spb;
      return {
        id: String(k),
        range: `${formatTime(startSec)} → ${formatTime(endSec)}`,
        dur: `${r.durationBeats} ${r.durationBeats === 1 ? "compás" : "compases"}`,
      };
    }),
  );
}

/**
 * Status pill del header (3 estados, según el diseño):
 *   sin sync manual        → ◆ FALTA SYNC   (falta el primer beat)
 *   sync ok, sin gameStart → ◆ FALTA INICIO (falta el INICIO DEL JUEGO)
 *   ambos                  → ✓ LISTA
 */
function editorStatusFor(song: SongConfig): EditorStatus {
  if (song.tempoSource !== "manual") return { label: "◆ FALTA SYNC", color: "#ffd021" };
  const cfg = loadConfig(song.id) ?? song;
  if (!cfg.gameStartSet) return { label: "◆ FALTA INICIO", color: "#ffd021" };
  return { label: "✓ LISTA", color: currentAccent };
}

navGameBtn.addEventListener("click", () => {
  location.hash = "";
});
navEditorBtn.addEventListener("click", () => {
  location.hash = "#editor";
});

// ---------------- selector de canciones ----------------
function renderSongPicker(): void {
  songsEl.innerHTML = "";
  for (const song of songs) {
    const btn = document.createElement("button");
    const selected = currentSong && song.id === currentSong.id ? " selected" : "";
    btn.className = `ghost small${selected}`;
    btn.textContent = song.source === "uploaded" ? `📤 ${song.title}` : song.title;
    btn.addEventListener("click", () => selectSong(song));
    songsEl.appendChild(btn);
  }
}

function selectSong(song: SongConfig): void {
  if (mode !== "idle") stopPlayback();
  editorStopPlayback(); // cortar audición del editor si cambiamos de pista
  currentSong = song;
  loadedSongId = null;
  pendingStartBeat = null;
  renderSongPicker();
  showSongInfo();
  if (location.hash === "#editor") {
    void openEditor(); // editor viejo (sigue vivo hasta Fase 2)
    refreshEditorView(); // editor nuevo (#screen-editor)
  }
}

function songTempo(song: SongConfig): { bpm: number; offset: number } | null {
  return song.tempoSource === "none" || song.bpm <= 0 ? null : { bpm: song.bpm, offset: song.offset };
}

function showSongInfo(): void {
  if (!currentSong) return;
  const t = songTempo(currentSong);
  const tag = currentSong.tempoSource === "manual" ? " · sync manual ✓" : t ? " · auto" : "";
  bpmEl.textContent = t
    ? `${currentSong.title} · ${Math.round(t.bpm)} BPM${tag}`
    : `${currentSong.title} · (sin sincronizar)`;
  songOffsetEl.textContent = t ? formatMs(t.offset) : "—";
}

function stopPlayback(): void {
  scheduler.stop();
  conductor.pause();
  mode = "idle";
  activeBar = null;
  tracker = null;
  pendingSpawn = false;
  // Cerrar la ventana del countdown del intro: sin partida activa no debe dispararse.
  gameStartTime = -1;
  countdownGoUntil = 0;
  firstBarPending = false;
  syncCollector = null;
  syncPanel.classList.add("hidden");
  renderSequence();
  renderTiming();
  startBtn.disabled = false;
  calibBtn.disabled = false;
  syncBtn.disabled = false;
  probarBtn.disabled = false;
  startBtn.textContent = "▶ Empezar";
  statusEl.textContent = "";
}

// ---------------- PLAY (juego y "Probar" del editor) ----------------
// `view` decide DÓNDE se pinta el runner: "panel" = ids viejos del editor;
// "play" = la pantalla nueva #screen-play (game.ts). El motor es el MISMO.
startBtn.addEventListener("click", () => void play("panel"));
probarBtn.addEventListener("click", () => void play("panel"));

async function play(view: RunnerView = "play"): Promise<void> {
  const song = currentSong;
  if (!song) return;
  runnerView = view;
  await conductor.resume();
  startBtn.disabled = true;
  calibBtn.disabled = true;
  syncBtn.disabled = true;
  probarBtn.disabled = true;
  startBtn.textContent = "…cargando";

  let tempo: { bpm: number; offset: number };
  try {
    tempo = await ensureSongReady(song);
  } catch {
    statusEl.textContent = `✗ No pude cargar ${song.title}`;
    stopPlayback();
    return;
  }

  chart.title = song.title;
  chart.bpm = tempo.bpm;
  chart.offset = tempo.offset;
  const savedCfg = loadConfig(song.id) ?? song;
  currentRests = sortRests(savedCfg.rests ?? []);
  // INICIO DEL JUEGO: sólo si el usuario lo fijó (gameStartSet). Si no → 0 (compat:
  // arranca como hoy, lead-in normal desde el comienzo). NUNCA rompe canciones viejas.
  currentGameStart = savedCfg.gameStartSet ? savedCfg.gameStart : 0;
  bpmEl.textContent = `${song.title} · ${Math.round(tempo.bpm)} BPM`;
  songOffsetEl.textContent = formatMs(tempo.offset);

  score = 0;
  combo = 0;
  bestCombo = 0;
  perfects = 0;
  goods = 0;
  misses = 0;
  songEnded = false;
  recentDeltas.length = 0;
  activeBar = null;
  scoreEl.textContent = "0";
  comboEl.textContent = "0";
  biasEl.textContent = "—";
  gradeEl.textContent = "";
  gradeEl.className = "";

  // Vista nueva (#screen-play): preparar la piel con datos reales de la canción.
  if (runnerView === "play" && game) {
    currentAccent = menu.currentAccent();
    menu.showPlay();
    game.setSong({
      title: song.title,
      bpm: tempo.bpm,
      difficulty: DIFFICULTIES[song.difficulty].label,
      accent: currentAccent,
    });
    game.setMuted(conductor.isMuted);
    game.start();
  }

  conductor.reset();
  conductor.start();
  scheduler.start();
  mode = "playing";
  startBtn.textContent = "♪ sonando";
  statusEl.textContent = "¡Preparate! Sentí el ritmo unos compases y arrancá.";
  pendingSpawn = false;
  const firstCommit = firstCommitBeat();
  scheduleBar(firstCommit, "¡Preparate!");
  // INICIO DEL JUEGO en segundos = tiempo del primer commit (beat → s, igual que el
  // resto del código: beat*spb + offset). Contra esto se dispara la cuenta regresiva
  // del intro en el loop. Vale tanto para partida normal como para "Probar"; si la
  // canción no tiene gameStart explícito, igual hay lead-in → el countdown cae en los
  // 3s previos a que arranquen las flechas. countdownGoUntil=0 = nada mostrándose aún.
  gameStartTime = runnerView === "play" ? beatToTime(firstCommit) : -1;
  countdownGoUntil = 0;
  // Sólo en el juego real adelantamos el preview de la primera secuencia (junto con la
  // cuenta regresiva). En "panel" (editor viejo) el spawn es el normal.
  firstBarPending = runnerView === "play";
  ensureLoop();
}

/** Beat (en grilla del chart) → tiempo de audio en segundos: beat*spb + offset. */
function beatToTime(beat: number): number {
  const spb = chart.bpm > 0 ? 60 / chart.bpm : 0.5;
  return beat * spb + chart.offset;
}

/**
 * El beat donde se programa la PRIMERA secuencia. Es el más tardío entre:
 *  - el lead-in normal ("¡Preparate!" unos compases desde el comienzo), y
 *  - el INICIO DEL JUEGO (las flechas no pueden arrancar antes de gameStart).
 * Ambos se snappean a downbeat (gridBeat) y se saltan descansos (skipRests).
 * Si gameStart es 0 (canciones sin fijar) el término de gameStart es ≤ 0 y manda
 * el lead-in → comportamiento idéntico al de hoy (compat hacia atrás).
 */
function firstCommitBeat(): number {
  const leadInBeat = gridBeat(conductor.beat + LEAD_IN_BEATS);
  const spb = chart.bpm > 0 ? 60 / chart.bpm : 0.5;
  const gameStartBeat = gridBeat((currentGameStart - chart.offset) / spb);
  return skipRests(Math.max(leadInBeat, gameStartBeat));
}

async function ensureSongReady(song: SongConfig): Promise<{ bpm: number; offset: number }> {
  if (loadedSongId !== song.id || !currentBuffer) {
    statusEl.textContent = "Cargando audio…";
    const url = await getAudioUrl(song);
    if (!url) throw new Error("sin audio");
    currentBuffer = await conductor.load(url);
    currentEnergy = analyzeEnergy(currentBuffer.getChannelData(0), currentBuffer.sampleRate);
    loadedSongId = song.id;
    songDurations.set(song.id, formatTime(currentBuffer.duration));
  }
  const saved = loadConfig(song.id) ?? song;
  const tempo = songTempo(saved);
  if (tempo) return tempo;

  statusEl.textContent = "Analizando BPM… (una sola vez por canción)";
  try {
    const g = await guess(currentBuffer);
    const bpm = (g as { tempo?: number }).tempo ?? g.bpm;
    const offset = g.offset;
    // 'auto' le sirve al EDITOR como referencia para dibujar la barra; NO habilita
    // jugar (solo 'manual' es jugable). Detectar acá solo orienta el sync manual.
    persistSong(song, { bpm, offset, tempoSource: "auto" });
    return { bpm, offset };
  } catch {
    // La detección FALLÓ: no persistimos un tempo placebo (120/0) como si fuera real.
    // La canción queda 'none' (bloqueada); 120/0 es solo referencia visual del editor.
    return { bpm: 120, offset: 0 };
  }
}

function persistSong(song: SongConfig, patch: Partial<SongConfig>): void {
  const base = loadConfig(song.id) ?? song;
  const updated: SongConfig = { ...base, ...patch };
  saveConfig(updated);
  const i = songs.findIndex((s) => s.id === song.id);
  if (i >= 0) songs[i] = updated;
  if (currentSong && currentSong.id === song.id) currentSong = updated;
}

// ---------------- CALIBRACIÓN ----------------
calibBtn.addEventListener("click", async () => {
  await conductor.resume();
  calibrator.reset();
  conductor.reset();
  conductor.start(false);
  scheduler.start();
  mode = "calibrating";
  startBtn.disabled = true;
  calibBtn.disabled = true;
  activeBar = null;
  tracker = null;
  renderSequence();
  gradeEl.textContent = "";
  gradeEl.className = "";
  statusEl.textContent = `🎯 Tocá Espacio en cada beep · faltan ${calibrator.remaining}`;
  ensureLoop();
});

// ---------------- SYNC MANUAL (en el editor) ----------------
syncBtn.addEventListener("click", async () => {
  const song = currentSong;
  if (!song) return;
  await conductor.resume();
  startBtn.disabled = true;
  syncBtn.disabled = true;
  probarBtn.disabled = true;
  try {
    const tempo = await ensureSongReady(song);
    chart.title = song.title;
    chart.bpm = tempo.bpm;
    chart.offset = tempo.offset;
  } catch {
    editorHintEl.textContent = `✗ No pude cargar ${song.title}`;
    stopPlayback();
    return;
  }
  syncCollector = new AnchorCollector(chart.bpm);
  conductor.reset();
  conductor.start();
  scheduler.start();
  mode = "syncing";
  syncPanel.classList.remove("hidden");
  editorHintEl.textContent =
    "Palmeá el ritmo con Espacio (cada pulso, parejo), del principio al final.";
  ensureLoop();
  renderSyncPanel();
});

function onSyncTap(): void {
  if (!syncCollector) return;
  syncCollector.add(conductor.time - conductor.audioOffsetSec);
  const fit = syncCollector.fit;
  if (syncCollector.count >= 2) {
    chart.bpm = fit.bpm;
    chart.offset = fit.offset;
  }
  renderSyncPanel();
}

function renderSyncPanel(): void {
  const fit = syncCollector?.fit;
  if (!fit || !syncCollector || syncCollector.count < 2) {
    syncBpmEl.textContent = "—";
    syncOffsetEl.textContent = "—";
    syncConfEl.textContent = "marcá 3+ pulsos para ver confianza";
    syncCountEl.textContent = syncCollector ? `${syncCollector.count} marcas` : "—";
    return;
  }
  syncBpmEl.textContent = fit.bpm.toFixed(2);
  syncOffsetEl.textContent = formatMs(fit.offset);
  syncConfEl.textContent =
    fit.rSquared !== null && fit.residualMs !== null
      ? `r² ${fit.rSquared.toFixed(3)} · ±${Math.round(fit.residualMs)} ms`
      : "marcá 3+ pulsos para ver confianza";
  syncCountEl.textContent = `${fit.anchorCount} marcas · ${fit.spanSec.toFixed(0)} s`;
}

syncSaveBtn.addEventListener("click", () => {
  if (!currentSong || !syncCollector || syncCollector.count < 2) return;
  const fit = syncCollector.fit;
  persistSong(currentSong, { bpm: fit.bpm, offset: fit.offset, tempoSource: "manual" });
  stopPlayback();
  showSongInfo();
  void openEditor(); // recalcular la barra con el BPM nuevo
  editorHintEl.textContent = "✓ Sincronizado. Ahora marcá los descansos en la barra.";
});

syncCancelBtn.addEventListener("click", () => {
  stopPlayback();
});

// ---------------- sync de audio (offset fino) ----------------
offsetMinusBtn.addEventListener("click", () => nudgeSongOffset(-0.005));
offsetPlusBtn.addEventListener("click", () => nudgeSongOffset(0.005));
function nudgeSongOffset(delta: number): void {
  if (!currentSong) return;
  chart.offset += delta;
  persistSong(currentSong, { offset: chart.offset });
  songOffsetEl.textContent = formatMs(chart.offset);
}

// ================= EDITOR =================
uploadInput.addEventListener("change", async () => {
  const file = uploadInput.files?.[0];
  if (!file) return;
  editorHintEl.textContent = "Subiendo…";
  const config = await uploadSong(file);
  songs = await listSongs();
  currentSong = songs.find((s) => s.id === config.id) ?? config;
  loadedSongId = null;
  renderSongPicker();
  showSongInfo();
  uploadInput.value = "";
  await openEditor();
  editorHintEl.textContent = `✓ "${config.title}" subida. Sincronizala (Sync manual) y marcá descansos.`;
});

/** Prepara el editor para la canción actual: carga audio, calcula la barra, lista. */
async function openEditor(): Promise<void> {
  const song = currentSong;
  if (!song) {
    totalBeats = 0;
    renderTimeline();
    renderRestList();
    return;
  }
  editingRests = sortRests((loadConfig(song.id)?.rests ?? song.rests ?? []).map((r) => ({ ...r })));
  pendingStartBeat = null;
  renderDifficultyPicker();
  editorHintEl.textContent = "Cargando canción…";
  let tempo: { bpm: number; offset: number };
  try {
    tempo = await ensureSongReady(song);
  } catch {
    editorHintEl.textContent = `✗ No pude cargar ${song.title}`;
    totalBeats = 0;
    renderTimeline();
    renderRestList();
    return;
  }
  chart.bpm = tempo.bpm;
  chart.offset = tempo.offset;
  totalBeats = currentBuffer ? Math.floor((currentBuffer.duration - tempo.offset) / (60 / tempo.bpm)) : 0;
  tlTotalEl.textContent = currentBuffer ? formatTime(currentBuffer.duration) : "—";
  editorHintEl.textContent =
    song.tempoSource === "manual"
      ? "Marcá el INICIO y el FINAL de cada descanso (clic y clic en la barra). Podés marcar varios."
      : "Detecté el BPM solo (puede errar). Para que la barra sea exacta, dale Sync manual primero.";
  renderTimeline();
  renderRestList();
  if (syncIntent) {
    syncIntent = false;
    editorHintEl.textContent =
      `🔒 "${song.title}" no está sincronizada. Tocá ▶ Sync manual y palmeá el ritmo de punta a punta para desbloquearla y poder jugarla.`;
    syncBtn.focus();
  }
}

// --- la BARRA de marcado (timeline) ---
function beatFromX(e: MouseEvent): number {
  const rect = timelineEl.getBoundingClientRect();
  const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  return frac * totalBeats;
}

timelineEl.addEventListener("click", (e) => {
  if (totalBeats <= 0) return;
  const beat = beatFromX(e);
  if (pendingStartBeat === null) {
    pendingStartBeat = beat;
    editorHintEl.textContent = "Ahora hacé clic en el FINAL del descanso (o de nuevo en el mismo lugar para cancelar).";
    renderTimeline();
    return;
  }
  const start = Math.min(pendingStartBeat, beat);
  const end = Math.max(pendingStartBeat, beat);
  pendingStartBeat = null;
  if (end - start < 1) {
    editorHintEl.textContent = "Marca cancelada. Clic en el inicio para empezar otra.";
    renderTimeline();
    return;
  }
  editingRests.push({ atBeat: Math.round(start), durationBeats: Math.round(end - start) });
  editingRests = sortRests(editingRests);
  editorHintEl.textContent = `Descanso agregado (${editingRests.length} en total). Marcá otro, ajustá en la lista o Guardá.`;
  renderTimeline();
  renderRestList();
});

function renderTimeline(): void {
  tlRegions.innerHTML = "";
  timelineEl.classList.toggle("disabled", totalBeats <= 0);
  if (totalBeats <= 0) return;
  const spb = 60 / (chart.bpm || 120);
  for (const r of editingRests) {
    const span = document.createElement("div");
    span.className = "tl-rest";
    span.style.left = `${(r.atBeat / totalBeats) * 100}%`;
    span.style.width = `${Math.max(0.6, (r.durationBeats / totalBeats) * 100)}%`;
    const start = chart.offset + r.atBeat * spb;
    span.title = `${formatTime(start)} → ${formatTime(start + r.durationBeats * spb)}`;
    tlRegions.appendChild(span);
  }
  if (pendingStartBeat !== null) {
    const m = document.createElement("div");
    m.className = "tl-marker";
    m.style.left = `${(pendingStartBeat / totalBeats) * 100}%`;
    tlRegions.appendChild(m);
  }
}

function renderRestList(): void {
  restListEl.innerHTML = "";
  if (editingRests.length === 0) {
    restListEl.innerHTML = `<div class="rest-empty">— sin descansos —</div>`;
    return;
  }
  const spb = 60 / (chart.bpm || 120);
  editingRests.forEach((rest, i) => {
    const startSec = chart.offset + rest.atBeat * spb;
    const endSec = startSec + rest.durationBeats * spb;
    const row = document.createElement("div");
    row.className = "rest-row";
    row.innerHTML = `<span><b>${i + 1}.</b> ${formatTime(startSec)} → ${formatTime(endSec)}</span>`;
    appendBtn(row, "−", () => changeRestDuration(i, -BEATS_PER_BAR));
    appendBtn(row, "+", () => changeRestDuration(i, BEATS_PER_BAR));
    appendBtn(row, "✕", () => deleteRest(i));
    restListEl.appendChild(row);
  });
}

function appendBtn(parent: HTMLElement, label: string, onClick: () => void): void {
  const b = document.createElement("button");
  b.className = "ghost small";
  b.textContent = label;
  b.addEventListener("click", onClick);
  parent.appendChild(b);
}

function changeRestDuration(i: number, delta: number): void {
  const r = editingRests[i];
  r.durationBeats = Math.max(BEATS_PER_BAR, r.durationBeats + delta);
  renderTimeline();
  renderRestList();
}

function deleteRest(i: number): void {
  editingRests.splice(i, 1);
  renderTimeline();
  renderRestList();
}

saveRestsBtn.addEventListener("click", () => {
  if (!currentSong) return;
  persistSong(currentSong, { rests: sortRests(editingRests) });
  editorHintEl.textContent = `✓ Guardados ${editingRests.length} descanso(s). Dale Probar para escucharlos.`;
});

/**
 * Salir del juego real (#screen-play). Si venimos del "Probar" del editor, volvemos
 * a #screen-editor (decisión del usuario); si no, al SONG SELECT como siempre.
 */
function leavePlay(): void {
  if (mode !== "idle") stopPlayback();
  if (game) {
    game.setCountdown(null); // por si salimos durante el intro (con el countdown vivo)
    game.stop();
  }
  if (returnToEditorAfterPlay) {
    returnToEditorAfterPlay = false;
    showEditorScreen();
  } else {
    menu.showSelect();
  }
}

// ---------------- INPUT ----------------
window.addEventListener("keydown", (e) => {
  // ESC durante el juego real (#screen-play) = "ESC · SALIR": volver (editor o SELECT).
  if (e.code === "Escape" && mode === "playing" && runnerView === "play") {
    e.preventDefault();
    leavePlay();
    return;
  }
  if (e.code === "Space") {
    e.preventDefault();
    if (mode === "calibrating") onCalibrationTap();
    else if (mode === "syncing") onSyncTap();
    else if (mode === "playing") onCommit();
    // Editor nuevo (#screen-editor): ESPACIO = palmeo del sync, o play/pausa.
    else if (!editorScreen.classList.contains("hidden")) {
      if (edSyncing) editorSyncTap();
      else void editorPlayPause();
    }
    return;
  }
  const arrow = arrowFromCode(e.code);
  if (arrow) {
    e.preventDefault();
    if (mode === "playing") onArrow(arrow);
  }
});

function arrowFromCode(code: string): Arrow | null {
  switch (code) {
    case "ArrowLeft": return "left";
    case "ArrowUp": return "up";
    case "ArrowRight": return "right";
    case "ArrowDown": return "down";
    default: return null;
  }
}

// ---------------- runner de barras ----------------
const gridBeat = (b: number): number => (Math.floor(b / BEATS_PER_BAR) + 1) * BEATS_PER_BAR;

/** Si una barra cae en un descanso, salta hasta el primer grid tras el descanso. */
function skipRests(commitBeat: number): number {
  let c = commitBeat;
  for (let guard = 0; guard < 4096; guard += 1) {
    const r = restAt(c - APPROACH_BEATS, currentRests) ?? restAt(c, currentRests);
    if (!r) return c;
    c = gridBeat(r.atBeat + r.durationBeats + APPROACH_BEATS - 1);
  }
  return c;
}

function scheduleBar(commitBeat: number, msg: string): void {
  nextBarCommit = commitBeat;
  pendingSpawn = true;
  waitMessage = msg;
  activeBar = null;
  tracker = null;
  renderSequence();
}

/** El preset de la dificultad elegida para la canción en juego (default: normal). */
function activePreset(): DifficultyPreset {
  return DIFFICULTIES[currentSong?.difficulty ?? "normal"];
}

/** La intensidad de la música AHORA (0..1), con arranque suave. Mueve la densidad. */
function currentIntensity(): number {
  return currentEnergy ? intensityAt(currentEnergy, conductor.time, WARMUP_SEC) : 0;
}

function maybeSpawnPending(): void {
  if (!pendingSpawn) return;
  // La PRIMERA barra del juego real se adelanta: aparece (quieta, en preview) al
  // arrancar la cuenta regresiva (~COUNTDOWN_LEAD_SEC antes del commit), no en su
  // ventana normal. Así el jugador ve las flechas durante toda la cuenta. El playhead
  // sigue clavado en 0% (renderTimingPlay da progress<0 → clamp) hasta la ventana de
  // aproximación normal, y recién ahí empieza a correr (cerca de "¡VAMOS!"). El commit
  // NO cambia. Las demás barras usan el gate de siempre (APPROACH_BEATS).
  const previewReady =
    firstBarPending && gameStartTime >= 0 && conductor.time >= gameStartTime - COUNTDOWN_LEAD_SEC;
  const approachReady = conductor.beat >= nextBarCommit - APPROACH_BEATS;
  if (!previewReady && !approachReady) return;
  const sequence = makeSequence(rampAt(currentIntensity(), activePreset()).sequenceLength);
  activeBar = { commitBeat: nextBarCommit, sequence };
  tracker = new SequenceTracker(sequence);
  pendingSpawn = false;
  firstBarPending = false;
  renderSequence();
}

function advanceBar(): void {
  activeBar = null;
  tracker = null;
  // barStep es FIJO y múltiplo de BEATS_PER_BAR (ver SPACING_BEATS en rampAt) y el
  // primer commit cae en grilla, así que por inducción cada commit aterriza en un
  // downbeat. NO envolver en gridBeat: redondea hacia arriba y desalinearía.
  const immediate = nextBarCommit + rampAt(currentIntensity(), activePreset()).barStep;
  const next = skipRests(immediate);
  scheduleBar(next, next > immediate ? "Descansá 😮‍💨" : "");
}

function makeSequence(n: number): Arrow[] {
  const out: Arrow[] = [];
  for (let i = 0; i < n; i += 1) out.push(ARROW_LIST[Math.floor(Math.random() * ARROW_LIST.length)]);
  return out;
}

function onArrow(arrow: Arrow): void {
  if (!tracker) return;
  sfx.key(); // golpe percusivo neutro: pega con cualquier canción
  tracker.press(arrow);
  renderSequence();
}

function onCommit(): void {
  if (!conductor.isRunning || !activeBar || !tracker) return;
  if (conductor.beat < activeBar.commitBeat - COMMIT_WINDOW_BEATS) return;
  const result = judgeBarCommit(
    chart,
    activeBar.commitBeat,
    tracker.isReady,
    conductor.time,
    inputOffset,
  );
  applyResult(result);
  advanceBar();
}

function applyResult({ grade, delta, sequenceOk }: BarResult): void {
  // Combo que SE ROMPE en un MISS: lo capturamos ANTES de resetearlo a 0 para que
  // la capa stream/hype reaccione proporcional a la racha perdida (react más abajo).
  const brokenCombo = combo;
  // SFX según el juicio (cool cuenta como perfect, igual que el conteo de abajo).
  if (grade === "miss") sfx.miss();
  else if (grade === "good") sfx.good();
  else sfx.perfect();
  if (grade === "miss") {
    combo = 0;
  } else {
    combo += 1;
    score += GRADE_SCORE[grade] * combo;
  }
  if (combo > bestCombo) bestCombo = combo;
  // Conteo por judgment para RESULT: cool cuenta como PERFECT/azul (blueprint §4).
  if (grade === "miss") misses += 1;
  else if (grade === "good") goods += 1;
  else perfects += 1; // perfect + cool

  const reason = sequenceOk ? formatMs(delta, true) : "secuencia rota";
  gradeEl.textContent = `${grade.toUpperCase()} · ${reason}`;
  gradeEl.className = grade;
  scoreEl.textContent = String(score);
  comboEl.textContent = String(combo);
  if (sequenceOk) trackBias(delta);

  // Piel del juego real (game.ts): judgment + FX + personaje + HUD.
  if (runnerView === "play" && game) {
    const judg: "PERFECT" | "GOOD" | "MISS" =
      grade === "miss" ? "MISS" : grade === "good" ? "GOOD" : "PERFECT";
    game.showJudgment(judg);
    game.setScore(score);
    game.setCombo(combo);
    game.setBest(bestCombo);
    // Capa stream/hype HONESTA: en aciertos, el combo nuevo; en MISS, el combo que
    // SE ROMPE (brokenCombo, antes del reset) para que la caída pegue proporcional.
    game.react(judg, judg === "MISS" ? brokenCombo : combo);
    setPlayExpression(grade === "miss" ? "miss" : "hit");
  }
}

/** Expresión del personaje con vuelta a 'idle' a los ~620ms (blueprint §4). */
function setPlayExpression(e: "hit" | "miss"): void {
  if (!game) return;
  game.setExpression(e);
  clearTimeout(exprTimer);
  exprTimer = window.setTimeout(() => game?.setExpression("idle"), 620);
}

function resolveTimeout(): void {
  sfx.miss();
  // Combo que SE ROMPE por timeout: capturado ANTES del reset (para react más abajo).
  const brokenCombo = combo;
  combo = 0;
  misses += 1;
  const reason = tracker && !tracker.isReady ? "secuencia incompleta" : "no confirmaste";
  gradeEl.textContent = `MISS · ${reason}`;
  gradeEl.className = "miss";
  comboEl.textContent = "0";
  if (runnerView === "play" && game) {
    game.showJudgment("MISS");
    game.setCombo(0);
    // react con el combo que se rompe (no 0): el desplome es proporcional a la racha.
    game.react("MISS", brokenCombo);
    setPlayExpression("miss");
  }
}

function trackBias(delta: number): void {
  recentDeltas.push(delta);
  if (recentDeltas.length > 20) recentDeltas.shift();
  const avg = recentDeltas.reduce((sum, d) => sum + d, 0) / recentDeltas.length;
  biasEl.textContent = `${formatMs(avg)} (últimos ${recentDeltas.length})`;
}

// ---------------- calibración ----------------
function onCalibrationTap(): void {
  const raw = judgeCommit(chart, conductor.time, 0).delta;
  calibrator.add(raw);
  if (calibrator.done) finishCalibration();
  else statusEl.textContent = `🎯 Tocá Espacio en cada beep · faltan ${calibrator.remaining}`;
}

function finishCalibration(): void {
  inputOffset = calibrator.offset;
  saveInputOffset(inputOffset);
  offsetEl.textContent = formatMs(inputOffset);
  scheduler.stop();
  conductor.pause();
  mode = "idle";
  startBtn.disabled = false;
  calibBtn.disabled = false;
  statusEl.textContent = `✓ Calibrado en ${formatMs(inputOffset)}. Elegí canción y dale Empezar.`;
}

// ---------------- render ----------------
function renderSequence(): void {
  if (runnerView === "play") {
    renderSequencePlay();
    return;
  }
  if (!activeBar || !tracker) {
    sequenceEl.innerHTML = "";
    sequenceEl.className = "sequence";
    return;
  }
  const t = tracker;
  sequenceEl.className = `sequence ${t.state}`;
  sequenceEl.innerHTML = activeBar.sequence
    .map((arrow, i) => {
      const cls = t.isBroken ? "arrow broken" : i < t.loaded ? "arrow loaded" : "arrow";
      return `<span class="${cls}">${ARROW_GLYPH[arrow]}</span>`;
    })
    .join("");
}

/** Versión de renderSequence para la pantalla #screen-play (game.ts). */
function renderSequencePlay(): void {
  if (!game) return;
  if (!activeBar || !tracker) {
    game.renderSequence(null, []);
    return;
  }
  const t = tracker;
  const glyphs = activeBar.sequence.map((a) => ARROW_GLYPH[a]);
  const states: ArrowCellState[] = activeBar.sequence.map((_, i) => {
    if (t.isBroken) {
      // La flecha en t.loaded es la que recibió el input equivocado → miss-flash.
      if (i < t.loaded) return "done";
      if (i === t.loaded) return "wrong";
      return "pending";
    }
    if (i < t.loaded) return "done";
    if (i === t.loaded) return "current";
    return "pending";
  });
  game.renderSequence(states, glyphs);
}

function renderTiming(): void {
  if (runnerView === "play") {
    renderTimingPlay();
    return;
  }
  if (mode !== "playing" || !activeBar || !tracker) {
    timingHead.style.left = "0%";
    timingEl.className = "timing";
    if (mode === "playing" && pendingSpawn && waitMessage) {
      const beatsLeft = Math.ceil(nextBarCommit - APPROACH_BEATS - conductor.beat);
      cueEl.textContent = beatsLeft > 0 ? `${waitMessage} · ${beatsLeft}` : waitMessage;
      cueEl.className = "cue";
    } else {
      cueEl.textContent = "";
      cueEl.className = "cue";
    }
    return;
  }
  const bar = activeBar;
  const ready = tracker.isReady;
  const span = APPROACH_BEATS + AFTER_BEATS;
  const progress = (conductor.beat - (bar.commitBeat - APPROACH_BEATS)) / span;
  timingHead.style.left = `${Math.max(0, Math.min(1, progress)) * 100}%`;

  const goodBeats = (0.135 * chart.bpm) / 60;
  const inWindow = Math.abs(bar.commitBeat - conductor.beat) <= goodBeats;

  if (inWindow && ready) {
    timingEl.className = "timing ready";
    cueEl.textContent = "¡AHORA!";
    cueEl.className = "cue now";
  } else if (inWindow) {
    timingEl.className = "timing late";
    cueEl.textContent = "¡Cargá las flechas!";
    cueEl.className = "cue load";
  } else if (ready && conductor.beat < bar.commitBeat) {
    timingEl.className = "timing";
    cueEl.textContent = "listo — esperá el cabezal";
    cueEl.className = "cue";
  } else {
    timingEl.className = "timing";
    cueEl.textContent = "";
    cueEl.className = "cue";
  }
}

/** renderTiming para #screen-play: descanso real, o playhead + fase (cargar/confirmar). */
function renderTimingPlay(): void {
  if (!game) return;

  // DESCANSO REAL: ¿el beat actual cae DENTRO de un descanso de la canción?
  // Esto es independiente del lead-in/espera normal: lead-in NO está marcado como
  // rest, así que sólo entramos acá en descansos de verdad (src/core/rests.ts).
  // Derivamos segundos restantes y fracción a partir del beat real y restEndBeat
  // (encadena descansos pegados) — NO inventamos lógica de motor, sólo enrutamos.
  if (mode === "playing") {
    const rest = restAt(conductor.beat, currentRests);
    if (rest) {
      const spb = 60 / (chart.bpm || 120);
      const endBeat = restEndBeat(conductor.beat, currentRests);
      const totalBeatsLeft = endBeat - rest.atBeat; // span completo (con encadenados)
      const remainingBeats = endBeat - conductor.beat;
      const secondsLeft = Math.max(0, remainingBeats * spb);
      const fraction = totalBeatsLeft > 0 ? remainingBeats / totalBeatsLeft : 0;
      game.setBreak(true, secondsLeft, fraction);
      return;
    }
  }
  game.setBreak(false);

  if (mode !== "playing" || !activeBar || !tracker) {
    game.renderTiming(0, null);
    return;
  }
  const bar = activeBar;
  const span = APPROACH_BEATS + AFTER_BEATS;
  const progress = (conductor.beat - (bar.commitBeat - APPROACH_BEATS)) / span;
  game.renderTiming(progress, tracker.isReady ? "confirm" : "load");
}

/**
 * Cuenta regresiva del intro (sólo #screen-play): muestra "3·2·1·¡VAMOS!" en los ~3s
 * previos al INICIO DEL JUEGO (gameStartTime = tiempo del primer commit). Se dispara
 * por TIEMPO contra conductor.time:
 *   remaining ∈ (2,3] → "3"   (1,2] → "2"   (0,1] → "1"
 *   al cruzar 0 → "¡VAMOS!" por ~0.6s, después se oculta (null).
 * Fuera de esa ventana → null. game.setCountdown ya hace anti-spam (sólo toca el DOM
 * cuando cambia el número), así que llamar cada frame es barato.
 *
 * El countdown manda SÓLO en el intro inicial: si por algún borde hubiera descanso
 * (renderTimingPlay ya lo pinta), igual acá devolvemos null ni bien arranca el juego
 * (remaining ≤ 0 y venció el "¡VAMOS!"), así nunca pisa al bloque DESCANSO/judgment.
 */
function renderCountdown(): void {
  if (!game) return;
  // Sin ventana válida (no es juego real, o ya terminó): asegurar overlay oculto.
  if (mode !== "playing" || gameStartTime < 0) {
    if (countdownGoUntil !== 0) countdownGoUntil = 0;
    game.setCountdown(null);
    return;
  }
  const remaining = gameStartTime - conductor.time;
  if (remaining > 3) {
    // Todavía falta: nada (aún no entramos a los 3s). Mantener limpio.
    game.setCountdown(null);
    return;
  }
  if (remaining > 0) {
    // (0,3] → 3 / 2 / 1 según el segundo en curso (ceil: 2.4→"3", 0.2→"1").
    game.setCountdown(String(Math.ceil(remaining)));
    return;
  }
  // remaining ≤ 0 → ya arrancaron las flechas. Mostrar "¡VAMOS!" un toque y apagar.
  if (countdownGoUntil === 0) countdownGoUntil = conductor.time + 0.6;
  game.setCountdown(conductor.time < countdownGoUntil ? "¡VAMOS!" : null);
}

let looping = false;
function ensureLoop(): void {
  if (looping) return;
  looping = true;
  requestAnimationFrame(loop);
}

function loop(): void {
  while (scheduler.queue.length > 0 && conductor.audio.currentTime >= scheduler.queue[0].time) {
    const beat = scheduler.queue.shift()!.beat;
    flash(beat % BEATS_PER_BAR === 0);
  }
  if (mode === "playing") {
    maybeSpawnPending();
    if (activeBar && conductor.beat > activeBar.commitBeat + MISS_BEATS) {
      resolveTimeout();
      advanceBar();
    }
    // Progreso real de la canción + fin de canción → RESULT (sólo en juego real).
    if (runnerView === "play" && game) {
      const dur = conductor.duration;
      if (dur > 0) {
        game.setProgress(conductor.time / dur);
        if (!songEnded && conductor.time >= dur) {
          songEnded = true;
          finishSong();
        }
      }
      game.setTimecode(formatTimecode(conductor.time));
      renderCountdown();
    }
  }
  renderTiming();
  if (totalBeats > 0) {
    tlPlayhead.style.left = `${Math.max(0, Math.min(100, (conductor.beat / totalBeats) * 100))}%`;
  }
  timeEl.textContent = conductor.time.toFixed(3);
  beatEl.textContent = conductor.beat.toFixed(2);
  requestAnimationFrame(loop);
}

let flashTimer = 0;
function flash(accent = false): void {
  flashEl.classList.add("on");
  if (accent) flashEl.classList.add("downbeat");
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => flashEl.classList.remove("on", "downbeat"), 70);
}

/** Segundos -> "m:ss" (ej: 70 -> "1:10"). */
function formatTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Timecode decorativo "TC mm:ss:cc · Fnn" (cc = centisegundos, nn = frame a 60fps). */
function formatTimecode(seconds: number): string {
  const t = Math.max(0, seconds);
  const p2 = (n: number): string => String(Math.floor(n)).padStart(2, "0");
  return `TC ${p2(t / 60)}:${p2(t % 60)}:${p2((t * 100) % 100)} · F${p2((t * 60) % 60)}`;
}

function formatMs(seconds: number, withWord = false): string {
  const ms = Math.round(seconds * 1000);
  if (!withWord) return `${ms > 0 ? "+" : ""}${ms} ms`;
  if (ms === 0) return "justo";
  return ms > 0 ? `+${ms} ms tarde` : `${ms} ms temprano`;
}

// ---------------- fin de canción → RESULT ----------------
function finishSong(): void {
  const song = currentSong;
  stopPlayback();
  clearTimeout(exprTimer);
  if (game) {
    game.setCountdown(null);
    game.stop();
  }
  if (!song) {
    menu.showSelect();
    return;
  }
  result.show({
    song: song.title,
    difficulty: DIFFICULTIES[song.difficulty].label,
    bpm: chart.bpm,
    accent: currentAccent,
    score,
    best: bestCombo,
    perfects,
    goods,
    misses,
  });
  menu.showResult();
}

// ---------------- arranque + menú (START + SONG SELECT, estética Pulse) ----------------
const menu = initMenu({
  getSongs: () => songs,
  onSelect: (song) => {
    currentSong = song;
  },
  onPlay: (song) => {
    selectSong(song);
    void play("play");
  },
  onSync: (song) => {
    syncIntent = true;
    selectSong(song);
    location.hash = "#editor"; // dispara route() → openEditor() con el hint de sync
  },
});

// Vista de juego real (#screen-play): se instancia acá (ya existe `menu`).
game = createGame($("screen-play"), {
  onToggleMute: () => {
    conductor.setMuted(!conductor.isMuted);
    return conductor.isMuted;
  },
  onExit: () => {
    leavePlay();
  },
  getFreq: () => conductor.getFrequencyData(),
  getBpm: () => chart.bpm,
});

// Vista nueva del EDITOR (#screen-editor): se instancia acá (ya existe `menu`).
// FASE 1 cablea los hooks SIMPLES; los demás son TODO de Fase 2 (ver comentarios).
editor = createEditor($("screen-editor"), {
  // ✅ seleccionar pista
  onSelectSong: (id) => {
    const song = songs.find((s) => s.id === id);
    if (song) selectSong(song);
  },
  // ✅ subir pista (uploadSong → IndexedDB + config)
  onUpload: (file) => void uploadFromEditor(file),
  // ✅ borrar pista subida (con confirm; las builtin no se borran)
  onDeleteSong: (id) => void deleteFromEditor(id),
  // ✅ dificultad (persistir en la config de la canción)
  onSetDifficulty: (diff) => {
    if (!currentSong) return;
    persistSong(currentSong, { difficulty: diff });
    renderEditorSong();
    editor?.toast(`DIFICULTAD · ${DIFFICULTIES[diff].label.toUpperCase()}`, "#c8ff1e");
  },

  // ✅ FASE 2 — panel 01 Tempo: detección auto + BPM manual + tap-tempo.
  onDetect: () => void editorDetect(),
  onBpmStep: (delta) => editorBpmStep(delta),
  onTap: () => editorTap(),
  onApplyTap: () => editorApplyTap(),

  // ✅ FASE 2 — panel 02 Sync (sync-por-anclas): reusa AnchorCollector + fitTempo.
  onSyncStart: () => void editorSyncStart(),
  onSyncTap: () => editorSyncTap(),
  onSyncSave: () => editorSyncSave(),
  onSyncCancel: () => editorSyncCancel(),
  onFixStart: () => editorFixGameStart(),
  onOffsetStep: (deltaMs) => editorOffsetStep(deltaMs),

  // ✅ FASE 2 — panel 03 Descansos: marcado SOBRE la onda (clic-clic) + borrar.
  onToggleMark: () => editorToggleMark(),
  onDelRest: (id) => editorDelRest(id),

  // ✅ FASE 2 — transport: play/pausa + reinicio + clic-en-onda (scrub o marcar).
  onPlay: () => void editorPlayPause(),
  onRestart: () => editorRestart(),
  onWaveClick: (fraction) => editorWaveClick(fraction),

  // ✅ FASE 2 — Probar (→ #screen-play) y Export JSON. GUARDAR persiste.
  onProbar: () => void editorProbar(),
  onExport: () => editorExport(),
  onSave: () => {
    if (!currentSong) {
      editor?.toast("NO HAY PISTA", "#ff3b30");
      return;
    }
    // GUARDAR exige primer beat (sync manual) Y el INICIO DEL JUEGO definidos.
    if (currentSong.tempoSource !== "manual") {
      editor?.toast("FALTA SINCRONIZAR (PANEL 02)", "#ff3b30");
      return;
    }
    if (!editorGameStart().gameStartSet) {
      editor?.toast("FALTA DEFINIR EL INICIO DEL JUEGO", "#ff3b30");
      return;
    }
    // Persistimos la config actual (dificultad/offset/descansos ya editados en vivo).
    persistSong(currentSong, { rests: sortRests(editingRests) });
    editor?.toast("GUARDADO ✓", "#c8ff1e");
  },
});

// ---------------- helpers del editor nuevo (upload / delete) ----------------
async function uploadFromEditor(file: File): Promise<void> {
  editor?.toast("SUBIENDO…", "#25e0ff");
  const config = await uploadSong(file);
  songs = await listSongs();
  currentSong = songs.find((s) => s.id === config.id) ?? config;
  loadedSongId = null;
  refreshEditorView();
  renderSongPicker(); // mantener el selector viejo en sync también
  editor?.toast("PISTA SUBIDA — SINCRONIZALA", "#c8ff1e");
}

async function deleteFromEditor(id: string): Promise<void> {
  const song = songs.find((s) => s.id === id);
  if (!song || song.source !== "uploaded") return; // builtin no se borran
  if (!window.confirm(`¿Borrar "${song.title}"? Esto elimina el audio y su config.`)) return;
  await deleteSong(song);
  songs = await listSongs();
  if (currentSong?.id === id) currentSong = songs[0] ?? null;
  loadedSongId = null;
  refreshEditorView();
  renderSongPicker();
  editor?.toast("PISTA BORRADA", "#ff3b30");
}

// ============================================================================
// EDITOR NUEVO (#screen-editor) — LÓGICA DE FASE 2
// ============================================================================
// Conventions:
//  - `editingRests` (ya existía) es la lista de descansos en edición; la compartimos
//    con el editor viejo para no duplicar estado. La onda nueva la dibuja editorWave.
//  - chart.bpm/chart.offset reflejan la canción en edición (los setea openEditor).

/** Stop de la audición del editor (audio + rAF). NO toca el runner del juego. */
function editorStopPlayback(): void {
  if (edPlaying || conductor.isRunning) {
    conductor.pause();
  }
  edPlaying = false;
  edSyncing = false;
  edSyncCollector = null;
  editor?.setPlaying(false);
}

/** Lazy-init del pintor de la onda (necesita los nodos que crea editor.ts). */
function ensureEditorWave(): EditorWave | null {
  if (!editor) return null;
  if (!editorWave) {
    const canvas = editor.getCanvas();
    const box = editor.getWaveBox();
    const overlays = box.querySelector<HTMLElement>(".ple-wave-overlays");
    const ruler = box.parentElement?.querySelector<HTMLElement>(".ple-ruler") ?? null;
    if (!overlays || !ruler) return null;
    editorWave = new EditorWave(canvas, box, overlays, ruler);
    // El placeholder "ONDA — SE DIBUJA EN FASE 2" ya no aplica: lo retiramos.
    box.querySelector<HTMLElement>(".ple-wave-placeholder")?.remove();
  }
  return editorWave;
}

/** ¿La canción de edición está sincronizada a mano (grilla exacta)? */
function editorSynced(): boolean {
  return currentSong?.tempoSource === "manual";
}

/** Picos de la onda real (cacheados por canción) desde currentBuffer. */
let edPeaks: Float32Array | null = null;
let edPeaksFor: string | null = null;
function editorPeaks(): Float32Array | null {
  if (!currentBuffer || !currentSong) return null;
  const cols = editor ? columnsForWidth(editor.getWaveBox().clientWidth || 900) : 300;
  if (edPeaksFor === currentSong.id && edPeaks && edPeaks.length === cols) return edPeaks;
  edPeaks = computePeaks(currentBuffer.getChannelData(0), cols);
  edPeaksFor = currentSong.id;
  return edPeaks;
}

/** Reconstruye el WaveModel actual y repinta la onda (barras+grilla+overlays+ruler). */
function editorDrawWave(): void {
  const wave = ensureEditorWave();
  if (!wave) return;
  if (!currentSong || !currentBuffer) {
    wave.clear();
    return;
  }
  const gs = editorGameStart();
  wave.setModel({
    peaks: editorPeaks(),
    duration: currentBuffer.duration,
    bpm: chart.bpm,
    offset: chart.offset,
    synced: editorSynced(),
    accent: currentAccent,
    rests: editingRests,
    pendingStartBeat: edPendingStartBeat,
    gameStart: gs.gameStart,
    gameStartSet: gs.gameStartSet,
  });
}

/** El INICIO DEL JUEGO guardado para la canción en edición (con default 0/false). */
function editorGameStart(): { gameStart: number; gameStartSet: boolean } {
  const cfg = currentSong ? loadConfig(currentSong.id) ?? currentSong : null;
  return {
    gameStart: cfg?.gameStart ?? 0,
    gameStartSet: cfg?.gameStartSet ?? false,
  };
}

/** El tiempo "actual" del editor: conductor.time si suena, si no el scrub visual. */
function editorCurrentTime(): number {
  return edPlaying ? conductor.time : edWaveTime;
}

/** Reloj "m:ss.d" para el transport del editor. */
function formatClock(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const d = Math.floor((s % 1) * 10);
  return `${m}:${String(sec).padStart(2, "0")}.${d}`;
}

/** Refresca reloj + cabezal + monitor (beat/estado) del editor desde el tiempo actual. */
function editorRefreshTransport(): void {
  if (!editor || !currentBuffer) return;
  const t = editorCurrentTime();
  const dur = currentBuffer.duration || 1;
  editor.setTime(formatClock(t));
  editor.setPlayhead(t / dur);

  // INICIO DEL JUEGO: label rosa "m:ss.d s" si está fijado; gris "sin definir" si no.
  const gs = editorGameStart();
  editor.setGameStart(
    gs.gameStartSet ? `${formatClock(gs.gameStart)} s` : "sin definir",
    gs.gameStartSet ? "#ff2e9a" : "#52525b",
  );

  // monitor: beat (si hay grilla) + estado (INTRO → DESCANSO → RITMO).
  // INTRO = el cabezal está antes del INICIO DEL JUEGO (las flechas no arrancaron).
  const spb = chart.bpm > 0 ? 60 / chart.bpm : 0;
  const beat = spb > 0 ? Math.max(0, (t - chart.offset) / spb) : 0;
  let state = "RITMO";
  let color = currentAccent;
  if (spb > 0) {
    if (gs.gameStartSet && t < gs.gameStart) {
      state = "INTRO";
      color = "#ff2e9a";
    } else if (restAt(Math.round(beat), editingRests)) {
      state = "DESCANSO";
      color = "#ffd021";
    }
  } else {
    state = "—";
    color = "#71717a";
  }
  editor.setMonitor({ beat: beat.toFixed(2), state, stateColor: color });
}

/** rAF del editor: mientras suena, sigue conductor.time (cabezal/monitor en vivo). */
function ensureEditorLoop(): void {
  if (edLooping) return;
  edLooping = true;
  requestAnimationFrame(editorLoop);
}
function editorLoop(): void {
  // Sólo corre mientras el editor esté visible (si no, se apaga solo).
  if (editorScreen.classList.contains("hidden")) {
    edLooping = false;
    return;
  }
  if (edPlaying) {
    const dur = conductor.duration;
    if (dur > 0 && conductor.time >= dur) {
      // Fin del audio: parar y dejar el cabezal al final.
      edWaveTime = dur;
      editorStopPlayback();
    } else {
      edWaveTime = conductor.time;
    }
    editorRefreshTransport();
  }
  requestAnimationFrame(editorLoop);
}

// ---------------- transport (play/pausa/reinicio/clic-en-onda) ----------------

/**
 * Play/pausa de la audición. El Conductor reanuda desde su pausedAt (no hay seek
 * arbitrario sin tocar core/), así que: si estaba en el final, reset a 0; arranca
 * audio SIN scheduler (sin metrónomo) — sólo escuchar la canción para chequear sync.
 */
async function editorPlayPause(): Promise<void> {
  if (!currentSong) {
    editor?.toast("NO HAY PISTA", "#ff3b30");
    return;
  }
  if (edSyncing) return; // durante el sync el transport lo maneja el sync
  if (edPlaying) {
    conductor.pause();
    edWaveTime = conductor.time;
    edPlaying = false;
    editor?.setPlaying(false);
    return;
  }
  // arrancar audición
  try {
    await conductor.resume();
    await editorEnsureLoaded();
  } catch {
    editor?.toast("NO PUDE CARGAR EL AUDIO", "#ff3b30");
    return;
  }
  if (conductor.duration > 0 && conductor.time >= conductor.duration - 0.05) {
    conductor.reset();
  }
  conductor.start(); // reproduce desde pausedAt (0 tras reset)
  edPlaying = true;
  editor?.setPlaying(true);
  ensureEditorLoop();
}

/** Reinicia la audición al principio (⏮). */
function editorRestart(): void {
  const wasPlaying = edPlaying;
  // pause() detiene la fuente actual; reset() lleva pausedAt a 0; recién ahí re-start
  // (si no, start() encadenaría una segunda fuente sin frenar la anterior).
  if (conductor.isRunning) conductor.pause();
  conductor.reset();
  edWaveTime = 0;
  if (wasPlaying) {
    conductor.start();
    edPlaying = true;
    editor?.setPlaying(true);
  }
  editorRefreshTransport();
}

/**
 * Clic sobre la onda. En modo "marcar descanso": marca inicio/fin (clic-clic) en
 * beats. Si no: mueve el cabezal — VISUAL en pausa (el audio no salta, ver nota de
 * arriba); si está sonando, no interrumpe (el cabezal sigue el audio real).
 */
function editorWaveClick(fraction: number): void {
  if (!currentSong || !currentBuffer) return;
  const wave = ensureEditorWave();
  if (!wave) return;

  if (edMarking) {
    editorMarkAt(wave.beatForFraction(fraction));
    return;
  }
  // scrub visual (sólo si no está sonando — sin seek de audio real).
  if (!edPlaying) {
    edWaveTime = fraction * currentBuffer.duration;
    editorRefreshTransport();
  }
}

// ---------------- panel 01: detección + BPM manual + tap-tempo ----------------

/** DETECTAR AUTO: corre `guess` sobre el buffer y aplica BPM (tempoSource:'auto'). */
async function editorDetect(): Promise<void> {
  if (!currentSong) {
    editor?.toast("NO HAY PISTA", "#ff3b30");
    return;
  }
  editor?.toast("DETECTANDO BPM…", "#25e0ff");
  try {
    await conductor.resume();
    await editorEnsureLoaded();
    if (!currentBuffer) throw new Error("sin buffer");
    const g = await guess(currentBuffer);
    const bpm = (g as { tempo?: number }).tempo ?? g.bpm;
    persistSong(currentSong, { bpm, offset: g.offset, tempoSource: "auto" });
    chart.bpm = bpm;
    chart.offset = g.offset;
    editorAfterTempoChange();
    editor?.toast(`BPM DETECTADO ≈ ${Math.round(bpm)}`, "#25e0ff");
  } catch {
    editor?.toast("NO PUDE DETECTAR EL BPM", "#ff3b30");
  }
}

/** BPM manual ±: ajusta y marca tempoSource:'manual' (queda jugable/sincronizada). */
function editorBpmStep(delta: number): void {
  if (!currentSong) return;
  const base = chart.bpm > 0 ? chart.bpm : 120;
  const bpm = Math.max(40, Math.min(300, Math.round(base + delta)));
  persistSong(currentSong, { bpm, tempoSource: "manual" });
  chart.bpm = bpm;
  editorAfterTempoChange();
}

/** Un golpe de tap-tempo: promedia intervalos (ventana de 2s) → BPM provisorio. */
function editorTap(): void {
  const now = performance.now();
  if (edTapTimes.length && now - edTapTimes[edTapTimes.length - 1] > 2000) edTapTimes = [];
  edTapTimes.push(now);
  if (edTapTimes.length > 8) edTapTimes.shift();
  if (edTapTimes.length >= 2) {
    let sum = 0;
    for (let i = 1; i < edTapTimes.length; i += 1) sum += edTapTimes[i] - edTapTimes[i - 1];
    const avg = sum / (edTapTimes.length - 1);
    edTapBpm = Math.max(40, Math.min(300, Math.round(60000 / avg)));
  } else {
    edTapBpm = null;
  }
  const canApply = edTapTimes.length >= 4 && edTapBpm !== null;
  const readout = edTapBpm ? `${edTapBpm} BPM · ${edTapTimes.length} taps` : `${edTapTimes.length} tap`;
  editor?.setTapReadout(readout, canApply, edTapBpm ? `✓ APLICAR ${edTapBpm} BPM` : undefined);
  // auto-reset si dejan de tocar
  clearTimeout(edTapResetTimer);
  edTapResetTimer = window.setTimeout(() => {
    edTapTimes = [];
    edTapBpm = null;
    editor?.setTapReadout("tocá 4+ veces", false);
  }, 2600);
}

/** Aplica el BPM del tap-tempo (≥4 taps) como tempoSource:'manual'. */
function editorApplyTap(): void {
  if (!currentSong || edTapBpm === null || edTapTimes.length < 4) return;
  persistSong(currentSong, { bpm: edTapBpm, tempoSource: "manual" });
  chart.bpm = edTapBpm;
  editor?.toast(`TEMPO APLICADO · ${edTapBpm} BPM`, "#c8ff1e");
  edTapTimes = [];
  edTapBpm = null;
  clearTimeout(edTapResetTimer);
  editor?.setTapReadout("tocá 4+ veces", false);
  editorAfterTempoChange();
}

// ---------------- panel 02: sync-por-anclas + offset fino ----------------

/** Arranca el sync-por-anclas: audio sonando + AnchorCollector; ESPACIO = palmeo. */
async function editorSyncStart(): Promise<void> {
  if (!currentSong) {
    editor?.toast("NO HAY PISTA", "#ff3b30");
    return;
  }
  try {
    await conductor.resume();
    await editorEnsureLoaded();
  } catch {
    editor?.toast("NO PUDE CARGAR EL AUDIO", "#ff3b30");
    return;
  }
  // arrancar audio desde 0 para palmear de punta a punta (frenar la fuente previa).
  if (conductor.isRunning) conductor.pause();
  conductor.reset();
  edWaveTime = 0;
  conductor.start();
  edPlaying = true;
  edSyncing = true;
  edSyncCollector = new AnchorCollector(chart.bpm > 0 ? chart.bpm : 120);
  editor?.setPlaying(true);
  editorRenderSyncReadout();
  ensureEditorLoop();
  editor?.toast("PALMEÁ ESPACIO EN CADA PULSO", "#c8ff1e");
}

/** Un palmeo del sync (lo dispara ESPACIO). Igual que onSyncTap del editor viejo. */
function editorSyncTap(): void {
  if (!edSyncCollector) return;
  edSyncCollector.add(conductor.time - conductor.audioOffsetSec);
  const fit = edSyncCollector.fit;
  if (edSyncCollector.count >= 2) {
    chart.bpm = fit.bpm;
    chart.offset = fit.offset;
    editorDrawWave(); // la grilla se reajusta en vivo mientras palmea
  }
  editorRenderSyncReadout();
}

/** Vuelca el TempoFit del collector a editor.setSyncReadout (BPM/offset/confianza). */
function editorRenderSyncReadout(): void {
  if (!editor) return;
  const c = edSyncCollector;
  if (!c || c.count < 2) {
    editor.setSyncReadout({
      bpm: "—",
      offset: "—",
      confidence: "marcá 3+ pulsos",
      count: c ? `${c.count} marcas` : "—",
      active: edSyncing,
    });
    return;
  }
  const fit = c.fit;
  editor.setSyncReadout({
    bpm: fit.bpm.toFixed(1),
    offset: formatMs(fit.offset),
    confidence:
      fit.rSquared !== null && fit.residualMs !== null
        ? `r² ${fit.rSquared.toFixed(3)} · ±${Math.round(fit.residualMs)} ms`
        : "marcá 3+ pulsos",
    count: `${fit.anchorCount} marcas · ${fit.spanSec.toFixed(0)} s`,
    active: edSyncing,
  });
}

/** Guarda el fit del sync (tempoSource:'manual') y refresca todo. */
function editorSyncSave(): void {
  if (!currentSong || !edSyncCollector || edSyncCollector.count < 2) {
    editor?.toast("PALMEÁ MÁS PULSOS", "#ff3b30");
    return;
  }
  const fit = edSyncCollector.fit;
  persistSong(currentSong, { bpm: fit.bpm, offset: fit.offset, tempoSource: "manual" });
  chart.bpm = fit.bpm;
  chart.offset = fit.offset;
  editorStopPlayback();
  edWaveTime = 0;
  editorAfterTempoChange();
  editor?.setSyncReadout({ bpm: fit.bpm.toFixed(1), offset: formatMs(fit.offset), confidence: "✓ guardado", count: `${fit.anchorCount} marcas`, active: false });
  editor?.toast("SYNC GUARDADO ✓", "#c8ff1e");
}

/** Cancela el sync en curso (descarta el collector). */
function editorSyncCancel(): void {
  editorStopPlayback();
  editorRenderSyncReadout();
  editor?.toast("SYNC CANCELADO", "#ff3b30");
}

/**
 * Fija el INICIO DEL JUEGO en la posición del cabezal (▶ ARRANCAR EN EL CABEZAL).
 * Validaciones del diseño: NO al final (sec >= len-1) y NO sobre/después de un
 * descanso (las flechas tienen que arrancar ANTES del primer descanso). Persiste
 * gameStart/gameStartSet y refresca onda (intro+marcador) + monitor + status.
 */
function editorFixGameStart(): void {
  if (!currentSong || !currentBuffer) {
    editor?.toast("NO HAY PISTA", "#ff3b30");
    return;
  }
  const sec = Math.round(editorCurrentTime() * 1000) / 1000;
  const dur = currentBuffer.duration;
  if (sec >= dur - 1) {
    editor?.toast("EL INICIO ESTÁ DEMASIADO AL FINAL", "#ff3b30");
    return;
  }
  // El inicio tiene que ir ANTES del primer descanso: si cae sobre/después del
  // arranque de algún descanso, choca. (rests en beats → segundos por la grilla.)
  const spb = chart.bpm > 0 ? 60 / chart.bpm : 0.5;
  if (editingRests.some((r) => sec >= chart.offset + r.atBeat * spb)) {
    editor?.toast("EL INICIO CHOCA CON UN DESCANSO", "#ff3b30");
    return;
  }
  persistSong(currentSong, { gameStart: sec, gameStartSet: true });
  editorDrawWave();
  editorRefreshTransport();
  renderEditorSong(); // refresca el status pill (FALTA INICIO → LISTA)
  editor?.toast(`INICIO DEL JUEGO @ ${formatClock(sec)}`, "#ff2e9a");
}

/** Offset fino ±5 / ±1 ms → ajusta chart.offset, persiste y redibuja la grilla. */
function editorOffsetStep(deltaMs: number): void {
  if (!currentSong) return;
  chart.offset += deltaMs / 1000;
  persistSong(currentSong, { offset: chart.offset });
  editor?.setOffset(formatMs(chart.offset));
  editorDrawWave();
  editorRefreshTransport();
}

// ---------------- panel 03: descansos sobre la onda ----------------

/** Toggle del modo "marcar descanso" (clic-clic sobre la onda). */
function editorToggleMark(): void {
  if (!editorSynced()) {
    editor?.toast("SINCRONIZÁ PRIMERO (PANEL 02)", "#ffd021");
    return;
  }
  edMarking = !edMarking;
  if (!edMarking) edPendingStartBeat = null;
  editor?.setMarkMode(edMarking, edPendingStartBeat !== null);
  editorDrawWave();
}

/** Marca el inicio o el final de un descanso en `beat` (redondeado a entero). */
function editorMarkAt(beat: number): void {
  if (edPendingStartBeat === null) {
    edPendingStartBeat = beat;
    editor?.setMarkMode(true, true);
    editorDrawWave();
    return;
  }
  const start = Math.round(Math.min(edPendingStartBeat, beat));
  const end = Math.round(Math.max(edPendingStartBeat, beat));
  edPendingStartBeat = null;
  if (end - start < 1) {
    editor?.setMarkMode(true, false);
    editorDrawWave();
    editor?.toast("DESCANSO MUY CORTO", "#ff3b30");
    return;
  }
  editingRests.push({ atBeat: start, durationBeats: end - start });
  editingRests = sortRests(editingRests);
  edMarking = false;
  editor?.setMarkMode(false, false);
  if (currentSong) persistSong(currentSong, { rests: sortRests(editingRests) });
  editorRenderBreaks();
  editorDrawWave();
  editor?.toast("DESCANSO MARCADO", "#ffd021");
}

/** Borra un descanso por su índice en la lista ORDENADA (la que ve el usuario). */
function editorDelRest(id: string): void {
  const i = Number(id);
  const sorted = sortRests(editingRests);
  if (!Number.isInteger(i) || i < 0 || i >= sorted.length) return;
  const target = sorted[i];
  // borrar la PRIMer ocurrencia que matchee (atBeat+durationBeats) en el array real.
  const idx = editingRests.findIndex(
    (r) => r.atBeat === target.atBeat && r.durationBeats === target.durationBeats,
  );
  if (idx < 0) return;
  editingRests.splice(idx, 1);
  if (currentSong) persistSong(currentSong, { rests: sortRests(editingRests) });
  editorRenderBreaks();
  editorDrawWave();
  editor?.toast("DESCANSO BORRADO", "#ff3b30");
}

/** Pinta la lista de descansos (panel 03) desde editingRests. */
function editorRenderBreaks(): void {
  if (!editor) return;
  const spb = chart.bpm > 0 ? 60 / chart.bpm : 0.5;
  editor.renderBreaks(
    sortRests(editingRests).map((r, k) => {
      const startSec = chart.offset + r.atBeat * spb;
      const endSec = startSec + r.durationBeats * spb;
      const bars = r.durationBeats / BEATS_PER_BAR;
      const dur =
        bars >= 1
          ? `${Math.round(bars)} ${Math.round(bars) === 1 ? "compás" : "compases"}`
          : `${(r.durationBeats * spb).toFixed(1)} s de pausa`;
      return {
        id: String(k),
        range: `${formatTime(startSec)} → ${formatTime(endSec)}`,
        dur,
      };
    }),
  );
}

// ---------------- acciones: Probar (→ #screen-play) + Export JSON ----------------

/** Probar → corre el juego real en #screen-play; al salir/terminar vuelve al editor. */
async function editorProbar(): Promise<void> {
  if (!currentSong) {
    editor?.toast("NO HAY PISTA", "#ff3b30");
    return;
  }
  if (!editorSynced()) {
    editor?.toast("SINCRONIZÁ PRIMERO PARA PROBAR", "#ffd021");
    return;
  }
  editorStopPlayback();
  // Guardamos lo que esté en edición (descansos) para que Probar lo respete.
  persistSong(currentSong, { rests: sortRests(editingRests) });
  returnToEditorAfterPlay = true; // al salir/terminar, volver al editor (no a SELECT)
  // menu.showPlay() NO conoce #screen-editor: lo ocultamos a mano (si no, quedaría
  // visible bajo #screen-play y el editorLoop seguiría creyéndose activo).
  editorScreen.classList.add("hidden");
  await play("play");
}

/** Exporta la SongConfig actual como JSON descargable ({slug}.chart.json). */
function editorExport(): void {
  if (!currentSong) {
    editor?.toast("NO HAY PISTA", "#ff3b30");
    return;
  }
  const cfg = loadConfig(currentSong.id) ?? currentSong;
  const data = {
    title: cfg.title,
    bpm: cfg.bpm,
    offset: cfg.offset,
    tempoSource: cfg.tempoSource,
    difficulty: cfg.difficulty,
    rests: sortRests(editingRests),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slugify(cfg.title)}.chart.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  editor?.toast(`EXPORTADO · ${a.download}`, "#25e0ff");
}

// ---------------- helpers compartidos del editor nuevo ----------------

/** Asegura que el audio de la canción actual esté decodificado en currentBuffer. */
async function editorEnsureLoaded(): Promise<void> {
  const song = currentSong;
  if (!song) throw new Error("sin pista");
  if (loadedSongId === song.id && currentBuffer) return;
  const url = await getAudioUrl(song);
  if (!url) throw new Error("sin audio");
  currentBuffer = await conductor.load(url);
  currentEnergy = analyzeEnergy(currentBuffer.getChannelData(0), currentBuffer.sampleRate);
  loadedSongId = song.id;
  edPeaks = null; // invalida cache de picos (cambió de buffer)
  songDurations.set(song.id, formatTime(currentBuffer.duration));
}

/** Tras cambiar el tempo (detect/tap/bpm/sync): refresca header, grilla, descansos. */
function editorAfterTempoChange(): void {
  renderEditorSong();
  editorRenderBreaks();
  editorDrawWave();
  editorRefreshTransport();
  // mantener el editor viejo y el song select en sync también
  showSongInfo();
  renderSongPicker();
}

// Pantalla de resultados (#screen-result).
const result = createResult($("screen-result"), {
  onRetry: () => void play("play"),
  // Si veníamos del "Probar" del editor, "volver" regresa al editor; si no, a SELECT.
  onBackToList: () => {
    if (returnToEditorAfterPlay) {
      returnToEditorAfterPlay = false;
      showEditorScreen();
    } else {
      menu.showSelect();
    }
  },
});

// "◄ Pistas": volver del juego al SONG SELECT.
($("back-select") as HTMLButtonElement).addEventListener("click", () => {
  if (mode !== "idle") stopPlayback();
  menu.showSelect();
});

void initLibrary().then(() => menu.refresh());
window.addEventListener("hashchange", route);
route();
if (location.hash !== "#editor") menu.showStart();
