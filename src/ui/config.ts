// config.ts — Panel de CONFIGURACIÓN (modal). Hoy: elegir la SKIN del gameplay
// (Clásico vs Alt 2 · Streamer). NO conoce el motor ni el juego: recibe la skin actual
// por hook y avisa por callback cuando el usuario elige otra. Pura presentación.
//
// Vive como overlay fijo colgado de <body> (se crea una vez, se muestra/oculta con
// open()/close()). Cierra con la ✕, con clic afuera o con Escape.

import "./pulse.css";
import type { GameSkin } from "../settings";

export interface ConfigHooks {
  /** La skin actualmente guardada (para marcar la seleccionada al abrir). */
  getSkin: () => GameSkin;
  /** El usuario eligió otra skin. */
  onSkinChange: (skin: GameSkin) => void;
}

export interface ConfigApi {
  open: () => void;
  close: () => void;
}

interface SkinCard {
  id: GameSkin;
  name: string;
  tag: string;
  desc: string;
}

const SKINS: SkinCard[] = [
  {
    id: "classic",
    name: "CLÁSICO",
    tag: "ACTUAL",
    desc: "El HUD original: personaje flotante en la esquina, anillos de sonar y medidor de HYPE vertical.",
  },
  {
    id: "alt2",
    name: "ALT 2 · STREAMER",
    tag: "CLAUDE DESIGN",
    desc: "Vista tipo transmisión en vivo: cámara del personaje a la derecha, COMBO gigante a la izquierda y chat.",
  },
];

export function createConfig(hooks: ConfigHooks): ConfigApi {
  const backdrop = document.createElement("div");
  backdrop.className = "pl-cfg-backdrop";
  backdrop.hidden = true;
  backdrop.innerHTML = `
    <div class="pl-cfg-modal" role="dialog" aria-modal="true">
      <div class="pl-cfg-head">
        <span class="pl-cfg-title">CONFIGURACIÓN</span>
        <button class="pl-cfg-close" type="button" aria-label="Cerrar">✕</button>
      </div>
      <div class="pl-cfg-label">SKIN DEL GAMEPLAY</div>
      <div class="pl-cfg-skins" id="pl-cfg-skins"></div>
      <div class="pl-cfg-foot">El cambio se aplica en la próxima partida.</div>
    </div>`;
  document.body.appendChild(backdrop);

  const skinsEl = backdrop.querySelector<HTMLElement>("#pl-cfg-skins")!;
  const modal = backdrop.querySelector<HTMLElement>(".pl-cfg-modal")!;

  function renderSkins(): void {
    const current = hooks.getSkin();
    skinsEl.innerHTML = "";
    for (const s of SKINS) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = `pl-cfg-skin${s.id === current ? " on" : ""}`;
      card.innerHTML =
        `<div class="pl-cfg-skin-head">` +
        `<span class="pl-cfg-skin-name">${s.name}</span>` +
        `<span class="pl-cfg-skin-tag">${s.tag}</span>` +
        `</div>` +
        `<div class="pl-cfg-skin-desc">${s.desc}</div>` +
        `<div class="pl-cfg-skin-mark">${s.id === current ? "✓ EN USO" : "ELEGIR"}</div>`;
      card.addEventListener("click", () => {
        if (s.id === hooks.getSkin()) return; // ya está en uso: no re-montar en vano
        hooks.onSkinChange(s.id);
        renderSkins(); // reflejar la nueva selección
      });
      skinsEl.appendChild(card);
    }
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  function open(): void {
    renderSkins();
    backdrop.hidden = false;
    window.addEventListener("keydown", onKey);
  }

  function close(): void {
    backdrop.hidden = true;
    window.removeEventListener("keydown", onKey);
  }

  // clic en el fondo (fuera del modal) cierra; clic dentro del modal no burbujea.
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  modal.addEventListener("click", (e) => e.stopPropagation());
  backdrop.querySelector<HTMLButtonElement>(".pl-cfg-close")!.addEventListener("click", close);

  return { open, close };
}
