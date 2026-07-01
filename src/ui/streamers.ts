// streamers.ts (ui) — Vista "Pulse Streamers": gestor de avatares del juego.
// Dos pestañas: ELEGIR (grilla de streamers + USAR) y CREAR (formulario con nombre/
// handle/bio/acento + 3 imágenes por estado con drag-drop + preview). Es una vista
// TONTA: recibe el roster (ya con URLs resueltas) y reporta acciones por hooks; main.ts
// cablea el store (streamers.ts) y aplica el streamer activo al juego. Portada de
// claude.ai/design "Pulse Streamers".

import "./pulse.css";
import type { StreamerState } from "../streamers";

const ACCENTS = ["#c8ff1e", "#25e0ff", "#ff2e9a", "#ffd021", "#a78bfa", "#ff7847"];
const STATE_ORDER: StreamerState[] = ["idle", "hit", "miss"];
const STATE_TAG: Record<StreamerState, string> = { idle: "ESCUCHANDO", hit: "PERFECT", miss: "MISS" };
const STATE_LABEL: Record<StreamerState, string> = { idle: "EN RITMO", hit: "¡PERFECT!", miss: "OUCH..." };
const CYAN = "#25e0ff";
const MAGENTA = "#ff2e9a";
const stateColor = (st: StreamerState, accent: string): string =>
  st === "idle" ? accent : st === "hit" ? CYAN : MAGENTA;

/** Una tarjeta de streamer con sus URLs ya resueltas (la arma main.ts). */
export interface StreamerCard {
  id: string;
  name: string;
  handle: string;
  bio: string;
  accent: string;
  removable: boolean; // custom (Miku no)
  images: Record<StreamerState, string>;
}

/** Datos crudos del formulario de creación (imágenes como blobs). */
export interface NewStreamerForm {
  name: string;
  handle: string;
  bio: string;
  accent: string;
  images: { idle: Blob; hit: Blob | null; miss: Blob | null };
}

export interface StreamersHooks {
  getRoster: () => StreamerCard[];
  getActiveId: () => string;
  onUse: (id: string) => void;
  onDelete: (id: string) => void;
  /** Persiste un streamer nuevo. Devuelve su id (o null si falló). */
  onCreate: (data: NewStreamerForm) => Promise<string | null>;
  onBack: () => void;
}

export interface StreamersApi {
  /** Re-renderiza la grilla (main lo llama tras crear/borrar/usar). */
  render: () => void;
}

function escapeHtml(v: string): string {
  return v.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}

export function createStreamers(root: HTMLElement, hooks: StreamersHooks): StreamersApi {
  let tab: "elegir" | "crear" = "elegir";
  let selId = hooks.getActiveId();

  // --- estado del formulario CREAR ---
  let fName = "";
  let fHandle = "";
  let fBio = "";
  let fAccent = ACCENTS[0]!;
  let fCs: StreamerState = "idle"; // estado en edición
  const fFiles: Record<StreamerState, File | null> = { idle: null, hit: null, miss: null };
  const fUrls: Record<StreamerState, string> = { idle: "", hit: "", miss: "" };
  let previewing = false;
  let previewTimer = 0;
  let hoverTimer = 0;
  let toastTimer = 0;

  root.classList.add("ps-shell");
  root.innerHTML = `
    <div class="ps-header">
      <div class="ps-logo">PULSE<span>.</span>STREAMERS</div>
      <button class="ps-tab" id="ps-tab-elegir" type="button">ELEGIR</button>
      <button class="ps-tab" id="ps-tab-crear" type="button">＋ CREAR</button>
      <div class="ps-grow"></div>
      <div class="ps-count"><span class="ps-count-dot"></span><span id="ps-count">0</span> STREAMERS</div>
      <button class="ps-back" id="ps-back" type="button">◄ SALIR</button>
    </div>
    <div class="ps-body" id="ps-body"></div>
    <div class="ps-toast" id="ps-toast" hidden></div>`;

  const $ = (id: string): HTMLElement => root.querySelector(`#${id}`) as HTMLElement;
  const bodyEl = $("ps-body");
  const countEl = $("ps-count");
  const toastEl = $("ps-toast");
  const tabElegirBtn = $("ps-tab-elegir") as HTMLButtonElement;
  const tabCrearBtn = $("ps-tab-crear") as HTMLButtonElement;

  tabElegirBtn.addEventListener("click", () => setTab("elegir"));
  tabCrearBtn.addEventListener("click", () => setTab("crear"));
  $("ps-back").addEventListener("click", () => hooks.onBack());

  // hidden file input (compartido por los 3 estados del formulario)
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.style.display = "none";
  root.appendChild(fileInput);
  fileInput.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    if (f) acceptFile(f);
    fileInput.value = "";
  });

  function toast(text: string, color = "#c8ff1e"): void {
    toastEl.textContent = text;
    toastEl.style.setProperty("--toast-color", color);
    toastEl.hidden = false;
    toastEl.style.animation = "none";
    void toastEl.offsetWidth;
    toastEl.style.animation = "pl-ed-toast 2.2s ease forwards";
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toastEl.hidden = true), 2200);
  }

  function setTab(t: "elegir" | "crear"): void {
    tab = t;
    stopPreview();
    render();
  }

  // ================= ELEGIR =================
  function renderElegir(): void {
    stopHover();
    const roster = hooks.getRoster();
    const activeId = hooks.getActiveId();
    if (selId === "" || !roster.some((r) => r.id === selId)) selId = activeId;

    const cards = roster
      .map((s) => {
        const selected = s.id === selId;
        const active = s.id === activeId;
        const chips = STATE_ORDER.map(
          (k) =>
            `<span class="ps-chip" style="color:${stateColor(k, s.accent)};border-color:${stateColor(k, s.accent)}">${STATE_TAG[k]}</span>`,
        ).join("");
        return `
          <div class="ps-card${selected ? " on" : ""}" data-id="${s.id}" style="--acc:${s.accent}">
            <div class="ps-card-portrait">
              <div class="ps-card-glow" style="background:radial-gradient(80% 60% at 50% 32%, ${s.accent}38 0%, transparent 62%)"></div>
              <div class="ps-scan"></div>
              <img class="ps-card-img" data-img src="${s.images.idle}" alt="">
              <div class="ps-card-shade"></div>
              <div class="ps-card-live"><span class="ps-live-dot"></span>LIVE</div>
              <div class="ps-card-tag" data-tag style="color:${s.accent};border-color:${s.accent}">${STATE_TAG.idle}</div>
              ${active ? `<div class="ps-card-inuse">EN USO</div>` : ""}
              ${s.removable ? `<button class="ps-card-del" data-del="${s.id}" type="button" title="Borrar">✕</button>` : ""}
              <div class="ps-card-lower">
                <div class="ps-card-id">
                  <span class="ps-card-chip" style="background:${s.accent}">${escapeHtml(s.name.slice(0, 1))}</span>
                  <span class="ps-card-name">${escapeHtml(s.name)}</span>
                </div>
                <span class="ps-card-handle">${escapeHtml(s.handle)}</span>
              </div>
              <div class="ps-card-meter">${"<span></span>".repeat(4)}</div>
              <div class="ps-card-frame" style="border-color:${selected ? s.accent : "#2e2e36"}"></div>
              ${selected ? `<div class="ps-card-check" style="background:${s.accent}">✓</div>` : ""}
            </div>
            <div class="ps-card-body">
              <p class="ps-card-bio">${escapeHtml(s.bio)}</p>
              <div class="ps-card-chips"><span class="ps-card-chips-bar" style="background:${s.accent}"></span>${chips}</div>
            </div>
          </div>`;
      })
      .join("");

    const addCard = `
      <div class="ps-add" id="ps-add">
        <div class="ps-add-plus">＋</div>
        <div class="ps-add-title">Crear streamer</div>
        <div class="ps-add-note">Subí tus 3 estados<br>escuchando · perfect · miss</div>
      </div>`;

    const sel = roster.find((r) => r.id === selId) ?? roster[0];
    bodyEl.innerHTML = `
      <div class="ps-elegir">
        <div class="ps-grid-scroll ps-scrollbar">
          <div class="ps-grid">${cards}${addCard}</div>
        </div>
        <div class="ps-usebar" style="--acc:${sel?.accent ?? "#c8ff1e"}">
          <div class="ps-usebar-accent"></div>
          <div class="ps-use-info">
            <div class="ps-use-label">STREAMER SELECCIONADO</div>
            <div class="ps-use-name">${escapeHtml(sel?.name ?? "—")}</div>
          </div>
          <div class="ps-use-handle-box">
            <div class="ps-use-sub">USUARIO</div>
            <div class="ps-use-handle">${escapeHtml(sel?.handle ?? "")}</div>
          </div>
          <div class="ps-use-bio">${escapeHtml(sel?.bio ?? "")}</div>
          <button class="ps-use-btn" id="ps-use" type="button"><span>►</span><span>USAR</span></button>
        </div>
      </div>`;

    // listeners
    bodyEl.querySelectorAll<HTMLElement>(".ps-card").forEach((card) => {
      const id = card.dataset.id!;
      card.addEventListener("click", () => {
        selId = id;
        renderElegir();
      });
      card.addEventListener("mouseenter", () => startHover(card, roster.find((r) => r.id === id)!));
      card.addEventListener("mouseleave", () => stopHover());
    });
    bodyEl.querySelectorAll<HTMLButtonElement>("[data-del]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.dataset.del!;
        const s = roster.find((r) => r.id === id);
        if (!s) return;
        if (!window.confirm(`¿Borrar el streamer "${s.name}"?`)) return;
        hooks.onDelete(id);
      });
    });
    $("ps-add").addEventListener("click", () => setTab("crear"));
    $("ps-use").addEventListener("click", () => {
      if (!sel) return;
      hooks.onUse(sel.id);
      toast(`► USANDO ${sel.name}`, sel.accent);
    });
  }

  // hover: cicla idle→hit→miss en el retrato de la card (como el diseño).
  let hoverCard: HTMLElement | null = null;
  function startHover(card: HTMLElement, s: StreamerCard): void {
    stopHover();
    hoverCard = card;
    let phase = 0;
    hoverTimer = window.setInterval(() => {
      phase = (phase + 1) % 3;
      const st = STATE_ORDER[phase]!;
      const img = card.querySelector<HTMLImageElement>("[data-img]");
      const tag = card.querySelector<HTMLElement>("[data-tag]");
      if (img) img.src = s.images[st];
      if (tag) {
        tag.textContent = STATE_TAG[st];
        const col = stateColor(st, s.accent);
        tag.style.color = col;
        tag.style.borderColor = col;
      }
    }, 650);
  }
  function stopHover(): void {
    if (hoverTimer) clearInterval(hoverTimer);
    hoverTimer = 0;
    if (hoverCard) {
      const s = hooks.getRoster().find((r) => hoverCard!.dataset.id === r.id);
      const img = hoverCard.querySelector<HTMLImageElement>("[data-img]");
      const tag = hoverCard.querySelector<HTMLElement>("[data-tag]");
      if (s && img) img.src = s.images.idle;
      if (s && tag) {
        tag.textContent = STATE_TAG.idle;
        tag.style.color = s.accent;
        tag.style.borderColor = s.accent;
      }
      hoverCard = null;
    }
  }

  // ================= CREAR =================
  function renderCrear(): void {
    bodyEl.innerHTML = `
      <div class="ps-crear">
        <div class="ps-form ps-scrollbar">
          <div class="ps-form-inner">
            <div class="ps-form-head"><span class="ps-form-num">01</span><span class="ps-form-htitle">Datos del streamer</span></div>

            <div class="ps-label">Nombre</div>
            <input class="ps-input ps-input-name" id="ps-name" type="text" placeholder="EJ: NOVA" maxlength="22" value="${escapeHtml(fName)}">

            <div class="ps-label">Usuario / @handle</div>
            <input class="ps-input ps-input-handle" id="ps-handle" type="text" placeholder="@nova_rhythm" maxlength="24" value="${escapeHtml(fHandle)}">

            <div class="ps-label">Bio / descripción</div>
            <textarea class="ps-textarea" id="ps-bio" placeholder="Contale al público quién es este streamer..." maxlength="140" rows="3">${escapeHtml(fBio)}</textarea>

            <div class="ps-label">Color de acento</div>
            <div class="ps-swatches" id="ps-swatches"></div>

            <div class="ps-form-head"><span class="ps-form-num">02</span><span class="ps-form-htitle">Imágenes por estado</span></div>
            <p class="ps-form-note">Elegí un estado y <strong>arrastrá una imagen</strong> (o hacé click) sobre el retrato de la derecha. Necesitás al menos <strong>ESCUCHANDO</strong>; perfect y miss son opcionales.</p>
            <div class="ps-state-tabs" id="ps-state-tabs"></div>
          </div>
        </div>

        <div class="ps-preview-pane">
          <div class="ps-preview-head">
            <span class="ps-preview-title">Vista previa</span>
            <button class="ps-preview-btn" id="ps-preview-btn" type="button">► VER ESTADOS</button>
          </div>
          <div class="ps-preview-wrap">
            <div class="ps-portrait" id="ps-portrait" style="--acc:${fAccent}">
              <div class="ps-portrait-glow" id="ps-portrait-glow"></div>
              <div class="ps-scan"></div>
              <img class="ps-card-img" id="ps-portrait-img" alt="" style="display:none">
              <div class="ps-drop-hint" id="ps-drop-hint">ARRASTRÁ · <span id="ps-drop-state">ESCUCHANDO</span></div>
              <div class="ps-card-shade"></div>
              <div class="ps-card-live"><span class="ps-live-dot"></span>LIVE</div>
              <div class="ps-card-tag" id="ps-portrait-tag">ESCUCHANDO</div>
              <div class="ps-card-lower">
                <div class="ps-card-id">
                  <span class="ps-card-chip" id="ps-portrait-chip">N</span>
                  <span class="ps-card-name" id="ps-portrait-name">NUEVO STREAMER</span>
                </div>
                <span class="ps-card-handle" id="ps-portrait-handle">@usuario</span>
                <span class="ps-portrait-state" id="ps-portrait-state">EN RITMO</span>
              </div>
              <div class="ps-card-frame" id="ps-portrait-frame"></div>
            </div>
          </div>
          <div class="ps-preview-actions">
            <button class="ps-clear" id="ps-clear" type="button">↺ LIMPIAR</button>
            <button class="ps-save" id="ps-save" type="button">▣ GUARDAR STREAMER</button>
          </div>
        </div>
      </div>`;

    const nameInput = $("ps-name") as HTMLInputElement;
    const handleInput = $("ps-handle") as HTMLInputElement;
    const bioInput = $("ps-bio") as HTMLTextAreaElement;
    nameInput.addEventListener("input", () => {
      fName = nameInput.value;
      updatePreview();
    });
    handleInput.addEventListener("input", () => {
      fHandle = handleInput.value;
      updatePreview();
    });
    bioInput.addEventListener("input", () => {
      fBio = bioInput.value;
    });

    renderSwatches();
    renderStateTabs();

    const portrait = $("ps-portrait");
    portrait.addEventListener("click", () => {
      previewing = false; // subir imagen sale del modo preview
      stopPreview();
      fileInput.click();
    });
    portrait.addEventListener("dragover", (e) => {
      e.preventDefault();
      portrait.classList.add("drag");
    });
    portrait.addEventListener("dragleave", () => portrait.classList.remove("drag"));
    portrait.addEventListener("drop", (e) => {
      e.preventDefault();
      portrait.classList.remove("drag");
      const f = e.dataTransfer?.files?.[0];
      if (f) acceptFile(f);
    });

    $("ps-preview-btn").addEventListener("click", () => togglePreview());
    $("ps-clear").addEventListener("click", () => clearForm());
    $("ps-save").addEventListener("click", () => void save());

    updatePreview();
  }

  function renderSwatches(): void {
    const el = $("ps-swatches");
    el.innerHTML = ACCENTS.map(
      (hex) =>
        `<button class="ps-swatch${hex === fAccent ? " on" : ""}" data-acc="${hex}" type="button"><span style="background:${hex}"></span></button>`,
    ).join("");
    el.querySelectorAll<HTMLButtonElement>("[data-acc]").forEach((b) => {
      b.addEventListener("click", () => {
        fAccent = b.dataset.acc!;
        renderSwatches();
        updatePreview();
      });
    });
  }

  function renderStateTabs(): void {
    const el = $("ps-state-tabs");
    const active = previewing ? null : fCs;
    el.innerHTML = STATE_ORDER.map((k) => {
      const on = active === k;
      const col = stateColor(k, fAccent);
      const has = !!fUrls[k];
      return `<button class="ps-state-tab${on ? " on" : ""}" data-st="${k}" type="button" style="${on ? `border-color:${col};` : ""}">
        <span class="ps-state-dot" style="background:${col}"></span>${STATE_TAG[k]}${has ? " ✓" : ""}</button>`;
    }).join("");
    el.querySelectorAll<HTMLButtonElement>("[data-st]").forEach((b) => {
      b.addEventListener("click", () => {
        fCs = b.dataset.st as StreamerState;
        previewing = false;
        stopPreview();
        renderStateTabs();
        updatePreview();
      });
    });
  }

  /** El estado que se ve AHORA en el retrato (preview cicla; si no, el fCs elegido). */
  let previewPhase = 0;
  function shownState(): StreamerState {
    return previewing ? STATE_ORDER[previewPhase]! : fCs;
  }

  function updatePreview(): void {
    const st = shownState();
    const col = stateColor(st, fAccent);
    const img = $("ps-portrait-img") as HTMLImageElement;
    const hint = $("ps-drop-hint");
    const url = fUrls[st];
    if (url) {
      img.src = url;
      img.style.display = "block";
      hint.style.display = "none";
    } else {
      img.style.display = "none";
      hint.style.display = "flex";
      ($("ps-drop-state")).textContent = STATE_TAG[st];
    }
    const chip = $("ps-portrait-chip");
    chip.textContent = (fName || "N").slice(0, 1).toUpperCase();
    chip.style.background = fAccent;
    ($("ps-portrait-name")).textContent = (fName || "NUEVO STREAMER").toUpperCase();
    ($("ps-portrait-handle")).textContent = fHandle
      ? fHandle[0] === "@"
        ? fHandle
        : "@" + fHandle
      : "@usuario";
    const stateEl = $("ps-portrait-state");
    stateEl.textContent = STATE_LABEL[st];
    stateEl.style.color = col;
    const tag = $("ps-portrait-tag");
    tag.textContent = STATE_TAG[st];
    tag.style.color = col;
    tag.style.borderColor = col;
    ($("ps-portrait-frame")).style.borderColor = fAccent;
    ($("ps-portrait-glow")).style.background = `radial-gradient(80% 60% at 50% 32%, ${(st === "miss" ? MAGENTA : fAccent)}38 0%, transparent 62%)`;
  }

  function acceptFile(file: File): void {
    if (!file.type.startsWith("image/")) {
      toast("ESO NO ES UNA IMAGEN", "#ff3b30");
      return;
    }
    if (fUrls[fCs]) URL.revokeObjectURL(fUrls[fCs]);
    fFiles[fCs] = file;
    fUrls[fCs] = URL.createObjectURL(file);
    renderStateTabs(); // marca el ✓ del estado cargado
    updatePreview();
  }

  function togglePreview(): void {
    if (previewing) {
      stopPreview();
    } else {
      previewing = true;
      previewPhase = 0;
      const btn = $("ps-preview-btn");
      btn.textContent = "❚❚ DETENER";
      btn.classList.add("on");
      renderStateTabs();
      updatePreview();
      previewTimer = window.setInterval(() => {
        previewPhase = (previewPhase + 1) % 3;
        updatePreview();
      }, 800);
    }
  }
  function stopPreview(): void {
    if (previewTimer) clearInterval(previewTimer);
    previewTimer = 0;
    if (previewing) {
      previewing = false;
      const btn = root.querySelector<HTMLElement>("#ps-preview-btn");
      if (btn) {
        btn.textContent = "► VER ESTADOS";
        btn.classList.remove("on");
      }
      const tabs = root.querySelector("#ps-state-tabs");
      if (tabs) renderStateTabs();
    }
  }

  function clearForm(): void {
    stopPreview();
    fName = "";
    fHandle = "";
    fBio = "";
    fAccent = ACCENTS[0]!;
    fCs = "idle";
    for (const st of STATE_ORDER) {
      if (fUrls[st]) URL.revokeObjectURL(fUrls[st]);
      fUrls[st] = "";
      fFiles[st] = null;
    }
    renderCrear();
    toast("CAMPOS LIMPIOS", "#ffd021");
  }

  async function save(): Promise<void> {
    const name = fName.trim();
    if (!name) {
      toast("PONELE UN NOMBRE", "#ff3b30");
      return;
    }
    if (!fFiles.idle) {
      fCs = "idle";
      renderStateTabs();
      updatePreview();
      toast("FALTA LA IMAGEN: ESCUCHANDO", "#ff3b30");
      return;
    }
    const id = await hooks.onCreate({
      name,
      handle: fHandle,
      bio: fBio,
      accent: fAccent,
      images: { idle: fFiles.idle, hit: fFiles.hit, miss: fFiles.miss },
    });
    if (!id) {
      toast("NO PUDE GUARDAR", "#ff3b30");
      return;
    }
    // limpiar el form (las URLs ya viven en el store) y volver a ELEGIR con el nuevo activo.
    for (const st of STATE_ORDER) fUrls[st] = "";
    fName = fHandle = fBio = "";
    fAccent = ACCENTS[0]!;
    fCs = "idle";
    fFiles.idle = fFiles.hit = fFiles.miss = null;
    selId = id;
    tab = "elegir";
    render();
    toast("STREAMER GUARDADO ✓", "#c8ff1e");
  }

  // ================= render raíz =================
  function render(): void {
    countEl.textContent = String(hooks.getRoster().length);
    tabElegirBtn.classList.toggle("on", tab === "elegir");
    tabCrearBtn.classList.toggle("on", tab === "crear");
    if (tab === "elegir") renderElegir();
    else renderCrear();
  }

  render();
  return { render };
}
