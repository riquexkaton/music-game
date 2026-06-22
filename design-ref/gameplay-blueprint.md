# Blueprint — Gameplay + Result (diseño Pulse) sobre el MOTOR REAL

> Referencia de implementación para portar las pantallas GAMEPLAY y RESULT del diseño
> `Pulse Game.dc.html` (claude.ai/design) al proyecto real (TS + Vite + DOM).

## 0. REGLA DE ORO (no negociable)

El diseño es una **demo** con mecánica propia: barrido (`sweep`) de 4 beats, 14 rounds fijos,
audio sintético (WebAudio synth), secuencias random. **NO se usa esa mecánica.**

Se usa el **MOTOR REAL** que ya existe y está testeado (43 tests, NO romper):
- `conductor` (reloj maestro sobre `AudioContext.currentTime`, carga/reproduce la canción real)
- `scheduler` (metrónomo con lookahead), `judge`/`judgeBarCommit` (ventanas de timing reales)
- `SequenceTracker` (estado de la secuencia de flechas), canciones reales, sync manual, calibración.

El diseño aporta la **PIEL + las FEATURES** (layout, personaje, ondas, partículas, resultados).
El corazón es el motor. Piel sobre esqueleto.

## 1. Patrón ya establecido (Fases 1-3 — IMITAR)

- `index.html`: pantallas full-screen hermanas dentro de `<body>` (flex column): `#screen-start`,
  `#screen-select` (vacías, las maneja JS), `#screen-game` (panel viejo, AHORA SOLO PARA EL EDITOR).
- `src/ui/menu.ts`: `initMenu(hooks)` construye/maneja START y SELECT; router `showStart/showSelect/showGame`;
  recibe hooks del motor (`getSongs`, `onSelect`, `onPlay`).
- `src/ui/pulse.css`: tokens (`--ink #0b0b0c`, `--surface #141418`, `--line #2e2e36`, `--ghost #71717a`,
  `--paper #f4f2e9`, `--lime #c8ff1e`, `--cyan #25e0ff`, `--yellow #ffd021`, `--red #ff3b30`,
  `--magenta #ff2e9a`, `--violet #a78bfa`, `--orange #ff7847`; `--font-display: 'Archivo Black'`,
  `--font-mono: 'Space Mono'`; sombras duras `--shadow-hard 6px 6px 0 #000`, `-md 5px..`, `-sm 3px..`).
  Brutalist = `border-radius: 0` SIEMPRE. Clases `pl-*`. Animaciones `pl-*`.
- `src/main.ts`: estado module-level + funciones (`play`, `selectSong`, `renderSequence`, `renderTiming`,
  `applyResult`, `loop`, etc.). Cachea ids con `$()!` al cargar. `initMenu` enchufado al final;
  `onPlay: (song) => { selectSong(song); void play(); }`.

## 2. Arquitectura de archivos NUEVA

- `index.html` — agregar `#screen-play` y `#screen-result` (full-screen, hermanos de las otras screens).
  El layout interno lo construye `game.ts`/`result.ts` por JS (como menu.ts), o estático con ids — a criterio,
  pero TODO id que main.ts toque debe existir.
- `src/ui/pulse.css` — agregar TODO el CSS de gameplay + result + las animaciones nuevas (un solo lugar:
  evita conflictos entre agentes).
- `src/ui/game.ts` — NUEVO. Vista de juego: construye el DOM del layout, expone funciones de render que
  el motor llama (secuencia, timing/playhead, judgment, HUD/score/combo/best, progress), tiene los `<canvas>`
  de FX y de ondas + el contenedor del personaje, y ORQUESTA los módulos character/waves/fx.
- `src/ui/result.ts` — NUEVO. Pantalla de resultados (rango, score, precisión, combo, perfects/goods/misses).
- `src/ui/character.ts` — NUEVO. Personaje (cross-fade de 3 imágenes).
- `src/ui/waves.ts` — NUEVO. Visualizador de ondas (sonar rings) reactivo al audio.
- `src/ui/fx.ts` — NUEVO. Partículas + flash + shake.
- `src/core/conductor.ts` — agregar un `AnalyserNode` sobre el audio de la canción y exponerlo
  (p. ej. `getFrequencyData(): Uint8Array | null`) para que `waves.ts` reaccione al audio REAL.
  Es el ÚNICO archivo de `core/` que se toca; mantener los tests verdes.
- `src/main.ts` — wiring (ver §5).

## 3. Interfaces de los módulos (para implementar en paralelo, archivos separados)

```ts
// character.ts
export interface CharacterApi { setExpression(e: 'idle'|'hit'|'miss'): void; setAccent(hex: string): void; }
export function createCharacter(container: HTMLElement): CharacterApi;
// 3 <img> superpuestas (/characters/miku-idle.png, -hit.png, -miss.png), cross-fade por opacity (.26s).
// La expresión 'hit' además hace scale(1.02). setAccent recolorea glow/label.
// Si una imagen no carga (el usuario las sube luego), NO romper: dejar el panel con el glow + label.

// waves.ts
export interface WavesApi { start(): void; stop(): void; setAccent(hex: string): void; }
export function createWaves(canvas: HTMLCanvasElement, getFreq: () => Uint8Array | null, getBpm: () => number): WavesApi;
// Sonar rings concéntricos en las DOS esquinas inferiores. Reactivo al audio (getFreq) + pulso por beat (getBpm).

// fx.ts
export interface FxApi { burst(judg: 'PERFECT'|'GOOD'|'MISS', accent: string): void; flash(judg: string, accent: string): void; shake(): void; }
export function createFx(canvas: HTMLCanvasElement, flashEl: HTMLElement, fieldEl: HTMLElement): FxApi;
// burst = partículas; flash = destello en el flashEl; shake = sacude el fieldEl (anim pl-shake).
```

`game.ts` crea el DOM, instancia los 3 módulos con sus canvas/elementos, y los llama desde los hooks
que main.ts dispara.

## 4. Mapeo DISEÑO ↔ MOTOR (lo más importante)

| Diseño (demo) | Motor real (usar ESTO) |
|---|---|
| `seq`, `typed`, `genSeq()` random | `tracker` (SequenceTracker): `loaded` / `current` (i===loaded) / pending / `broken`. Glifos `ARROW_GLYPH`. |
| `sweep` + `PERFECT_LINE 0.86` | `renderTiming`: `progress = (beat-(commitBeat-APPROACH))/(APPROACH+AFTER)`; head a ~80% en el commit. Zona objetivo del motor. |
| `onConfirm` juzga `|pos-0.86|` | `onCommit` → `judgeBarCommit` (grades reales: `perfect`/`cool`/`good`/`miss` + `delta`). |
| `score`, combo, `mult` por combo | `score`, `combo` del motor (`applyResult`). `best` = trackear `Math.max`. |
| `perfects/goods/misses` | trackear en `applyResult` contando por grade (cool cuenta como perfect/azul). |
| `progressPct = round/14` | progreso real de la canción: `conductor.beat / totalBeats` (o equivalente). |
| `expr` (idle/hit/miss) | en `applyResult`: `miss` → 'miss', else → 'hit'; volver a 'idle' a los ~620ms. |
| audio synth (beep/ticks/hits) | NO usar. La canción real suena por el conductor; el downbeat ya lo marca el scheduler. Los SFX de hit son opcionales (si se quieren, módulo aparte, no el synth de la demo). |
| `endGame()` a los 14 rounds | fin de canción REAL: cuando `conductor.time >= duración` (o se acaban las barras) → RESULT. |

Colores de judgment (fijos, NO cambian por canción): `PERFECT #25E0FF`, `GOOD #C8FF1E`(lima)/o `--yellow` según
el diseño usa lima para GOOD en game (`judgColors = { PERFECT:'#25E0FF', GOOD:'#C8FF1E', MISS:'#FF2E9A' }`),
`MISS #FF2E9A`. Subtítulos: PERFECT '¡EN EL PUNTO!', GOOD 'BIEN', MISS 'FALLASTE'.
El acento POR CANCIÓN (de la card seleccionada) tiñe: secuencia activa, playhead, combo, glow del personaje.

## 5. Wiring en main.ts

- `play()`: en vez de quedarse en `#screen-game`, mostrar `#screen-play` (`menu.showPlay()` o equivalente nuevo
  en el router) y arrancar el runner real. La vista de juego (game.ts) se actualiza desde las render functions.
- `renderSequence` / `renderTiming` / `applyResult`: cuando la vista activa es PLAY, delegar a las funciones de
  `game.ts` (que escriben el DOM nuevo). Mantener compatibilidad con el editor "Probar" (que usa el panel viejo)
  — lo más simple: el editor "Probar" sigue en `#screen-game` (panel) con sus ids viejos; el juego real va a
  `#screen-play`. Definir un flag de "dónde renderizar" o que game.ts y el panel tengan ids distintos y las
  render functions actualicen ambos / el activo.
- En `applyResult`: además de score/combo, disparar `character.setExpression`, `fx.burst/flash/shake`, y trackear
  perfects/goods/misses + best.
- Detección de fin de canción → `result.show(stats)` con `{ score, best, perfects, goods, misses, accuracy, rank, song }`.
- Botones: song bar `mute` (mutea el master del conductor), `ESC·SALIR` → volver a SELECT (`stopPlayback` + `menu.showSelect`).
  Result: `REINTENTAR` → `play()` de nuevo; `◄ PISTAS` → SELECT.

## 6. Layout GAMEPLAY (medidas y estilos exactos del diseño)

`#screen-play` = flex column. Dentro:
1. **Song bar** (flex none, border-bottom 2px `--line`, bg `--ink`): franja de acento 14px + celda título
   (Archivo Black 20px) + celda BPM (número en acento + 'BPM' mono 10px `--ghost`) + celda dificultad
   (mono 700 11px `--paper-dim`) + spacer + botón mute (mono 700 11px, color acento/`--ghost-2` si muteado)
   + botón `ESC · SALIR` (mono 700 11px `--ghost`, hover magenta). Celdas separadas por `border-right 2px --line`, padding 14px 22px.
2. **Progress** (flex none, h6px, bg `--surface`, border-bottom 2px `--line`): fill `width: {progress}` bg acento, transition width .4s.
3. **Play field** (flex 1, position relative, bg `#070708`, overflow hidden):
   - flash layer: `position:absolute;inset:0;z-index:6;pointer-events:none;opacity:0;mix-blend-mode:screen`.
   - fx `<canvas>`: `absolute;inset:0;width:100%;height:100%;z-index:7;pointer-events:none`.
   - **Character panel** (flex none, width 42%, min-width 330px, overflow hidden, bg `--ink`, border-right 2px `--line`):
     glow `radial-gradient(80% 60% at 50% 34%, {accent}38 0%, transparent 62%)` (z0); scanlines
     `repeating-linear-gradient(45deg, rgba(255,255,255,.018) 0 2px, transparent 2px 9px)` (z0);
     label "VOCALISTA" arriba-izq (cuadrito acento 11px + mono 11px `--paper-dim`); expresión abajo-izq
     (Archivo Black clamp(20px,2.4vw,30px), color = miss?magenta:accent, text-shadow 3px 3px 0 #000):
     idle 'EN RITMO' / hit '¡BRILLANDO!' / miss 'OUCH...'; 3 `<img>` miku superpuestas (object-fit cover,
     object-position center top), cross-fade por opacity.
   - **Game column** (flex 1, position relative, z2, overflow hidden, flex column, padding 32px 48px):
     wave `<canvas>` (absolute inset0 z0). Encima (z1):
     - TOP: row space-between. MEJOR (izq, label mono 11px `--ghost`, valor Archivo Black clamp(34-52px) `--lime` + 'x' 0.5em).
       COMBO (der, igual pero valor en acento de canción).
     - CENTER (flex 1, center, gap 26px): judgment (caja h120px; si hay: Archivo Black clamp(56-112px) color judg
       + text-shadow 6px 6px 0 #000, subtítulo mono 12px `--ghost`, animación `pl-stamp .4s`; si no: 'PREPARADO'
       Archivo Black clamp(44-84px) color `#16161B`). Arrows (gap 16px, keycaps 60×60 border 3px: done = fill acento
       + ink + shadow 4px 4px 0 #000; current = acento border/text + bg rgba(255,255,255,.03) + `pl-glow`;
       pending = `#52525B` text + `--line` border). Timing bar (max-width 560px, h54, bg `#0B0B0C`, border 3px `--paper`):
       goodZone `left 76% width 20% bg accent opacity .12`; perfZone `left 81% width 10% opacity .3 + bordes acento`;
       perfLine `left 86% width 2px acento opacity .7`; playhead `top/bottom -9px width 5px bg --paper shadow 0 0 14px`.
       phase label (mono 12px; 'CARGÁ LA SECUENCIA' `--ghost` / '¡CONFIRMÁ EN LA ZONA!' acento). Score (label mono 11px
       `--ghost` + Archivo Black clamp(44-72px), `.toLocaleString('en-US')`).
     - BOTTOM: hint centrado (mono 12px `--ghost-2`): "CARGÁ [← ↑ → ↓] Y CONFIRMÁ CON [ESPACIO]" con kbd
       (border 2px; el de ESPACIO border `--lime` + color lima).

## 7. Layout RESULT

`#screen-result` flex column center, padding 40px, glow radial de fondo (acento). Contenido max-width 760:
- "PISTA COMPLETADA" (mono 12px letter-spacing .3em `--ghost`) + título (Archivo Black clamp(36-64px) acento) + `{diff} · {bpm} BPM`.
- Card (flex, border 3px `--paper`, box-shadow 8px 8px 0 #000, bg `--ink`): bloque RANGO (width 200px, bg acento,
  letra Archivo Black 120px color ink, label 'RANGO' mono ink) + columna derecha: SCORE (row, Archivo Black 38px) sobre
  grid 2×2 (PRECISIÓN acento / MEJOR COMBO lima / PERFECT cyan / GOOD lima + MISS magenta). Bordes internos 2px `--line`.
- Botones: REINTENTAR (Archivo Black 18px, bg `--lime` ink, border 3px lima, shadow 5px 5px 0 #000, hover translate(-2,-2))
  + `◄ PISTAS` (ghost border `--line`, hover border paper + bg `#141418`).
- Rango por precisión `acc = round((perfects + goods*0.5)/total*100)`: ≥95 'S', ≥85 'A', ≥70 'B', ≥50 'C', else 'D'.

## 8. Animaciones nuevas (a pulse.css)

```css
@keyframes pl-stamp { 0%{transform:scale(1.55) rotate(-3deg);opacity:0} 55%{transform:scale(.93) rotate(-3deg);opacity:1} 100%{transform:scale(1) rotate(-3deg);opacity:1} }
@keyframes pl-shake { 0%,100%{transform:translateX(0)} 15%{transform:translateX(-12px)} 30%{transform:translateX(10px)} 45%{transform:translateX(-8px)} 60%{transform:translateX(6px)} 75%{transform:translateX(-4px)} }
```
(El pulso de la flecha actual reusa `pl-glow`.)

## 9. Algoritmos de las FEATURES (del diseño — portar fieles)

### Partículas (fx.ts → drawFx/spawnBurst)
- En cada hit: `burst(judg, accent)`. Centro ~ (canvas.w/2, canvas.h*0.42).
- Colores: PERFECT `[accent,'#FFFFFF',accent]`, GOOD `[accent,'#F4F2E9']`, MISS `['#FF2E9A','#7A1540']`.
- Cantidad: PERFECT 52, GOOD 28, MISS 14. Cada partícula: ángulo random; speed MISS 1.2–3.8 / else 3.5–11.5;
  `vy = sin(a)*sp - (miss? -1.5 : 1.2)`; `life 1`; size 2–6.5.
- Loop por frame: `x+=vx; y+=vy; vy+=0.2; vx*=0.985; life-=0.021`; dibujar `fillRect` cuadrado (size*(0.5+life*0.5)),
  alpha=life. Borrar al morir.

### Flash + shake
- flash: setear `flashEl.style.background = (miss?'#FF2E9A':accent)`, opacity peak (PERFECT .42 / GOOD .26 / MISS .3),
  forzar reflow, luego transition opacity .42s → 0.
- shake: `fieldEl.style.animation = 'pl-shake .32s ease'` (resetear con reflow).

### Ondas (waves.ts → drawWaves)
- 7 anillos concéntricos en CADA esquina inferior (insets ~8px). `level` = promedio de `getFreq()`/255 (0 si no hay audio).
- `beatPulse = pow(1 - frac((now)/(60000/bpm)), 2.4)`; `drive = min(1, level*1.7 + beatPulse*0.5 + 0.16)`.
- `maxR 320`, `spacing = maxR/7`, `drift = (t*26)%spacing`, `beatR = beatPulse*24`.
- Por anillo i: `r = i*spacing + drift + beatR`; saltar si r<5 o r>maxR; `fade = 1-r/maxR`;
  stroke acento, alpha `fade*(0.4+drive*0.6)`, lineWidth `1.4+fade*2.2`. Punto central acento r=`5+beatPulse*3`.
- El canvas hace overflow:hidden del game column → se ven cuartos de círculo en las esquinas.

## 10. Imágenes del personaje

`public/characters/miku-idle.png`, `miku-hit.png`, `miku-miss.png`. **Las sube el usuario** (están en su proyecto
de claude.ai/design). El módulo usa rutas absolutas `/characters/miku-*.png`. Si faltan, el panel debe verse OK igual
(glow + label + expresión), sin errores en consola.

## 11. Verificación (obligatoria antes de cerrar)

- `bunx tsc --noEmit` limpio (tsconfig estricto: `noUnusedLocals`, `noUnusedParameters`, `strict`).
- `bunx vitest run` → 43 tests verdes (NO romper `core/`; sólo se agrega el analyser al conductor).
- Flujo manual: START → SELECT → JUGAR → GAMEPLAY (con motor real, canción real) → fin → RESULT → REINTENTAR/PISTAS.
- Package manager: **bun** (nunca npm). NO correr `vite build`.
