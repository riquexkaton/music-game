// storage.ts — La LIBRERÍA de canciones. Dos orígenes:
//  - builtin: las que están en public/songs/ (vienen con el juego).
//  - uploaded: las que sube el usuario, guardadas en el navegador (IndexedDB
//    para el audio + localStorage para la config: bpm, offset, descansos).
// Así el usuario sube una canción, la configura una vez, y queda para siempre.

import type { Rest } from "./core/rests";
import type { DifficultyName } from "./core/song";

export interface SongConfig {
  id: string;
  title: string;
  source: "builtin" | "uploaded";
  /** Ruta pública (solo builtin). En uploaded el audio vive en IndexedDB. */
  audioPath?: string;
  /** Tempo: 0 = todavía no configurado (hay que detectar o sincronizar). */
  bpm: number;
  offset: number;
  /** 'manual' si lo sincronizó a mano; 'auto' si vino de la detección. */
  tempoSource: "manual" | "auto" | "none";
  /** Descansos puntuales que marcó el usuario. */
  rests: Rest[];
  /** Dificultad elegida para esta canción: define la rampa progresiva. */
  difficulty: DifficultyName;
  /**
   * INICIO DEL JUEGO (segundos): dónde arrancan realmente las flechas. El intro
   * (de 0 a gameStart) suena pero NO exige input. Distinto del primer beat / offset
   * (que alinea la grilla). Default 0 = sin intro (arranca como siempre).
   */
  gameStart: number;
  /** ¿El usuario fijó el inicio del juego? false = sin definir (compat: arranca en 0). */
  gameStartSet: boolean;
}

// --- canciones que vienen con el juego ---
// Una canción builtin puede traer un `chart` SINCRONIZADO de fábrica: así viaja con
// el juego ya lista para jugar (sin pasar por el editor). Sin `chart`, arranca sin
// sync (bpm 0, tempoSource 'none') como las viejas. El audio SIEMPRE vive en
// public/songs/{id}/audio.mp3 — ese archivo hay que ponerlo aparte (no está acá).
type BuiltinChart = Partial<
  Pick<
    SongConfig,
    "bpm" | "offset" | "tempoSource" | "rests" | "difficulty" | "gameStart" | "gameStartSet"
  >
>;

interface BuiltinDef {
  id: string;
  title: string;
  /** Si está, la canción viene SINCRONIZADA de fábrica (jugable sin tocar el editor). */
  chart?: BuiltinChart;
}

// Las canciones que vienen con el juego, en orden. TODAS vienen SINCRONIZADAS de
// fábrica (con su `chart`): un juego rítmico no se lanza sin canciones listas para
// jugar. El audio de cada una vive en public/songs/{id}/audio.mp3.
const BUILTINS: BuiltinDef[] = [
  {
    id: "agnes-tachyon-low-cortisol-dance-full-song",
    title: "Agnes Tachyon - LOW CORTISOL DANCE (Full Song)",
    chart: {
      bpm: 128.01068573738547,
      offset: 32.06735745715603,
      tempoSource: "manual",
      gameStart: 32.219,
      gameStartSet: true,
    },
  },
  {
    id: "audition-with-you",
    title: "Audition - With You",
    chart: {
      bpm: 151.1625422786849,
      offset: 35.408831056044484,
      tempoSource: "manual",
      gameStart: 34.961,
      gameStartSet: true,
    },
  },
  {
    id: "corre-hasta-el-final",
    title: "끝까지 달려가 (Corre hasta el final)",
    chart: {
      bpm: 153,
      offset: 18.02666666666675,
      tempoSource: "manual",
      gameStart: 18.131,
      gameStartSet: true,
    },
  },
];

function defaultConfig(id: string, title: string, source: SongConfig["source"]): SongConfig {
  return {
    id,
    title,
    source,
    audioPath: source === "builtin" ? `/songs/${id}/audio.mp3` : undefined,
    bpm: 0,
    offset: 0,
    tempoSource: "none",
    rests: [],
    difficulty: "normal",
    gameStart: 0,
    gameStartSet: false,
  };
}

/** Config de fábrica de un builtin: el default + el chart horneado (si lo trae). */
function builtinConfig(b: BuiltinDef): SongConfig {
  return { ...defaultConfig(b.id, b.title, "builtin"), ...b.chart };
}

// ---------------- config en localStorage ----------------
const configKey = (id: string): string => `ritmo:song:${id}`;

export function saveConfig(config: SongConfig): void {
  localStorage.setItem(configKey(config.id), JSON.stringify(config));
}

export function loadConfig(id: string): SongConfig | null {
  const v = localStorage.getItem(configKey(id));
  if (v === null) return null;
  const config = JSON.parse(v) as SongConfig;
  // Migración: las configs guardadas antes de la dificultad progresiva no traen
  // el campo. Sin esto, currentSong.difficulty sería undefined y la rampa fallaría.
  if (!config.difficulty) config.difficulty = "normal";
  // Migración: el INICIO DEL JUEGO se agregó después. Las configs viejas (y builtins
  // sin tocar) no lo traen → default 0/false: el juego arranca como siempre.
  if (typeof config.gameStart !== "number") config.gameStart = 0;
  if (typeof config.gameStartSet !== "boolean") config.gameStartSet = false;
  return config;
}

// ---------------- audio en IndexedDB ----------------
const DB_NAME = "ritmo-game";
const STORE = "audio";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbReq<T>(op: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    op.onsuccess = () => resolve(op.result);
    op.onerror = () => reject(op.error);
  });
}

async function putAudio(id: string, blob: Blob): Promise<void> {
  const db = await openDb();
  const store = db.transaction(STORE, "readwrite").objectStore(STORE);
  await idbReq(store.put(blob, id));
}

async function getAudio(id: string): Promise<Blob | undefined> {
  const db = await openDb();
  const store = db.transaction(STORE, "readonly").objectStore(STORE);
  return idbReq<Blob | undefined>(store.get(id));
}

async function audioKeys(): Promise<string[]> {
  const db = await openDb();
  const store = db.transaction(STORE, "readonly").objectStore(STORE);
  const keys = await idbReq<IDBValidKey[]>(store.getAllKeys());
  return keys.map(String);
}

async function deleteAudio(id: string): Promise<void> {
  const db = await openDb();
  const store = db.transaction(STORE, "readwrite").objectStore(STORE);
  await idbReq(store.delete(id));
}

// ---------------- API pública ----------------

/** Convierte "Mi Canción.mp3" en un id estable tipo "mi-cancion". */
export function slugify(name: string): string {
  return name
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "cancion";
}

/** Todas las canciones: builtin + subidas. Cada una con su config guardada (o default). */
export async function listSongs(): Promise<SongConfig[]> {
  const builtinIds = new Set(BUILTINS.map((b) => b.id));
  const builtins = BUILTINS.map((b) => {
    const fab = builtinConfig(b);
    const saved = loadConfig(b.id);
    // Si hay config guardada (el usuario re-editó, o quedó una versión 'uploaded'
    // vieja con el mismo id en tu navegador) respetamos sus campos pero FORZAMOS que
    // sea builtin (source + audioPath + title de fábrica): el audio sale de public/songs.
    return saved ? { ...saved, source: "builtin" as const, audioPath: fab.audioPath, title: fab.title } : fab;
  });
  const uploadedIds = await audioKeys();
  const uploaded = uploadedIds
    .filter((id) => !builtinIds.has(id)) // no duplicar un builtin que también esté en IndexedDB
    .map((id) => loadConfig(id) ?? defaultConfig(id, id, "uploaded"));
  return [...builtins, ...uploaded];
}

/** Sube una canción: guarda el audio en IndexedDB y crea su config. */
export async function uploadSong(file: File): Promise<SongConfig> {
  const id = uniqueId(slugify(file.name), await audioKeys());
  await putAudio(id, file);
  const config = defaultConfig(id, file.name.replace(/\.[^.]+$/, ""), "uploaded");
  saveConfig(config);
  return config;
}

function uniqueId(base: string, taken: string[]): string {
  if (!taken.includes(base) && !BUILTINS.some((b) => b.id === base)) return base;
  let i = 2;
  while (taken.includes(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

/** Borra una canción subida (audio + config). Las builtin no se borran. */
export async function deleteSong(config: SongConfig): Promise<void> {
  if (config.source !== "uploaded") return;
  await deleteAudio(config.id);
  localStorage.removeItem(configKey(config.id));
}

/**
 * Una URL reproducible para la canción. Builtin: la ruta pública. Uploaded: un
 * object URL del blob de IndexedDB (acordate de revokeObjectURL al descartarlo).
 */
export async function getAudioUrl(config: SongConfig): Promise<string> {
  if (config.source === "builtin") return config.audioPath ?? "";
  const blob = await getAudio(config.id);
  return blob ? URL.createObjectURL(blob) : "";
}
