// Layout solver for the clip wall.
//
// Given N clips (as aspect ratios) and the shape of the container, decide how
// to tile them: enumerate a small set of tiling templates × every
// clip-to-slot assignment, score each arrangement, keep the best. n <= 4, so
// the whole search is a few hundred evaluations of cheap arithmetic and can
// run on every render.
//
// Pure and side-effect free — this is the only place wall geometry is decided.

/** A cell's box within the container, as fractions of it (0..1). */
export interface IWallRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * How the mismatch between a clip's aspect and its cell's is paid for:
 * - `fill` — cells cover the container and the mismatch is cropped away.
 * - `fit` — the collage is shrink-wrapped to an aspect that crops nothing, and
 *   the mismatch becomes empty space around it.
 * - `blur` — fill's geometry, but the mismatch is paid *inside* each cell as a
 *   blurred matte (a contained foreground over a blurred cover copy).
 */
export type WallFitMode = "fill" | "fit" | "blur";

export interface IWallLayout {
  /** name of the winning template — diagnostics only */
  template: string;
  /** indexed by clip (not by slot) */
  placement: IWallRect[];
  /** per clip: fraction of the source lost to crop, or shown as matte */
  crop: number[];
  /** the worst single cell's crop — what the eye actually complains about */
  worstCrop: number;
  /** area-weighted mean crop */
  totalCrop: number;
  /** fraction of the container left empty (fit mode only) */
  letterbox: number;
  /** the biggest cell's share of the wall, 0..1 */
  largestArea: number;
  /** the objective this layout won on; lower is better */
  score: number;
}

// ------------------------------------------------------------
// objective
// ------------------------------------------------------------
//
//   score = worstCellCrop
//         + BALANCE_WEIGHT * max(0, largestCellArea - BALANCE_CAP)
//         + TOTAL_CROP_WEIGHT * areaWeightedCrop
//
// Minimising crop alone happily hands one clip most of the screen: a big-left
// arrangement can be crop-perfect while squeezing three clips into a sliver.
// The balance term prices dominance beyond BALANCE_CAP steeply but not
// absolutely, so a draw with no decent balanced arrangement can still exceed
// the cap rather than being forced into a terrible one.
//
// It is also what makes the parametric `@split` templates worth enumerating:
// under pure minimax a forced split can never beat the natural (justified)
// split, but sliding a split trades a little crop for size equality.
//
// Consequence: per-cell crops are no longer always identical. That is the
// trade being bought.

/** how steeply a cell is punished for exceeding BALANCE_CAP of the wall */
const BALANCE_WEIGHT = 1.5;
/** share of the wall a single cell may take before the penalty starts */
const BALANCE_CAP = 0.6;
/** pure tie-break between otherwise equal layouts */
const TOTAL_CROP_WEIGHT = 0.001;

// ------------------------------------------------------------
// tilings
// ------------------------------------------------------------

// `groups` hold slot indices. columnsOfRows lays the groups out as columns,
// each column stacking its members as rows. Default column widths are the
// "justified" widths — a column of clips filling height 1 wants width
// 1 / Σ(1/ar) — which is what makes intra-column crop ~zero.
function columnsOfRows(
  groups: number[][],
  aspects: number[],
  weights?: number[]
): IWallRect[] {
  const natural = groups.map(
    (g) => 1 / g.reduce((sum, i) => sum + 1 / aspects[i], 0)
  );
  const widths = weights ?? natural;
  const total = widths.reduce((sum, v) => sum + v, 0);
  const out: IWallRect[] = new Array(aspects.length);
  let x = 0;
  groups.forEach((group, gi) => {
    const cw = widths[gi] / total;
    const inverse = group.map((i) => 1 / aspects[i]);
    const inverseTotal = inverse.reduce((sum, v) => sum + v, 0);
    let y = 0;
    group.forEach((slot, k) => {
      const ch = inverse[k] / inverseTotal;
      out[slot] = { x, y, w: cw, h: ch };
      y += ch;
    });
    x += cw;
  });
  return out;
}

// the transpose: groups as rows, each row a set of columns. Row heights
// default to 1 / Σ(ar) — the justified-photo-row height.
function rowsOfColumns(
  groups: number[][],
  aspects: number[],
  weights?: number[]
): IWallRect[] {
  const natural = groups.map(
    (g) => 1 / g.reduce((sum, i) => sum + aspects[i], 0)
  );
  const heights = weights ?? natural;
  const total = heights.reduce((sum, v) => sum + v, 0);
  const out: IWallRect[] = new Array(aspects.length);
  let y = 0;
  groups.forEach((group, gi) => {
    const rh = heights[gi] / total;
    const aspectTotal = group.reduce((sum, i) => sum + aspects[i], 0);
    let x = 0;
    group.forEach((slot) => {
      const cw = aspects[slot] / aspectTotal;
      out[slot] = { x, y, w: cw, h: rh };
      x += cw;
    });
    y += rh;
  });
  return out;
}

// forced split fractions, tried alongside the justified split: when the
// container is far off-shape, or the natural split is lopsided, the justified
// split is not the optimum
const SPLITS = [0.35, 0.45, 0.55, 0.65, 0.75];

interface ITemplate {
  name: string;
  // a forced split crops by construction, which breaks fit mode's premise that
  // the collage has one aspect at which nothing crops
  forcedSplit: boolean;
  build: (aspects: number[]) => IWallRect[];
}

function twoGroup(
  label: string,
  groups: number[][],
  axis: "columns" | "rows"
): ITemplate[] {
  const build = axis === "columns" ? columnsOfRows : rowsOfColumns;
  return [
    { name: label, forcedSplit: false, build: (a) => build(groups, a) },
    ...SPLITS.map((p) => ({
      name: `${label} @${Math.round(p * 100)}`,
      forcedSplit: true,
      build: (a: number[]) => build(groups, a, [p, 1 - p]),
    })),
  ];
}

function templatesFor(n: number): ITemplate[] {
  const each = Array.from({ length: n }, (_, i) => [i]);
  const base: ITemplate[] = [
    {
      name: `${n} columns`,
      forcedSplit: false,
      build: (a) => columnsOfRows(each, a),
    },
    {
      name: `${n} rows`,
      forcedSplit: false,
      build: (a) => rowsOfColumns(each, a),
    },
  ];
  if (n < 3) return base;

  const tail = Array.from({ length: n - 1 }, (_, i) => i + 1);
  const head = Array.from({ length: n - 1 }, (_, i) => i);
  const out = [
    ...base,
    ...twoGroup("big left | stack", [[0], tail], "columns"),
    ...twoGroup("stack | big right", [head, [n - 1]], "columns"),
    ...twoGroup("big top / row", [[0], tail], "rows"),
    ...twoGroup("row / big bottom", [head, [n - 1]], "rows"),
  ];
  if (n === 4) {
    out.push(
      ...twoGroup(
        "2×2",
        [
          [0, 1],
          [2, 3],
        ],
        "rows"
      )
    );
    out.push(
      ...twoGroup(
        "2 columns of 2",
        [
          [0, 1],
          [2, 3],
        ],
        "columns"
      )
    );
  }
  return out;
}

function permutations(n: number): number[][] {
  const out: number[][] = [];
  const used = new Array(n).fill(false);
  const acc: number[] = [];
  const walk = () => {
    if (acc.length === n) {
      out.push([...acc]);
      return;
    }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      used[i] = true;
      acc.push(i);
      walk();
      acc.pop();
      used[i] = false;
    }
  };
  walk();
  return out;
}

/**
 * Cover-fit crop: a clip of aspect `clip` in a cell of aspect `cell` shows
 * min(clip/cell, cell/clip) of its source area.
 *
 * This doubles as the *contain*-fit gap — containing leaves exactly the
 * fraction of the cell empty that covering would have shaved off the source —
 * so fit and blur modes optimise the identical number; crop simply becomes
 * matte. That is why the solver needs no per-mode cost function.
 */
export function cropFraction(clip: number, cell: number) {
  return 1 - Math.min(clip / cell, cell / clip);
}

/**
 * Solve the wall.
 *
 * @param aspectRatios one per clip, in display order
 * @param containerAspect width / height of the wall (only the ratio matters)
 */
export function solveWallLayout(
  aspectRatios: number[],
  containerAspect: number,
  mode: WallFitMode
): IWallLayout | null {
  const n = aspectRatios.length;
  if (n === 0 || !(containerAspect > 0)) return null;

  // blur keeps fill's geometry: the container is covered either way
  const shrinkWrap = mode === "fit";
  const perms = permutations(n);

  let best: IWallLayout | null = null;

  for (const template of templatesFor(n)) {
    if (shrinkWrap && template.forcedSplit) continue;

    // perm[slot] = clip index
    for (const perm of perms) {
      const slotAspects = perm.map((clip) => aspectRatios[clip]);
      const rects = template.build(slotAspects);

      let largestArea = 0;
      for (const r of rects) {
        largestArea = Math.max(largestArea, r.w * r.h);
      }
      const balance = BALANCE_WEIGHT * Math.max(0, largestArea - BALANCE_CAP);

      const placement: IWallRect[] = new Array(n);
      const crop: number[] = new Array(n);

      if (shrinkWrap) {
        // the aspect at which this arrangement crops nothing at all
        const collageAspect = (slotAspects[0] * rects[0].h) / rects[0].w;
        const cover = Math.min(
          collageAspect / containerAspect,
          containerAspect / collageAspect
        );
        const letterbox = 1 - cover;
        const score = letterbox + balance;
        if (best && score >= best.score) continue;

        const sw =
          collageAspect > containerAspect ? 1 : collageAspect / containerAspect;
        const sh =
          collageAspect > containerAspect ? containerAspect / collageAspect : 1;
        const ox = (1 - sw) / 2;
        const oy = (1 - sh) / 2;
        for (let slot = 0; slot < n; slot++) {
          const r = rects[slot];
          placement[perm[slot]] = {
            x: ox + r.x * sw,
            y: oy + r.y * sh,
            w: r.w * sw,
            h: r.h * sh,
          };
          crop[perm[slot]] = 0;
        }
        best = {
          template: template.name,
          placement,
          crop,
          worstCrop: 0,
          totalCrop: 0,
          letterbox,
          largestArea,
          score,
        };
        continue;
      }

      let weighted = 0;
      let area = 0;
      let worstCrop = 0;
      for (let slot = 0; slot < n; slot++) {
        const r = rects[slot];
        const cellArea = r.w * r.h;
        const c = cropFraction(
          slotAspects[slot],
          (r.w * containerAspect) / r.h
        );
        weighted += cellArea * c;
        area += cellArea;
        worstCrop = Math.max(worstCrop, c);
        crop[perm[slot]] = c;
        placement[perm[slot]] = r;
      }
      const totalCrop = area > 0 ? weighted / area : 0;
      const score = worstCrop + balance + TOTAL_CROP_WEIGHT * totalCrop;
      if (best && score >= best.score) continue;

      best = {
        template: template.name,
        placement,
        crop,
        worstCrop,
        totalCrop,
        letterbox: 0,
        largestArea,
        score,
      };
    }
  }

  return best;
}
