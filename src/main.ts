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
import { type Rest, restAt, sortRests } from "./core/rests";
import { DIFFICULTIES, rampAt, type DifficultyPreset, type DifficultyName } from "./core/song";
import { analyzeEnergy, intensityAt, type EnergyMap } from "./core/energy";
import { createSfx } from "./core/sfx";
import {
  listSongs,
  uploadSong,
  getAudioUrl,
  saveConfig,
  loadConfig,
  type SongConfig,
} from "./storage";
import { guess } from "web-audio-beat-detector";
import { initMenu } from "./ui/menu";
import { createGame, type ArrowCellState, type GameApi } from "./ui/game";
import { createResult } from "./ui/result";

const BEATS_PER_BAR = 4;
const COMMIT_WINDOW_BEATS = 1.5;
const MISS_BEATS = 0.5;
const APPROACH_BEATS = 4;
const AFTER_BEATS = 1;
const LEAD_IN_BEATS = 8; // "preparate" antes de la primera secuencia (siempre)
const WARMUP_SEC = 8; // arranque suave: la densidad por energía se "abre" en estos segundos

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
let waitMessage = "";
let currentRests: Rest[] = [];

// --- editor / timeline ---
let editingRests: Rest[] = [];
let totalBeats = 0; // largo de la canción en beats (para mapear la barra)
let pendingStartBeat: number | null = null; // primer clic de un descanso a medio marcar
let syncCollector: AnchorCollector | null = null;
let syncIntent = false; // venimos del "🔒 SINCRONIZAR" del SONG SELECT: orientar al sync

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
  if (location.hash === "#editor") void openEditor();
}

// ---------------- routing ----------------
function route(): void {
  const editor = location.hash === "#editor";
  editorControls.classList.toggle("hidden", !editor);
  gameControls.classList.toggle("hidden", editor);
  navGameBtn.classList.toggle("selected", !editor);
  navEditorBtn.classList.toggle("selected", editor);
  if (mode !== "idle") stopPlayback();
  if (editor) {
    runnerView = "panel"; // el editor "Probar" pinta en el panel viejo, no en #screen-play
    menu.showGame();
    void openEditor();
  }
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
  currentSong = song;
  loadedSongId = null;
  pendingStartBeat = null;
  renderSongPicker();
  showSongInfo();
  if (location.hash === "#editor") void openEditor();
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
  currentRests = sortRests(loadConfig(song.id)?.rests ?? song.rests ?? []);
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
  scheduleBar(skipRests(gridBeat(conductor.beat + LEAD_IN_BEATS)), "¡Preparate!");
  ensureLoop();
}

async function ensureSongReady(song: SongConfig): Promise<{ bpm: number; offset: number }> {
  if (loadedSongId !== song.id || !currentBuffer) {
    statusEl.textContent = "Cargando audio…";
    const url = await getAudioUrl(song);
    if (!url) throw new Error("sin audio");
    currentBuffer = await conductor.load(url);
    currentEnergy = analyzeEnergy(currentBuffer.getChannelData(0), currentBuffer.sampleRate);
    loadedSongId = song.id;
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

// ---------------- INPUT ----------------
window.addEventListener("keydown", (e) => {
  // ESC durante el juego real (#screen-play) = el botón "ESC · SALIR": volver a SELECT.
  if (e.code === "Escape" && mode === "playing" && runnerView === "play") {
    e.preventDefault();
    stopPlayback();
    if (game) game.stop();
    menu.showSelect();
    return;
  }
  if (e.code === "Space") {
    e.preventDefault();
    if (mode === "calibrating") onCalibrationTap();
    else if (mode === "syncing") onSyncTap();
    else if (mode === "playing") onCommit();
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
  if (!pendingSpawn || conductor.beat < nextBarCommit - APPROACH_BEATS) return;
  const sequence = makeSequence(rampAt(currentIntensity(), activePreset()).sequenceLength);
  activeBar = { commitBeat: nextBarCommit, sequence };
  tracker = new SequenceTracker(sequence);
  pendingSpawn = false;
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
  combo = 0;
  misses += 1;
  const reason = tracker && !tracker.isReady ? "secuencia incompleta" : "no confirmaste";
  gradeEl.textContent = `MISS · ${reason}`;
  gradeEl.className = "miss";
  comboEl.textContent = "0";
  if (runnerView === "play" && game) {
    game.showJudgment("MISS");
    game.setCombo(0);
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
    if (t.isBroken) return i < t.loaded ? "done" : "pending";
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

/** renderTiming para #screen-play: playhead + fase (cargar/confirmar). */
function renderTimingPlay(): void {
  if (!game) return;
  if (mode !== "playing" || !activeBar || !tracker) {
    game.renderTiming(0, null);
    return;
  }
  const bar = activeBar;
  const span = APPROACH_BEATS + AFTER_BEATS;
  const progress = (conductor.beat - (bar.commitBeat - APPROACH_BEATS)) / span;
  game.renderTiming(progress, tracker.isReady ? "confirm" : "load");
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
  if (game) game.stop();
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
    if (mode !== "idle") stopPlayback();
    if (game) game.stop();
    menu.showSelect();
  },
  getFreq: () => conductor.getFrequencyData(),
  getBpm: () => chart.bpm,
});

// Pantalla de resultados (#screen-result).
const result = createResult($("screen-result"), {
  onRetry: () => void play("play"),
  onBackToList: () => menu.showSelect(),
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
