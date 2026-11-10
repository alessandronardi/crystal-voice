import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PLATE_PRESETS, type CrystalBody, type CrystalGeometry, type CrystalSeed, type PlatePreset } from '@voicecrystal/contracts';
import { generateCrystalGeometry, intersectHalfSpaces, type Plane } from '@voicecrystal/crystal-core';
import {
  classifyEdges,
  escapeXml,
  facesTowardViewer,
  featureEdges,
  formatCoord,
  PlateViewError,
  PROJECTIONS,
  renderPlateSvg,
} from '../src/index.ts';

const FULL = [1, 1, 1, 1, 1, 1] as const;
const S3 = Math.sqrt(3);

const cube: Plane[] = [
  { normal: [1, 0, 0], distance: 1, form: 'x' },
  { normal: [-1, 0, 0], distance: 1, form: 'x' },
  { normal: [0, 1, 0], distance: 1, form: 'y' },
  { normal: [0, -1, 0], distance: 1, form: 'y' },
  { normal: [0, 0, 1], distance: 1, form: 'z' },
  { normal: [0, 0, -1], distance: 1, form: 'z' },
];

/** Hexagonal prism, faces at 0°, 60°, …, 300°, with pinacoids. */
const hexPrism: Plane[] = [
  ...[
    [1, 0],
    [0.5, S3 / 2],
    [-0.5, S3 / 2],
    [-1, 0],
    [-0.5, -S3 / 2],
    [0.5, -S3 / 2],
  ].map(([c, s]): Plane => ({ normal: [c ?? 0, s ?? 0, 0], distance: 1, form: 'prism' })),
  { normal: [0, 0, 1], distance: 1, form: 'pinacoid' },
  { normal: [0, 0, -1], distance: 1, form: 'pinacoid' },
];

function body(planes: Plane[]): CrystalBody {
  return { kind: 'primary', planes, ...intersectHalfSpaces(planes) };
}

function geometryOf(b: CrystalBody): CrystalGeometry {
  return {
    geometryVersion: 'habit-1',
    habitName: 'prova <&> "test"',
    bodies: [b],
    inclusions: [],
    appearance: { colorOklch: [0.5, 0.1, 30], zoningBands: 1, veiledTraits: [] },
    geometryHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  };
}

const seedArb = fc.tuple(...Array.from({ length: 6 }, () => fc.integer({ min: 0, max: 10000 }))) as unknown as fc.Arbitrary<CrystalSeed>;
const gen = (s: readonly number[]): CrystalGeometry => generateCrystalGeometry(s as unknown as CrystalSeed, FULL, 'habit-1');
const primary = (s: readonly number[]): CrystalBody => {
  const b = gen(s).bodies[0];
  if (b === undefined) throw new Error('no primary');
  return b;
};

describe('formatCoord: 0.01 px, integer arithmetic, no -0', () => {
  it.each([
    [0, '0'],
    [256, '256'],
    [0.005, '0.01'],
    [-0.004, '0'],
    [-0.005, '0'],
    [-1.5, '-1.5'],
    [12.3456, '12.35'],
    [7.1, '7.1'],
    [100.07, '100.07'],
    [511.999, '512'],
  ])('%d → %s', (x, s) => {
    expect(formatCoord(x)).toBe(s);
  });

  it('rejects non-finite values', () => {
    expect(() => formatCoord(Number.NaN)).toThrow(RangeError);
    expect(() => formatCoord(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('escapeXml', () => {
  it('escapes markup characters', () => {
    expect(escapeXml(`a<b>&"c'`)).toBe('a&lt;b&gt;&amp;&quot;c&apos;');
  });

  it('drops characters XML 1.0 cannot carry, keeps tab, newline and valid pairs', () => {
    const nul = String.fromCharCode(0);
    const us = String.fromCharCode(0x1f);
    const fffe = String.fromCharCode(0xfffe);
    const hi = String.fromCharCode(0xd800);
    const lo = String.fromCharCode(0xdc00);
    expect(escapeXml(`a${nul}b${us}c${fffe}d`)).toBe('abcd');
    expect(escapeXml(`x${hi}y${lo}z`)).toBe('xyz');
    const pair = String.fromCodePoint(0x1f48e);
    expect(escapeXml(`t\tn\n${pair}`)).toBe(`t\tn\n${pair}`);
  });
});

describe('featureEdges: polygon edges, fan diagonals excluded', () => {
  it('cube: 12 edges; hexagonal prism: 18', () => {
    expect(featureEdges(body(cube))).toHaveLength(12);
    expect(featureEdges(body(hexPrism))).toHaveLength(18);
  });

  it('canonical order and distinct faces on each edge', () => {
    const edges = featureEdges(body(hexPrism));
    for (const e of edges) {
      expect(e.a).toBeLessThan(e.b);
      expect(e.f1).not.toBe(e.f2);
    }
    const keys = edges.map((e) => [e.a, e.b]);
    expect(keys).toEqual([...keys].sort((p, q) => (p[0] ?? 0) - (q[0] ?? 0) || (p[1] ?? 0) - (q[1] ?? 0)));
  });

  it('Euler V − E + F = 2 on the primary of random seeds', () => {
    fc.assert(
      fc.property(seedArb, (s) => {
        const b = primary(s);
        const v = new Set(Array.from(b.indices)).size;
        const f = new Set(Array.from(b.faceOfTriangle)).size;
        return v - featureEdges(b).length + f === 2;
      }),
      { numRuns: 200, seed: 20261112 },
    );
  });
});

describe('classifyEdges: visible if a face looks at the viewer (SPEC §10)', () => {
  it('cube, front view: the 4 edges of the front face visible, 8 hidden', () => {
    const c = classifyEdges(body(cube), 'front');
    expect([c.visible.length, c.hidden.length]).toEqual([4, 8]);
  });

  it.each([
    ['clinographic', 13, 5],
    ['front', 7, 11],
    ['top', 6, 12],
  ] as const)('hexagonal prism, %s view: %d visible, %d hidden (counted by hand)', (preset, v, h) => {
    // clinographic: facing = top pinacoid and prism faces at 180°, 240°, 300°
    // (6 top + 4 vertical + 3 bottom visible). front: facing = 240°, 300°;
    // 0° and 180° edge-on. top: only the top face; the 6 vertical edges are
    // seen end-on and count as hidden.
    const c = classifyEdges(body(hexPrism), preset);
    expect([c.visible.length, c.hidden.length]).toEqual([v, h]);
  });

  it('edge-on threshold: a face tilted by 1e-6 looks at the viewer, by 1e-12 it does not', () => {
    const tilted = (nz: number): CrystalBody => ({ ...body(cube), planes: [{ normal: [1, 0, nz], distance: 1, form: 'x' }] });
    expect(facesTowardViewer(tilted(1e-6), 'top')).toEqual([true]);
    expect(facesTowardViewer(tilted(1e-12), 'top')).toEqual([false]);
    expect(facesTowardViewer(tilted(-1e-6), 'top')).toEqual([false]);
  });
});

describe('visible and hidden edges on golden seeds (counts derived by hand)', () => {
  // habit-1 at these golden seeds: p1 = 0 is the trigonal prism (faces at 0°,
  // 120°, 240°) with pinacoid, 9 edges; p1 = 5000 and p2 = 0 is the
  // hexagonal prism with pinacoid, 18 edges. Trigonal: clinographic, facing =
  // top and 240° (3 top + 2 vertical + 1 bottom visible); front, facing =
  // 240° only (its 4 edges); top, the 3 top edges.
  it.each([
    [[0, 0, 0, 0, 0, 0], 'clinographic', 6, 3],
    [[0, 0, 0, 0, 0, 0], 'front', 4, 5],
    [[0, 0, 0, 0, 0, 0], 'top', 3, 6],
    [[5000, 0, 5000, 5000, 5000, 5000], 'clinographic', 13, 5],
    [[5000, 0, 5000, 5000, 5000, 5000], 'front', 7, 11],
    [[5000, 0, 5000, 5000, 5000, 5000], 'top', 6, 12],
  ] as const)('%j %s: %d visible, %d hidden', (seed, preset, v, h) => {
    const c = classifyEdges(primary(seed), preset);
    expect([c.visible.length, c.hidden.length]).toEqual([v, h]);
  });
});

/**
 * Independent oracle: clip the ray m + t·w (t > 0) from the edge midpoint
 * toward the viewer against every half-space; the edge is hidden iff the ray
 * runs through the solid. The quantized, welded mesh lies up to ~1e-3 off its
 * planes (MIN_FACE and weld drift in halfspace.ts), so ray lengths in
 * [AMBIGUOUS_LOW, AMBIGUOUS_HIGH] decide nothing and are skipped and counted
 * (review I-12, B1); so are edges next to near edge-on faces. Measured on
 * 2,000 random seeds: visible edges reach at most 1.95e-4, hidden edges start
 * at 5.4e-4; 0.24% of visible and 0.03% of hidden edges fall in the band.
 */
const AMBIGUOUS_LOW = 1e-4;
const AMBIGUOUS_HIGH = 2e-3;

function oracle(b: CrystalBody, preset: PlatePreset): { compared: number; skipped: number; mismatches: number } {
  const w = PROJECTIONS[preset].toward;
  const { visible, hidden } = classifyEdges(b, preset);
  const grazing = (f: number): boolean => {
    const n = b.planes[f]?.normal ?? [0, 0, 0];
    return Math.abs(n[0] * w[0] + n[1] * w[1] + n[2] * w[2]) < 1e-3 * Math.hypot(n[0], n[1], n[2]);
  };
  const p = (i: number, k: number): number => (b.positions[3 * i + k] ?? 0) / 65536;
  const rayInside = (a: number, c: number): number => {
    const m = [0, 1, 2].map((k) => (p(a, k) + p(c, k)) / 2);
    let t0 = 0;
    let t1 = Number.POSITIVE_INFINITY;
    for (const pl of b.planes) {
      const n = pl.normal;
      const nw = n[0] * w[0] + n[1] * w[1] + n[2] * w[2];
      const slack = pl.distance - (n[0] * (m[0] ?? 0) + n[1] * (m[1] ?? 0) + n[2] * (m[2] ?? 0));
      if (nw > 0) t1 = Math.min(t1, slack / nw);
      else if (nw < 0) t0 = Math.max(t0, slack / nw);
    }
    return t1 - t0;
  };
  let compared = 0;
  let skipped = 0;
  let mismatches = 0;
  for (const [edges, expectedHidden] of [
    [visible, false],
    [hidden, true],
  ] as const) {
    for (const e of edges) {
      const len = rayInside(e.a, e.b);
      if (grazing(e.f1) || grazing(e.f2) || (len >= AMBIGUOUS_LOW && len <= AMBIGUOUS_HIGH)) {
        skipped++;
        continue;
      }
      compared++;
      if (len > AMBIGUOUS_HIGH !== expectedHidden) mismatches++;
    }
  }
  return { compared, skipped, mismatches };
}

describe('classifyEdges against the independent ray oracle', () => {
  it.each([[[8582, 4891, 0, 0, 0, 0]], [[8567, 4882, 0, 0, 0, 0]]])(
    'regression %j: short hidden edge next to the silhouette (review I-12, B1)',
    (seed) => {
      expect(oracle(primary(seed), 'clinographic').mismatches).toBe(0);
    },
  );

  it('agrees on random seeds (clinographic), with few ambiguous edges', () => {
    let compared = 0;
    let skipped = 0;
    fc.assert(
      fc.property(seedArb, (s) => {
        const r = oracle(primary(s), 'clinographic');
        compared += r.compared;
        skipped += r.skipped;
        return r.mismatches === 0;
      }),
      { numRuns: 400, seed: 20261112 },
    );
    expect(compared).toBeGreaterThan(400 * 10);
    expect(skipped / (compared + skipped)).toBeLessThan(0.02);
  }, 60_000);
});

describe('renderPlateSvg', () => {
  const g = geometryOf(body(hexPrism));

  it('is a single <svg> root with escaped <title> and <desc>', () => {
    const svg = renderPlateSvg(g, { preset: 'clinographic', sizePx: 512 });
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img">')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg.match(/<svg/g)).toHaveLength(1);
    expect(svg).toContain('<title>prova &lt;&amp;&gt; &quot;test&quot;</title>');
    expect(svg).toMatch(/<desc>[^<]*plate-1[^<]*13 spigoli visibili, 5 nascosti[^<]*habit-1[^<]*0123456789abcdef[^<]*<\/desc>/);
    expect(svg).not.toMatch(/NaN|Infinity|undefined/);
    // Balanced tags: every opening tag that is not self-closing has a closing tag.
    for (const tag of ['svg', 'title', 'desc', 'g']) {
      expect(svg.match(new RegExp(`<${tag}[ >]`, 'g'))?.length).toBe(svg.match(new RegExp(`</${tag}>`, 'g'))?.length);
    }
  });

  it('draws hidden edges dashed and before the visible ones', () => {
    const svg = renderPlateSvg(g, { preset: 'clinographic', sizePx: 512 });
    const hidden = svg.indexOf('stroke-dasharray');
    const segments = (d: string): number => (d.match(/M/g) ?? []).length;
    const paths = [...svg.matchAll(/<path ([^>]*)d="([^"]*)"\/>/g)];
    expect(paths).toHaveLength(2);
    expect(hidden).toBeGreaterThan(-1);
    expect(hidden).toBeLessThan(svg.lastIndexOf('<path'));
    expect(segments(paths[0]?.[2] ?? '')).toBe(5);
    expect(segments(paths[1]?.[2] ?? '')).toBe(13);
  });

  it('scales strokes and dashes with the plate size', () => {
    expect(renderPlateSvg(g, { preset: 'clinographic', sizePx: 512 })).toContain('stroke-width="0.75" stroke-dasharray="4 3"');
    const big = renderPlateSvg(g, { preset: 'clinographic', sizePx: 1024 });
    expect(big).toContain('stroke-width="1.5" stroke-dasharray="8 6"');
    expect(big).toContain('<path stroke-width="2.5" d=');
  });

  it('omits the hidden path when no edge is hidden', () => {
    // Regular tetrahedron seen from above: every edge touches one of the three
    // upper faces, so nothing is hidden.
    const tetra: Plane[] = [
      { normal: [0, 0, -1], distance: 1, form: 't' },
      { normal: [0, 0.9428090415820634, 0.3333333333333333], distance: 1, form: 't' },
      { normal: [-0.816496580927726, -0.4714045207910317, 0.3333333333333333], distance: 1, form: 't' },
      { normal: [0.816496580927726, -0.4714045207910317, 0.3333333333333333], distance: 1, form: 't' },
    ];
    const svg = renderPlateSvg(geometryOf(body(tetra)), { preset: 'top', sizePx: 128 });
    expect(svg).not.toContain('stroke-dasharray');
    expect([...svg.matchAll(/<path /g)]).toHaveLength(1);
  });

  it('skips segments seen end-on (both rounded endpoints equal)', () => {
    // Top view of the prism: the 6 vertical edges project to points.
    const svg = renderPlateSvg(g, { preset: 'top', sizePx: 512 });
    const segs = [...svg.matchAll(/M(-?[\d.]+ -?[\d.]+)L(-?[\d.]+ -?[\d.]+)/g)];
    expect(segs).toHaveLength(12);
    expect(segs.every((m) => m[1] !== m[2])).toBe(true);
  });

  it('is deterministic, ignores p5 and p6, and stays inside the frame', () => {
    fc.assert(
      fc.property(seedArb, fc.constantFrom(...PLATE_PRESETS), (s, preset: PlatePreset) => {
        const a = renderPlateSvg(gen(s), { preset, sizePx: 512 });
        const other = [...s];
        other[4] = 10000 - s[4];
        other[5] = 10000 - s[5];
        const b = renderPlateSvg(gen(other), { preset, sizePx: 512 });
        if (a !== b || a !== renderPlateSvg(gen(s), { preset, sizePx: 512 })) return false;
        const segs = [...a.matchAll(/M(-?[\d.]+) (-?[\d.]+)L(-?[\d.]+) (-?[\d.]+)/g)];
        const coords = segs.flatMap((m) => [m[1], m[2], m[3], m[4]].map(Number));
        return segs.length > 0 && coords.every((c) => c >= 0 && c <= 512) && segs.every((m) => m[1] !== m[3] || m[2] !== m[4]);
      }),
      { numRuns: 150, seed: 20261112 },
    );
  }, 60_000);

  it('rejects an invalid view, a geometry without a primary body, or a malformed body', () => {
    expect(() => renderPlateSvg(g, { preset: 'side' as PlatePreset, sizePx: 512 })).toThrow(PlateViewError);
    expect(() => renderPlateSvg(g, { preset: 'front', sizePx: 63 })).toThrow(PlateViewError);
    expect(() => renderPlateSvg(g, { preset: 'front', sizePx: 512.5 })).toThrow(PlateViewError);
    expect(() => renderPlateSvg({ ...g, bodies: [] }, { preset: 'front', sizePx: 512 })).toThrow(PlateViewError);
    const b = body(hexPrism);
    const broken = { ...b, indices: b.indices.slice(0, b.indices.length - 3) };
    expect(() => renderPlateSvg(geometryOf(broken), { preset: 'front', sizePx: 512 })).toThrow(PlateViewError);
    const outOfRange = { ...b, faceOfTriangle: b.faceOfTriangle.map(() => 99) };
    expect(() => renderPlateSvg(geometryOf(outOfRange), { preset: 'front', sizePx: 512 })).toThrow(PlateViewError);
  });
});
