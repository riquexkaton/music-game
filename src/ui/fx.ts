// fx.ts — FX del gameplay: partículas (burst por judgment) + flash (destello) + shake.
//
// Contrato (blueprint §3, §9):
//   burst(judg, accent) = partículas en el canvas (centro ~ w/2, h*0.42).
//   flash(judg, accent) = destello en el flashEl (opacity peak → 0 en .42s).
//   shake()             = sacude el fieldEl (animación pl-shake).
//
// El corazón (motor real) decide CUÁNDO; este módulo es sólo piel reactiva.
// El loop de rAF sólo corre mientras hay partículas vivas: en reposo no consume nada.

export interface FxApi {
  burst(judg: "PERFECT" | "GOOD" | "MISS", accent: string): void;
  flash(judg: string, accent: string): void;
  shake(): void;
  /** Re-mide el canvas. Llamar cuando #screen-play se hace visible (game.start). */
  resize(): void;
}

type Judgment = "PERFECT" | "GOOD" | "MISS";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  color: string;
}

// Cantidad de partículas por judgment (blueprint §9).
const BURST_COUNT: Record<Judgment, number> = {
  PERFECT: 52,
  GOOD: 28,
  MISS: 14,
};

// Opacidad pico del flash por judgment (blueprint §9).
const FLASH_PEAK: Record<Judgment, number> = {
  PERFECT: 0.42,
  GOOD: 0.26,
  MISS: 0.3,
};

// Paleta de partículas por judgment. El acento por canción entra en PERFECT/GOOD;
// MISS es fijo (magenta + vino) — blueprint §9.
function burstColors(judg: Judgment, accent: string): string[] {
  switch (judg) {
    case "PERFECT":
      return [accent, "#FFFFFF", accent];
    case "GOOD":
      return [accent, "#F4F2E9"];
    case "MISS":
      return ["#FF2E9A", "#7A1540"];
  }
}

export function createFx(
  canvas: HTMLCanvasElement,
  flashEl: HTMLElement,
  fieldEl: HTMLElement,
): FxApi {
  const ctx = canvas.getContext("2d");
  const particles: Particle[] = [];

  // Dimensiones lógicas (CSS px). El backing store usa DPR para nitidez.
  let cssW = 0;
  let cssH = 0;
  let rafId = 0;

  function resize(): void {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    cssW = rect.width;
    cssH = rect.height;
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  resize();
  window.addEventListener("resize", resize);
  // El canvas se crea con #screen-play OCULTO (getBoundingClientRect 0x0 -> backing
  // store 1x1). Sin observar el elemento, una partícula rosa pintada en ese 1x1 se
  // estira a toda la pantalla (bug "pantalla rosa") hasta que cambie el tamaño de la
  // ventana. ResizeObserver lo redimensiona — y limpia — apenas el canvas aparece.
  const ro =
    typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => resize()) : null;
  if (ro) ro.observe(canvas);

  function step(): void {
    rafId = 0;
    if (!ctx) {
      particles.length = 0;
      return;
    }
    ctx.clearRect(0, 0, cssW, cssH);

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]!;
      // Integración (blueprint §9): gravedad + fricción horizontal + decaimiento de vida.
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.2;
      p.vx *= 0.985;
      p.life -= 0.021;

      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }

      const s = p.size * (0.5 + p.life * 0.5);
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;

    if (particles.length > 0) {
      rafId = requestAnimationFrame(step);
    } else {
      ctx.clearRect(0, 0, cssW, cssH);
    }
  }

  function ensureLoop(): void {
    if (rafId === 0 && particles.length > 0) {
      rafId = requestAnimationFrame(step);
    }
  }

  function burst(judg: Judgment, accent: string): void {
    if (!ctx) return;
    resize(); // el canvas pudo crearse oculto (1x1); re-medir + limpiar antes de dibujar
    const cx = cssW / 2;
    const cy = cssH * 0.42;
    const colors = burstColors(judg, accent);
    const count = BURST_COUNT[judg];
    const isMiss = judg === "MISS";

    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      // MISS más débil (1.2–3.8); resto enérgico (3.5–11.5) — blueprint §9.
      const sp = isMiss ? 1.2 + Math.random() * 2.6 : 3.5 + Math.random() * 8.0;
      particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(a) * sp,
        // Sesgo vertical: MISS cae, el resto salta — blueprint §9.
        vy: Math.sin(a) * sp - (isMiss ? -1.5 : 1.2),
        life: 1,
        size: 2 + Math.random() * 4.5,
        color: colors[i % colors.length]!,
      });
    }
    ensureLoop();
  }

  let flashAnim: Animation | null = null;
  function flash(judg: string, accent: string): void {
    const peak = (FLASH_PEAK as Record<string, number>)[judg] ?? 0.26;
    flashEl.style.background = judg === "MISS" ? "#FF2E9A" : accent;
    // Web Animations API en vez del truco transition+reflow: la animación corre y
    // SIEMPRE devuelve el elemento a su opacity base (0 del CSS) al terminar.
    // cancel() de la previa evita que se acumulen si los judgments llegan en ráfaga
    // (sin esto la pantalla podía quedar teñida de rosa). Imposible que quede fijo.
    flashAnim?.cancel();
    flashEl.style.opacity = "0";
    flashAnim = flashEl.animate(
      [{ opacity: String(peak) }, { opacity: "0" }],
      { duration: 420, easing: "ease-out" },
    );
  }

  function shake(): void {
    // Reset por reflow para re-disparar la animación aunque ya esté corriendo.
    fieldEl.style.animation = "none";
    void fieldEl.offsetWidth;
    fieldEl.style.animation = "pl-shake .32s ease";
  }

  return { burst, flash, shake, resize };
}
