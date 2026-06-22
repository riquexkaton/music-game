// character.ts — Personaje (VOCALISTA / Miku). Blueprint §3, §9, §10.
//
// 3 <img> superpuestas (/characters/miku-idle.png, -hit.png, -miss.png) que se
// cross-fadean por opacity (.26s, lo hace el CSS .pl-char-img). La expresión
// activa pasa a opacity 1; las otras a 0. 'hit' además escala la imagen a 1.02
// (game.ts togglea .hit en el panel para el scale del panel; acá manejamos la
// imagen). setAccent recolorea un glow local detrás de las imágenes (el glow
// grande del panel y el chip los recolorea game.ts; acá pintamos lo que vive
// dentro de nuestro contenedor sin pisar lo de afuera).
//
// Fallback (§10): si una imagen no carga (el usuario las sube luego), se oculta
// sin romper. El panel queda OK (glow + label + expresión), sin errores.

export interface CharacterApi {
  setExpression(e: "idle" | "hit" | "miss"): void;
  setAccent(hex: string): void;
}

const EXPRESSIONS = ["idle", "hit", "miss"] as const;
type Expression = (typeof EXPRESSIONS)[number];

export function createCharacter(container: HTMLElement): CharacterApi {
  // Glow local detrás de las imágenes: tinte del acento por canción, scoped al
  // contenedor (el glow grande del panel lo maneja game.ts). z-index -1 para
  // quedar detrás de las <img> sin tapar nada del panel exterior.
  const localGlow = document.createElement("div");
  localGlow.className = "pl-char-local-glow";
  localGlow.style.cssText =
    "position:absolute;inset:0;z-index:-1;pointer-events:none;transition:background 0.26s ease;";
  container.appendChild(localGlow);

  // Las 3 imágenes superpuestas. Empiezan en opacity 0; el cross-fade lo hace
  // el CSS (.pl-char-img transition opacity .26s). 'hit' escala la imagen.
  const imgs: Record<Expression, HTMLImageElement> = {} as Record<Expression, HTMLImageElement>;
  for (const e of EXPRESSIONS) {
    const img = document.createElement("img");
    img.className = "pl-char-img";
    img.alt = "";
    img.decoding = "async";
    img.style.opacity = "0";
    img.style.transition = "opacity 0.26s ease, transform 0.26s ease";
    img.addEventListener("error", () => {
      // No rompemos si la imagen falta: la ocultamos del flujo visual.
      img.style.display = "none";
    });
    img.src = `/characters/miku-${e}.png`;
    container.appendChild(img);
    imgs[e] = img;
  }

  let accent = "#c8ff1e";

  function applyLocalGlow(): void {
    localGlow.style.background = `radial-gradient(70% 55% at 50% 38%, ${accent}26 0%, transparent 64%)`;
  }
  applyLocalGlow();

  function setExpression(active: Expression): void {
    for (const e of EXPRESSIONS) {
      const img = imgs[e];
      const isActive = e === active;
      img.style.opacity = isActive ? "1" : "0";
      // 'hit' escala la imagen activa; el resto en escala neutra.
      img.style.transform = isActive && active === "hit" ? "scale(1.02)" : "scale(1)";
    }
  }

  function setAccent(hex: string): void {
    accent = hex;
    applyLocalGlow();
  }

  return { setExpression, setAccent };
}
