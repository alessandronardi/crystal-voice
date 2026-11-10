// Visual catalogue of 200 habit-1 seeds for the G2 aesthetic review (I-10,
// I-12). Each card: the canonical plate of renderer-svg (clinographic, front,
// top; primary only, hidden edges dashed), plus a simple colour axonometric
// view of all bodies with back-face culling and painter's order (not
// canonical, no byte-identical guarantee). Output:
// tests/benchmarks/out/catalog/index.html (not versioned).
//   pnpm catalog [--out DIR]

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CrystalBody, CrystalGeometry, CrystalSeed } from '@voicecrystal/contracts';
import { generateCrystalGeometry } from '@voicecrystal/crystal-core';
import { renderPlateSvg } from '@voicecrystal/renderer-svg';
import { goldenSeeds } from './seeds.ts';

type V3 = [number, number, number];
const U = 65536;

function vertex(b: CrystalBody, i: number): V3 {
  return [(b.positions[3 * i] ?? 0) / U, (b.positions[3 * i + 1] ?? 0) / U, (b.positions[3 * i + 2] ?? 0) / U];
}

/** Face polygons (vertex index rings) of a body, rebuilt from its triangle fans. */
function faces(b: CrystalBody): { plane: number; ring: number[] }[] {
  const byFace = new Map<number, number[][]>();
  b.faceOfTriangle.forEach((f, t) => {
    const list = byFace.get(f) ?? [];
    list.push([b.indices[3 * t] ?? 0, b.indices[3 * t + 1] ?? 0, b.indices[3 * t + 2] ?? 0]);
    byFace.set(f, list);
  });
  return Array.from(byFace, ([plane, tris]) => {
    // A fan (r, b_i, c_i) chains b_{i+1} = c_i: follow it from the b that is no c.
    const next = new Map<number, number>();
    const cs = new Set<number>();
    for (const t of tris) {
      next.set(t[1] ?? 0, t[2] ?? 0);
      cs.add(t[2] ?? 0);
    }
    const root = tris[0]?.[0] ?? 0;
    let cur = [...next.keys()].find((k) => !cs.has(k)) ?? tris[0]?.[1] ?? 0;
    const ring = [root, cur];
    while (next.has(cur) && ring.length <= tris.length + 1) {
      cur = next.get(cur) ?? cur;
      ring.push(cur);
    }
    return { plane, ring };
  });
}

/** Axonometric projection seen from above: rotate 35° about z, tilt 20° down; returns [x, y, depth]. */
function axo([x, y, z]: V3): V3 {
  const cz = 0.819;
  const sz = 0.574;
  const ct = 0.94;
  const st = 0.342;
  const x1 = cz * x - sz * y;
  const y1 = sz * x + cz * y;
  return [x1, -(ct * z + st * y1), ct * y1 - st * z];
}

function color(g: CrystalGeometry, shade: number): string {
  const [l, c, h] = g.appearance.colorOklch;
  return `oklch(${(l * (0.75 + 0.35 * shade)).toFixed(3)} ${c.toFixed(3)} ${h.toFixed(1)})`;
}

function axonometricSvg(g: CrystalGeometry): string {
  const polys: { depth: number; d: string; shade: number }[] = [];
  const light: V3 = [0.4, -0.5, 0.77];
  for (const b of g.bodies) {
    for (const f of faces(b)) {
      const plane = b.planes[f.plane];
      if (plane === undefined) continue;
      const n = plane.normal;
      const nv = axo([n[0], n[1], n[2]]);
      if (nv[2] >= 0) continue; // facing away (viewer looks along +depth)
      const pts = f.ring.map((i) => axo(vertex(b, i)));
      const depth = pts.reduce((s, p) => s + p[2], 0) / pts.length;
      const len = Math.hypot(n[0], n[1], n[2]);
      const shade = Math.max(0, (n[0] * light[0] + n[1] * light[1] + n[2] * light[2]) / len);
      polys.push({ depth, shade, d: `M${pts.map((p) => `${(p[0] * 40).toFixed(1)},${(p[1] * 40).toFixed(1)}`).join('L')}Z` });
    }
  }
  polys.sort((a, b) => b.depth - a.depth);
  const paths = polys.map((p) => `<path d="${p.d}" fill="${color(g, p.shade)}"/>`);
  return `<svg class="ax" viewBox="-110 -150 220 300" width="180" height="245" role="img" aria-label="${g.habitName}">${paths.join('')}</svg>`;
}

// Page styles: design tokens with light and dark values; SVG strokes come from
// the tokens, crystal fills from appearance.colorOklch (p5).
const STYLE = `<style>
/* Layout: a header with the review guide and the habit counts, then a grid of specimen cards. */
:root{--bg:#eef0f2;--card:#fbfcfd;--fg:#1d2329;--muted:#5a6570;--rule:#d3d9df;--edge:#1d2329;--line:#6b7682;--accent:#2f5d8a;
--serif:"Spectral",Georgia,"Times New Roman",serif;--mono:"IBM Plex Mono",ui-monospace,Consolas,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#14181c;--card:#1c2228;--fg:#e4e9ee;--muted:#9aa6b2;--rule:#2e363e;--edge:#0b0d0f;--line:#8d99a5;--accent:#8db8e0;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#14181c;--card:#1c2228;--fg:#e4e9ee;--muted:#9aa6b2;--rule:#2e363e;--edge:#0b0d0f;--line:#8d99a5;--accent:#8db8e0;color-scheme:dark}
body{background:var(--bg);color:var(--fg);font:14px/1.5 var(--serif);padding-block:24px 40px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
header{max-width:68ch;display:grid;gap:10px;margin-bottom:24px}
h1{font-size:28px;line-height:1.15;font-weight:600;margin:0;text-wrap:balance}
h2{font:600 11px/1.4 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:8px 0 0}
p{margin:0}
.note{color:var(--muted)}
ul{margin:0;padding-left:20px;display:grid;gap:4px}
table{border-collapse:collapse;font:12px/1.5 var(--mono);font-variant-numeric:tabular-nums}
td{padding:2px 16px 2px 0;border-bottom:1px solid var(--rule)}
td:last-child{text-align:right;padding-right:0}
.counts{overflow-x:auto}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
figure{margin:0;background:var(--card);border:1px solid var(--rule);border-radius:4px;padding:10px;display:grid;gap:6px;justify-items:center;min-width:0}
svg{max-width:100%;height:auto}
.ax path{stroke:var(--edge);stroke-width:.6;stroke-linejoin:round}
.plates{display:grid;grid-template-columns:2fr 1fr;gap:4px;align-items:center;width:100%;color:var(--fg)}
.plates>svg:first-child{grid-row:span 2}
.plates svg{width:100%;height:auto}
.ax{width:150px}
figcaption{display:grid;gap:2px;text-align:center;width:100%}
.name{font-size:15px;font-weight:600;line-height:1.25}
.data{font:11px/1.45 var(--mono);color:var(--muted);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.data code{color:var(--accent)}
</style>`;

/** Page content without the document skeleton (the Artifact publish adds it). */
export function buildCatalog(count: number): string {
  // The first golden seeds are axis sweeps around 5000; take three extremes,
  // then the pseudo-random part of the list.
  const all = goldenSeeds();
  const picks = [...all.slice(0, 3), ...all.slice(59, 59 + count - 3)];
  const cards: string[] = [];
  const habits = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const seed = picks[i] ?? [0, 0, 0, 0, 0, 0];
    const g = generateCrystalGeometry(seed as unknown as CrystalSeed, [1, 1, 1, 1, 1, 1], 'habit-1');
    const triangles = g.bodies.reduce((n, b) => n + b.faceOfTriangle.length, 0);
    habits.set(g.habitName, (habits.get(g.habitName) ?? 0) + 1);
    cards.push(
      `<figure><div class="plates">${renderPlateSvg(g, { preset: 'clinographic', sizePx: 256 })}${renderPlateSvg(g, { preset: 'front', sizePx: 128 })}${renderPlateSvg(g, { preset: 'top', sizePx: 128 })}</div>${axonometricSvg(g)}` +
        `<figcaption><span class="name">${g.habitName}</span><span class="data">seed ${seed.join(' · ')}</span>` +
        `<span class="data">${g.bodies.length} corpi · ${triangles} triangoli · ${g.inclusions.length} inclusioni</span>` +
        `<span class="data"><code>${g.geometryHash.slice(0, 12)}</code></span></figcaption></figure>`,
    );
  }
  const counts = [...habits].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return `<title>Catalogo habit-1</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Spectral:wght@400;600&display=swap">
${STYLE}
<header>
<h1>Catalogo habit-1: ${count} esemplari per la revisione G2</h1>
<p>Ogni scheda mostra in alto la tavola cristallografica canonica di I-12 (<code>renderPlateSvg</code>): vista clinografica grande, frontale e dall'alto piccole, solo il corpo primario, spigoli nascosti tratteggiati, scala fissa uguale per tutti. Sotto, un'assonometria a colori semplice che mostra anche i secondari: colore da p5, nessun materiale, aghi e fantasma non disegnati. Il seed è p1 · p2 · p3 · p4 · p5 · p6, in [0, 10000].</p>
<h2>Cosa guardare</h2>
<ul>
<li>Credibilità mineralogica delle forme e delle terminazioni.</li>
<li>Tavola: spigoli nascosti al posto giusto e leggibilità dello stile da atlante.</li>
<li>Varietà fra esemplari: i secondari stanno su posizioni base fisse e il rumore ne varia soglia di nascita, altezza e inclinazione (ADR-0018).</li>
<li>Nomi sul cartellino: «trigonale smussato» ed «esagonale doppio» seguono ADR-0019.</li>
</ul>
<h2>Abiti nel campione</h2>
<div class="counts"><table>${counts.map(([n, c]) => `<tr><td>${n}</td><td>${c}</td></tr>`).join('')}</table></div>
</header>
<main>${cards.join('')}</main>
`;
}

function main(argv: readonly string[]): number {
  const o = argv.indexOf('--out');
  const dir = resolve(o >= 0 ? (argv[o + 1] ?? '.') : resolve(import.meta.dirname, '../../tests/benchmarks/out/catalog'));
  mkdirSync(dir, { recursive: true });
  const page = buildCatalog(200);
  // page.html is the fragment for an Artifact publish; index.html opens locally.
  writeFileSync(join(dir, 'page.html'), page);
  const file = join(dir, 'index.html');
  writeFileSync(file, `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>\n${page}</body></html>\n`);
  console.log(`catalogo: 200 seed → ${file} (frammento per la pubblicazione: page.html)`);
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  process.exitCode = main(process.argv.slice(2));
}
