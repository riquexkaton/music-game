// storage.ts — La LIBRERÍA de canciones. Dos orígenes:
//  - builtin: las que están en public/songs/ (vienen con el juego).
//  - uploaded: las que sube el usuario, guardadas en el navegador (IndexedDB
//    para el audio + localStorage para la config: bpm, offset, descansos).
// Así el usuario sube una canción, la configura una vez, y queda para siempre.

import type { Rest } from "./core/rests";

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
}

// --- canciones que vienen con el juego ---
const BUILTINS: { id: string; title: string }[] = [
  { id: "skyline-pulse", title: "Skyline Pulse" },
  { id: "amor-a-oscuras", title: "Amor a Oscuras" },
  { id: "tres-vasos-y-un-secreto", title: "Tres Vasos y Un Secreto" },
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
  };
}

// ---------------- config en localStorage ----------------
const configKey = (id: string): string => `ritmo:song:${id}`;

export function saveConfig(config: SongConfig): void {
  localStorage.setItem(configKey(config.id), JSON.stringify(config));
}

export function loadConfig(id: string): SongConfig | null {
  const v = localStorage.getItem(configKey(id));
  return v === null ? null : (JSON.parse(v) as SongConfig);
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
  const builtins = BUILTINS.map(
    (b) => loadConfig(b.id) ?? defaultConfig(b.id, b.title, "builtin"),
  );
  const uploadedIds = await audioKeys();
  const uploaded = uploadedIds.map(
    (id) => loadConfig(id) ?? defaultConfig(id, id, "uploaded"),
  );
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
