// streamers.ts — Librería de STREAMERS (los avatares del juego). Dos orígenes:
//  - builtin: Miku (imágenes en public/characters/, viajan con el juego).
//  - custom: creados por el usuario. Metadata en localStorage; las 3 imágenes por
//    estado (idle/hit/miss) como blobs en IndexedDB (una db PROPIA, aislada de la de
//    audio de storage.ts para no tocar su versión). El streamer ACTIVO es el que se
//    muestra en el gameplay (lo aplica main.ts al entrar a jugar).

export type StreamerState = "idle" | "hit" | "miss";
const STATES: StreamerState[] = ["idle", "hit", "miss"];

export interface Streamer {
  id: string;
  name: string; // MAYÚSCULAS
  handle: string; // "@handle"
  bio: string;
  accent: string; // hex
  source: "builtin" | "custom";
}

/** Un streamer con sus 3 URLs de imagen ya resueltas (paths builtin u object URLs). */
export interface StreamerResolved extends Streamer {
  images: Record<StreamerState, string>;
}

// --- Miku, la builtin (no se borra ni se edita) ---
const MIKU: Streamer = {
  id: "miku",
  name: "MIKU",
  handle: "@miku_rhythm",
  bio: "Vocaloid idol y la cara del engine. Twin-tails turquesa, headset rojo y combos que no bajan de mil.",
  accent: "#25e0ff",
  source: "builtin",
};
const MIKU_IMAGES: Record<StreamerState, string> = {
  idle: "/characters/miku-idle.png",
  hit: "/characters/miku-hit.png",
  miss: "/characters/miku-miss.png",
};

// ---------------- metadata (localStorage) ----------------
const META_KEY = "ritmo:streamers"; // array de Streamer custom
const ACTIVE_KEY = "ritmo:activeStreamer";

function loadCustomMeta(): Streamer[] {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as Streamer[];
    return Array.isArray(arr) ? arr.filter((s) => s && s.id && s.source === "custom") : [];
  } catch {
    return [];
  }
}
function saveCustomMeta(list: Streamer[]): void {
  localStorage.setItem(META_KEY, JSON.stringify(list));
}

// ---------------- imágenes (IndexedDB propia) ----------------
const DB_NAME = "ritmo-streamers";
const STORE = "images";

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
const imgKey = (id: string, st: StreamerState): string => `${id}:${st}`;

async function putImg(id: string, st: StreamerState, blob: Blob): Promise<void> {
  const db = await openDb();
  await idbReq(db.transaction(STORE, "readwrite").objectStore(STORE).put(blob, imgKey(id, st)));
}
async function getImg(id: string, st: StreamerState): Promise<Blob | undefined> {
  const db = await openDb();
  return idbReq<Blob | undefined>(
    db.transaction(STORE, "readonly").objectStore(STORE).get(imgKey(id, st)),
  );
}
async function delImgs(id: string): Promise<void> {
  const db = await openDb();
  const store = db.transaction(STORE, "readwrite").objectStore(STORE);
  await Promise.all(STATES.map((st) => idbReq(store.delete(imgKey(id, st)))));
}

// Cache de object URLs por streamer (evita fugas: re-resolver devuelve las mismas URLs).
const urlCache = new Map<string, Record<StreamerState, string>>();

// ---------------- API ----------------

/** Todos los streamers: Miku + los custom (metadata, sin resolver imágenes). */
export function listStreamers(): Streamer[] {
  return [MIKU, ...loadCustomMeta()];
}

/** El id del streamer activo (el que se usa en el juego). Cae a Miku si no existe. */
export function loadActiveId(): string {
  const id = localStorage.getItem(ACTIVE_KEY);
  if (!id) return MIKU.id;
  return listStreamers().some((s) => s.id === id) ? id : MIKU.id;
}
export function saveActiveId(id: string): void {
  localStorage.setItem(ACTIVE_KEY, id);
}

/** Resuelve las 3 URLs de imagen (paths builtin u object URLs cacheadas). hit/miss
 *  faltantes caen al idle (idle es obligatorio al crear). */
export async function resolveImages(id: string): Promise<Record<StreamerState, string>> {
  if (id === MIKU.id) return MIKU_IMAGES;
  const cached = urlCache.get(id);
  if (cached) return cached;
  const out: Record<StreamerState, string> = { idle: "", hit: "", miss: "" };
  for (const st of STATES) {
    const blob = await getImg(id, st);
    out[st] = blob ? URL.createObjectURL(blob) : "";
  }
  if (!out.hit) out.hit = out.idle;
  if (!out.miss) out.miss = out.idle;
  urlCache.set(id, out);
  return out;
}

export interface NewStreamer {
  name: string;
  handle: string;
  bio: string;
  accent: string;
  images: { idle: Blob; hit: Blob | null; miss: Blob | null };
}

/** Crea y persiste un streamer custom (metadata + blobs). Devuelve su id. */
export async function createStreamer(data: NewStreamer): Promise<string> {
  const name = data.name.trim().toUpperCase() || "STREAMER";
  let handle = data.handle.trim();
  if (handle && handle[0] !== "@") handle = "@" + handle;
  if (!handle) handle = "@" + name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const id = uniqueId(slugify(name));
  await putImg(id, "idle", data.images.idle);
  if (data.images.hit) await putImg(id, "hit", data.images.hit);
  if (data.images.miss) await putImg(id, "miss", data.images.miss);
  const streamer: Streamer = {
    id,
    name,
    handle,
    bio: data.bio.trim() || "Streamer creado en Pulse · listo para salir en vivo.",
    accent: data.accent,
    source: "custom",
  };
  saveCustomMeta([...loadCustomMeta(), streamer]);
  return id;
}

/** Borra un streamer custom (blobs + metadata). Miku no se borra. Si era el activo,
 *  el activo vuelve a Miku. */
export async function deleteStreamer(id: string): Promise<void> {
  if (id === MIKU.id) return;
  await delImgs(id);
  const cached = urlCache.get(id);
  if (cached) {
    for (const st of STATES) if (cached[st].startsWith("blob:")) URL.revokeObjectURL(cached[st]);
    urlCache.delete(id);
  }
  saveCustomMeta(loadCustomMeta().filter((s) => s.id !== id));
  if (loadActiveId() === id) saveActiveId(MIKU.id);
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "streamer"
  );
}
function uniqueId(base: string): string {
  const taken = new Set(loadCustomMeta().map((s) => s.id));
  if (base !== MIKU.id && !taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}
