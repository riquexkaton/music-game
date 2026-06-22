// result.ts — Pantalla de resultados (#screen-result, estética Pulse). Blueprint §7.
//
// Calcula el rango por precisión y pinta la card (RANGO + SCORE + grid 2×2).
// No conoce el motor: recibe hooks (reintentar / volver a pistas) y los stats
// que main.ts arma al terminar la canción real.

export interface ResultStats {
  song: string;
  difficulty: string;
  bpm: number;
  accent: string;
  score: number;
  best: number;
  perfects: number;
  goods: number;
  misses: number;
}

export interface ResultHooks {
  onRetry: () => void;
  onBackToList: () => void;
}

export interface ResultApi {
  show(stats: ResultStats): void;
}

/** Rango por precisión: ≥95 'S', ≥85 'A', ≥70 'B', ≥50 'C', else 'D'. */
export function rankFor(accuracy: number): "S" | "A" | "B" | "C" | "D" {
  if (accuracy >= 95) return "S";
  if (accuracy >= 85) return "A";
  if (accuracy >= 70) return "B";
  if (accuracy >= 50) return "C";
  return "D";
}

/** Precisión 0..100: round((perfects + goods*0.5) / total * 100). 0 si total 0. */
export function accuracyFor(perfects: number, goods: number, misses: number): number {
  const total = perfects + goods + misses;
  if (total === 0) return 0;
  return Math.round(((perfects + goods * 0.5) / total) * 100);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}

export function createResult(root: HTMLElement, hooks: ResultHooks): ResultApi {
  function show(stats: ResultStats): void {
    const acc = accuracyFor(stats.perfects, stats.goods, stats.misses);
    const rank = rankFor(acc);
    root.style.setProperty("--accent", stats.accent);
    root.innerHTML = `
      <div class="pl-result-glow"></div>
      <div class="pl-result-body">
        <div class="pl-result-eyebrow">PISTA COMPLETADA</div>
        <h1 class="pl-result-title">${escapeHtml(stats.song)}</h1>
        <div class="pl-result-meta">${escapeHtml(stats.difficulty)} · ${Math.round(stats.bpm)} BPM</div>

        <div class="pl-result-card">
          <div class="pl-rank-block">
            <div class="pl-rank-letter">${rank}</div>
            <div class="pl-rank-label">RANGO</div>
          </div>
          <div class="pl-result-cols">
            <div class="pl-result-score">
              <div class="pl-hud-label">SCORE</div>
              <div class="pl-result-score-num">${stats.score.toLocaleString("en-US")}</div>
            </div>
            <div class="pl-result-grid">
              <div class="pl-result-cell pl-cell-acc"><div class="pl-cell-label">PRECISIÓN</div><div class="pl-cell-val">${acc}%</div></div>
              <div class="pl-result-cell pl-cell-best"><div class="pl-cell-label">MEJOR COMBO</div><div class="pl-cell-val">${stats.best}x</div></div>
              <div class="pl-result-cell pl-cell-perf"><div class="pl-cell-label">PERFECT</div><div class="pl-cell-val">${stats.perfects}</div></div>
              <div class="pl-result-cell pl-cell-gm"><div class="pl-cell-label">GOOD / MISS</div><div class="pl-cell-val"><span class="pl-good">${stats.goods}</span> / <span class="pl-miss">${stats.misses}</span></div></div>
            </div>
          </div>
        </div>

        <div class="pl-result-actions">
          <button class="pl-retry" id="plr-retry">REINTENTAR</button>
          <button class="pl-tolist" id="plr-tolist">◄ PISTAS</button>
        </div>
      </div>`;

    (root.querySelector("#plr-retry") as HTMLButtonElement).addEventListener("click", () =>
      hooks.onRetry(),
    );
    (root.querySelector("#plr-tolist") as HTMLButtonElement).addEventListener("click", () =>
      hooks.onBackToList(),
    );
  }

  return { show };
}
