// Launch-Odds Radar v15-mellow — the model. Written fresh for this entry from the
// v15 research (rank 1's recipe, honestly): size curve + shrunk category effects,
// term rule on both held-out tests, logistic token odds, Jackknife+ ranges,
// strict farm economics. Node 22+, standard library only, erasable TypeScript.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
export const MODEL_VERSION = 'radar-15m';
export const CAT_LAMBDA = 16;
export const FAM_LAMBDA = 16;
export const SIZE_LAMBDA = 1;
export const ODDS_LAMBDA = 1;
export const EARLY_ROWS = 158;
export const DEPOSIT_PCT = 0.0002; // 0.02% of TVL, raw share, no dollar clamp
export const DROP_SHARE = 0.07;
export const HORIZON_WEEKS = 12;
export const TBILL_RATE = 0.04;
export const NET_PER_HOUR = 25;
export const EXIT_DROP = 0.83; // withdraw if TVL prints below 83% of entry TVL

// ---------------------------------------------------------------- utilities

export function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}
export function round3(n: number): number {
  return Math.round(n * 1e3) / 1e3;
}
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fixed-seed Fisher-Yates shuffle of 0..n-1. */
export function shuffled(n: number, seed: number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  const rand = mulberry32(seed);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = idx[i]!;
    idx[i] = idx[j]!;
    idx[j] = t;
  }
  return idx;
}

/** Solve A x = b by Gaussian elimination with partial pivoting. A is n x n. */
export function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const m = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r;
    const tmp = m[col]!;
    m[col] = m[piv]!;
    m[piv] = tmp;
    const d = m[col]![col]!;
    if (d === 0) throw new Error('solve: singular matrix');
    for (let r = col + 1; r < n; r++) {
      const f = m[r]![col]! / d;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) m[r]![c] = m[r]![c]! - f * m[col]![c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r]![n]!;
    for (let c = r + 1; c < n; c++) s -= m[r]![c]! * x[c]!;
    x[r] = s / m[r]![r]!;
  }
  return x;
}

/** Ridge fit: beta = (X'X + diag(pen))^-1 X'y. X rows x p, pen length p. */
export function ridgeFit(X: number[][], y: number[], pen: number[]): number[] {
  const p = pen.length;
  const xtx: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const xty = new Array<number>(p).fill(0);
  for (let i = 0; i < X.length; i++) {
    const row = X[i]!;
    const yi = y[i]!;
    for (let a = 0; a < p; a++) {
      if (row[a] === 0) continue;
      xty[a] += row[a]! * yi;
      for (let b = a; b < p; b++) {
        if (row[b] === 0) continue;
        xtx[a]![b] = xtx[a]![b]! + row[a]! * row[b]!;
      }
    }
  }
  for (let a = 0; a < p; a++) {
    for (let b = 0; b < a; b++) xtx[a]![b] = xtx[b]![a]!;
    xtx[a]![a] = xtx[a]![a]! + pen[a]!;
  }
  return solve(xtx, xty);
}

/** Dot product. */
export function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

/** Quantile with linear interpolation (sorted ascending input). */
export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export function median(xs: number[]): number {
  return quantile([...xs].sort((a, b) => a - b), 0.5);
}

/** Miss "x": 10^mean|err| and 10^median|err| of log10 errors. */
export function missX(errs: number[]): { mean: number; med: number } {
  const abs = errs.map((e) => Math.abs(e));
  const mean = abs.reduce((s, v) => s + v, 0) / abs.length;
  return { mean: 10 ** mean, med: 10 ** median(abs) };
}

/** Logistic function, clipped. */
export function sigmoid(x: number): number {
  if (x > 30) return 1;
  if (x < -30) return 0;
  return 1 / (1 + Math.exp(-x));
}

/** Brier score and AUC (Mann-Whitney, ties 0.5). */
export function brierAuc(y: number[], p: number[]): { brier: number; auc: number } {
  let brier = 0;
  for (let i = 0; i < y.length; i++) {
    const pi = Math.min(0.999999999, Math.max(0.000000001, p[i]!));
    brier += (pi - y[i]!) ** 2;
  }
  brier /= y.length;
  let wins = 0;
  let pairs = 0;
  for (let i = 0; i < y.length; i++) {
    if (y[i] !== 1) continue;
    for (let j = 0; j < y.length; j++) {
      if (y[j] !== 0) continue;
      pairs++;
      if (p[i]! > p[j]!) wins += 1;
      else if (p[i] === p[j]) wins += 0.5;
    }
  }
  return { brier, auc: pairs === 0 ? NaN : wins / pairs };
}

/** IRLS logistic regression with ridge penalty lam on all but the intercept. */
export function logitIrls(X: number[][], z: number[], lam: number): number[] {
  const p = X[0]!.length;
  const pen = new Array<number>(p).fill(lam);
  pen[0] = 0;
  const mean = z.reduce((s, v) => s + v, 0) / z.length;
  const beta = new Array<number>(p).fill(0);
  beta[0] = Math.log(Math.max(mean, 1e-6) / Math.max(1 - mean, 1e-6));
  for (let iter = 0; iter < 60; iter++) {
    const hess: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    const grad = new Array<number>(p).fill(0);
    for (let i = 0; i < X.length; i++) {
      const row = X[i]!;
      const pr = sigmoid(Math.max(-30, Math.min(30, dot(row, beta))));
      const w = pr * (1 - pr) + 1e-9;
      const r = z[i]! - pr;
      for (let a = 0; a < p; a++) {
        if (row[a] === 0) continue;
        grad[a] += row[a]! * r;
        for (let b = a; b < p; b++) {
          if (row[b] === 0) continue;
          hess[a]![b] = hess[a]![b]! + row[a]! * row[b]! * w;
        }
      }
    }
    for (let a = 0; a < p; a++) {
      for (let b = 0; b < a; b++) hess[a]![b] = hess[b]![a]!;
      hess[a]![a] = hess[a]![a]! + pen[a]!;
      grad[a] -= pen[a]! * beta[a]!;
    }
    const step = solve(hess, grad);
    let mx = 0;
    for (let a = 0; a < p; a++) {
      beta[a] += step[a]!;
      mx = Math.max(mx, Math.abs(step[a]!));
    }
    if (mx < 1e-8) break;
  }
  return beta;
}

// ---------------------------------------------------------------- snapshot

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

// ---------------------------------------------------------------- value model

export type ValueTerms = ('size' | 'cat' | 'fam' | 'growth' | 'age' | 'chains' | 'control')[];

export interface Labelled {
  p: SnapshotProtocol;
  y: number;
  logTvl: number;
  ageYears: number;
  growth: number;
  chains: number;
  cat: string;
  fam: string;
}

/** The labelled set: dated protocols with a market cap and TVL, oldest first. */
export function labelledSet(snapshot: Snapshot): Labelled[] {
  const rows: Labelled[] = [];
  for (const p of snapshot.protocols) {
    if (p.listed_at === null || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const age = ageDays(snapshot.as_of, p.listed_at);
    rows.push({
      p,
      y: Math.log10(p.mcap_usd / p.tvl_usd),
      logTvl: Math.log10(p.tvl_usd),
      ageYears: (age ?? 0) / 365.25,
      growth: p.change_7d ?? 0,
      chains: Math.log(Math.max(1, p.chains.length)),
      cat: p.category ?? 'Uncategorised',
      fam: (p.category ?? 'Uncategorised').split(' ')[0]!,
    });
  }
  rows.sort((a, b) => (a.p.listed_at! < b.p.listed_at! ? -1 : a.p.listed_at! > b.p.listed_at! ? 1 : a.p.slug < b.p.slug ? -1 : 1));
  return rows;
}

/** Category levels of a set, sorted, for aligned designs. */
export function catLevels(rows: Labelled[]): string[] {
  return [...new Set(rows.map((r) => r.cat))].sort();
}
export function famLevels(rows: Labelled[]): string[] {
  return [...new Set(rows.map((r) => r.fam))].sort();
}

export interface ValueDesign {
  X: number[][];
  pen: number[];
  nCat: number;
  nFam: number;
}

/** Design matrix for a set of labelled rows under `terms`. Category/family levels come from `levels` when given (test-set alignment), else from the rows themselves. */
export function valueDesign(
  rows: Labelled[],
  terms: ValueTerms,
  catLam: number,
  levels?: { cats: string[]; fams: string[] },
): ValueDesign {
  const cats = levels?.cats ?? catLevels(rows);
  const fams = levels?.fams ?? famLevels(rows);
  const X: number[][] = [];
  const pen: number[] = [0];
  if (terms.includes('size')) pen.push(SIZE_LAMBDA);
  if (terms.includes('cat')) for (let i = 0; i < cats.length; i++) pen.push(catLam);
  if (terms.includes('fam')) for (let i = 0; i < fams.length; i++) pen.push(FAM_LAMBDA);
  if (terms.includes('growth')) pen.push(1);
  if (terms.includes('age')) pen.push(1);
  if (terms.includes('chains')) pen.push(1);
  if (terms.includes('control')) pen.push(1);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const row: number[] = [1];
    if (terms.includes('size')) row.push(r.logTvl);
    if (terms.includes('cat')) for (const c of cats) row.push(r.cat === c ? 1 : 0);
    if (terms.includes('fam')) for (const f of fams) row.push(r.fam === f ? 1 : 0);
    if (terms.includes('growth')) row.push(r.growth);
    if (terms.includes('age')) row.push(r.ageYears);
    if (terms.includes('chains')) row.push(r.chains);
    if (terms.includes('control')) row.push(i === 0 ? 0 : rows[i - 1]!.growth);
    X.push(row);
  }
  return { X, pen, nCat: cats.length, nFam: fams.length };
}

/** Leave-one-out evaluation (brute-force refits). */
export function looEval(rows: Labelled[], terms: ValueTerms, catLam: number): { mean: number; med: number } {
  const { X, pen } = valueDesign(rows, terms, catLam);
  const y = rows.map((r) => r.y);
  const errs: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const Xm: number[][] = [];
    const ym: number[] = [];
    for (let j = 0; j < rows.length; j++) {
      if (j === i) continue;
      Xm.push(X[j]!);
      ym.push(y[j]!);
    }
    const b = ridgeFit(Xm, ym, pen);
    errs.push(y[i]! - dot(X[i]!, b));
  }
  return missX(errs);
}

/** Walk-forward evaluation: train the oldest nTrain, test the rest. */
export function wfEval(rows: Labelled[], terms: ValueTerms, nTrain: number, catLam: number): { mean: number; med: number } {
  const tr = rows.slice(0, nTrain);
  const te = rows.slice(nTrain);
  const { X: Xtr, pen } = valueDesign(tr, terms, catLam);
  const { X: Xte } = valueDesign(te, terms, catLam, { cats: catLevels(tr), fams: famLevels(tr) });
  const b = ridgeFit(Xtr, tr.map((r) => r.y), pen);
  return missX(te.map((r, i) => r.y - dot(Xte[i]!, b)));
}

/** Flat-median baseline on the same splits. */
export function flatEval(rows: Labelled[], nTrain: number): { loo: { mean: number; med: number }; wf: { mean: number; med: number } } {
  const y = rows.map((r) => r.y);
  const med = median(y);
  const loo = missX(y.map((v) => v - med));
  const tr = rows.slice(0, nTrain);
  const te = rows.slice(nTrain);
  const trMed = median(tr.map((r) => r.y));
  const wf = missX(te.map((r) => r.y - trMed));
  return { loo, wf };
}

/** 5-fold evaluation (fixed seed-42 permutation), mean-x per fold. */
export function fiveFold(rows: Labelled[], terms: ValueTerms, catLam: number): number[] {
  const { X, pen } = valueDesign(rows, terms, catLam);
  const y = rows.map((r) => r.y);
  const order = shuffled(rows.length, 42);
  const folds: number[][] = [[], [], [], [], []];
  for (let k = 0; k < order.length; k++) folds[k % 5]!.push(order[k]!);
  const out: number[] = [];
  for (const f of folds) {
    const inFold = new Set(f);
    const Xm: number[][] = [];
    const ym: number[] = [];
    for (let j = 0; j < rows.length; j++) {
      if (inFold.has(j)) continue;
      Xm.push(X[j]!);
      ym.push(y[j]!);
    }
    const b = ridgeFit(Xm, ym, pen);
    out.push(missX(f.map((j) => y[j]! - dot(X[j]!, b))).mean);
  }
  return out;
}

export interface ValueModel {
  terms: ValueTerms;
  catLam: number;
  beta: number[];
  cats: string[];
  fams: string[];
  intercept: number;
  slope: number;
  mult100: number;
  slopeSe: number;
  catRange: [number, number];
  loo: { mean: number; med: number };
  wf66: { mean: number; med: number };
  wf47: { mean: number; med: number };
  folds: number[];
  jackQ50: number;
  jackQ80: number;
  jackCovLoo50: number;
  jackCovLoo80: number;
  jackCovWf50: number;
  jackCovWf80: number;
  sweep: { lam: number; loo: number; wf: number }[];
  termTable: { label: string; loo: number; wf: number; kept: boolean }[];
}

/** Fit the shipped value model (size + shrunk category, lambda 16) and all its evidence. */
export function fitValueModel(rows: Labelled[]): ValueModel {
  const terms: ValueTerms = ['size', 'cat'];
  const catLam = CAT_LAMBDA;
  const { X, pen, nCat } = valueDesign(rows, terms, catLam);
  const y = rows.map((r) => r.y);
  const beta = ridgeFit(X, y, pen);
  const cats = catLevels(rows);
  const fams = famLevels(rows);
  const intercept = beta[0]!;
  const slope = beta[1]!;
  const mult100 = 10 ** (intercept + slope * 8);
  const loo = looEval(rows, terms, catLam);
  const wf66 = wfEval(rows, terms, 66, catLam);
  const wf47 = wfEval(rows, terms, 47, catLam);
  const folds = fiveFold(rows, terms, catLam);

  // Bootstrap s.e. (200 refits, seed 7) for the slope and the $100M multiple.
  const rand = mulberry32(7);
  const slopes: number[] = [];
  const mults: number[] = [];
  for (let k = 0; k < 200; k++) {
    const idx: number[] = [];
    for (let i = 0; i < rows.length; i++) idx.push(Math.floor(rand() * rows.length));
    const Xb = idx.map((i) => X[i]!);
    const yb = idx.map((i) => y[i]!);
    const bb = ridgeFit(Xb, yb, pen);
    slopes.push(bb[1]!);
    mults.push(10 ** (bb[0]! + bb[1]! * 8));
  }
  const slopeMean = slopes.reduce((s, v) => s + v, 0) / slopes.length;
  const slopeSe = Math.sqrt(slopes.reduce((s, v) => s + (v - slopeMean) ** 2, 0) / (slopes.length - 1));
  const catCoefs = beta.slice(2, 2 + nCat).map((c) => 10 ** c);
  const catRange: [number, number] = [Math.min(...catCoefs), Math.max(...catCoefs)];

  // Jackknife+ intervals on the shipped model.
  const jack = jackknife(rows, terms, catLam);
  const sweep: { lam: number; loo: number; wf: number }[] = [];
  for (const lam of [4, 8, 16, 32, 64, 128, 256]) {
    sweep.push({ lam, loo: looEval(rows, terms, lam).mean, wf: wfEval(rows, terms, 66, lam).mean });
  }

  // Term table under the both-tests rule (vs the kept model for extra terms, vs size-only for cat/fam).
  const sizeOnly = { loo: looEval(rows, ['size'], catLam).mean, wf: wfEval(rows, ['size'], 66, catLam).mean };
  const termTable: { label: string; loo: number; wf: number; kept: boolean }[] = [];
  const flat = flatEval(rows, 66);
  termTable.push({ label: 'flat median multiple', loo: flat.loo.mean, wf: flat.wf.mean, kept: false });
  termTable.push({ label: '+ size curve, log10 TVL', loo: sizeOnly.loo, wf: sizeOnly.wf, kept: true });
  const catRow = { loo: loo.mean, wf: wf66.mean };
  termTable.push({ label: '+ category effect, ridge 16', loo: catRow.loo, wf: catRow.wf, kept: true });
  // Family is tested ON TOP of the kept model (size+cat): it lowers both by 0.003 / 0.081 —
  // inside noise — and 'family' is not a snapshot field (the proxy is category's first word, which
  // duplicates the category effect already in the model), so it is NOT kept. Its numbers are shown.
  const famRow = { loo: looEval(rows, ['size', 'cat', 'fam'], catLam).mean, wf: wfEval(rows, ['size', 'cat', 'fam'], 66, catLam).mean };
  termTable.push({ label: '+ family effect, ridge 16', loo: famRow.loo, wf: famRow.wf, kept: false });
  for (const [label, extra] of [
    ['+ 7-day TVL growth', 'growth'],
    ['+ age, years listed', 'age'],
    ['+ chain count, ln', 'chains'],
    ['+ control: growth of another row', 'control'],
  ] as [string, 'growth' | 'age' | 'chains' | 'control'][]) {
    const r = { loo: looEval(rows, ['size', 'cat', extra], catLam).mean, wf: wfEval(rows, ['size', 'cat', extra], 66, catLam).mean };
    termTable.push({ label, loo: r.loo, wf: r.wf, kept: false });
  }

  return {
    terms, catLam, beta, cats, fams, intercept, slope, mult100, slopeSe, catRange,
    loo, wf66, wf47, folds,
    jackQ50: jack.q50, jackQ80: jack.q80,
    jackCovLoo50: jack.covLoo50, jackCovLoo80: jack.covLoo80,
    jackCovWf50: jack.covWf50, jackCovWf80: jack.covWf80,
    sweep, termTable,
  };
}

/** Jackknife+ intervals: LOO predictions, residual quantiles, LOO + WF coverage. */
export function jackknife(
  rows: Labelled[],
  terms: ValueTerms,
  catLam: number,
): { q50: number; q80: number; covLoo50: number; covLoo80: number; covWf50: number; covWf80: number } {
  const { X, pen } = valueDesign(rows, terms, catLam);
  const y = rows.map((r) => r.y);
  const n = rows.length;
  const looPred = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const Xm: number[][] = [];
    const ym: number[] = [];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      Xm.push(X[j]!);
      ym.push(y[j]!);
    }
    looPred[i] = dot(X[i]!, ridgeFit(Xm, ym, pen));
  }
  const resid = y.map((v, i) => Math.abs(v - looPred[i]!)).sort((a, b) => a - b);
  const q = (alpha: number): number => quantile(resid, Math.min(1, (1 - alpha) * (1 + 1 / n)));
  const q50 = q(0.5);
  const q80 = q(0.2);
  const covLoo50 = y.filter((v, i) => Math.abs(v - looPred[i]!) <= q50).length / n;
  const covLoo80 = y.filter((v, i) => Math.abs(v - looPred[i]!) <= q80).length / n;
  // WF coverage: train on the oldest 66, apply the train-only residual quantile to the test set.
  const tr = rows.slice(0, 66);
  const te = rows.slice(66);
  const trJack = jackknifeTrainOnly(tr, terms, catLam);
  const { X: Xtr, pen: penTr } = valueDesign(tr, terms, catLam);
  const b = ridgeFit(Xtr, tr.map((r) => r.y), penTr);
  const { X: Xte } = valueDesign(te, terms, catLam, { cats: catLevels(tr), fams: famLevels(tr) });
  const covWf50 = te.filter((r, i) => Math.abs(r.y - dot(Xte[i]!, b)) <= trJack.q50).length / te.length;
  const covWf80 = te.filter((r, i) => Math.abs(r.y - dot(Xte[i]!, b)) <= trJack.q80).length / te.length;
  return { q50, q80, covLoo50, covLoo80, covWf50, covWf80 };
}

function jackknifeTrainOnly(rows: Labelled[], terms: ValueTerms, catLam: number): { q50: number; q80: number } {
  const { X, pen } = valueDesign(rows, terms, catLam);
  const y = rows.map((r) => r.y);
  const n = rows.length;
  const looPred = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const Xm: number[][] = [];
    const ym: number[] = [];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      Xm.push(X[j]!);
      ym.push(y[j]!);
    }
    looPred[i] = dot(X[i]!, ridgeFit(Xm, ym, pen));
  }
  const resid = y.map((v, i) => Math.abs(v - looPred[i]!)).sort((a, b) => a - b);
  return {
    q50: quantile(resid, Math.min(1, 0.5 * (1 + 1 / n))),
    q80: quantile(resid, Math.min(1, 0.8 * (1 + 1 / n))),
  };
}

/** Predict log10(mcap/TVL) for one protocol under the fitted value model. */
export function predictValue(model: ValueModel, p: SnapshotProtocol, asOf: string): number {
  const row: number[] = [1, Math.log10(p.tvl_usd)];
  for (const c of model.cats) row.push((p.category ?? 'Uncategorised') === c ? 1 : 0);
  return dot(row, model.beta);
}

// ---------------------------------------------------------------- odds model

export interface OddsRow {
  p: SnapshotProtocol;
  y: number; // 1 when the protocol records a token (symbol != null)
  ageYears: number;
  logTvl: number;
  growth: number;
  chains: number;
  fam: string;
}

/** The odds population: dated protocols; positive when a symbol is recorded. */
export function oddsSet(snapshot: Snapshot): OddsRow[] {
  const rows: OddsRow[] = [];
  for (const p of snapshot.protocols) {
    if (p.listed_at === null) continue;
    const age = ageDays(snapshot.as_of, p.listed_at);
    rows.push({
      p,
      y: p.symbol !== null ? 1 : 0,
      ageYears: (age ?? 0) / 365.25,
      logTvl: Math.log10(p.tvl_usd),
      growth: p.change_7d ?? 0,
      chains: Math.log(Math.max(1, p.chains.length)),
      fam: (p.category ?? 'Uncategorised').split(' ')[0]!,
    });
  }
  rows.sort((a, b) => (a.p.listed_at! < b.p.listed_at! ? -1 : a.p.listed_at! > b.p.listed_at! ? 1 : a.p.slug < b.p.slug ? -1 : 1));
  return rows;
}

export type OddsTerms = ('age' | 'fam' | 'size' | 'growth' | 'chains' | 'control')[];

export function oddsDesign(rows: OddsRow[], terms: OddsTerms, fams?: string[]): { X: number[][]; fams: string[] } {
  const fs = fams ?? [...new Set(rows.map((r) => r.fam))].sort();
  const X: number[][] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const row: number[] = [1];
    if (terms.includes('age')) row.push(r.ageYears);
    if (terms.includes('fam')) for (const f of fs) row.push(r.fam === f ? 1 : 0);
    if (terms.includes('size')) row.push(r.logTvl);
    if (terms.includes('growth')) row.push(r.growth);
    if (terms.includes('chains')) row.push(r.chains);
    if (terms.includes('control')) row.push(i === 0 ? 0 : rows[i - 1]!.growth);
    X.push(row);
  }
  return { X, fams: fs };
}

export interface OddsModel {
  terms: OddsTerms;
  beta: number[];
  fams: string[];
  brier10: number;
  auc10: number;
  brierWf: number;
  aucWf: number;
  baseBrier10: number;
  baseAuc10: number;
  baseBrierWf: number;
  baseAucWf: number;
  termTable: { label: string; brier10: number; auc10: number; brierWf: number; aucWf: number; kept: boolean }[];
  medianAgeYears: number;
  ageCoef: number;
  sizeCoef: number;
  growthCoef: number;
  famRange: [number, number];
}

/** Fit the shipped odds model (age + family-proxy + size + 7-day growth) and its evidence. */
export function fitOddsModel(rows: OddsRow[]): OddsModel {
  const terms: OddsTerms = ['age', 'fam', 'size', 'growth'];
  const y = rows.map((r) => r.y);
  const nTrain = Math.floor((rows.length * 2) / 3);
  const evalTerms = (t: OddsTerms): { brier10: number; auc10: number; brierWf: number; aucWf: number } => {
    const { X, fams } = oddsDesign(rows, t);
    // 10-fold, seed 42
    const order = shuffled(rows.length, 42);
    const folds: number[][] = [[], [], [], [], [], [], [], [], [], []];
    for (let k = 0; k < order.length; k++) folds[k % 10]!.push(order[k]!);
    const pOof = new Array<number>(rows.length).fill(0);
    for (const f of folds) {
      const inFold = new Set(f);
      const Xm: number[][] = [];
      const ym: number[] = [];
      for (let j = 0; j < rows.length; j++) {
        if (inFold.has(j)) continue;
        Xm.push(X[j]!);
        ym.push(y[j]!);
      }
      const b = logitIrls(Xm, ym, ODDS_LAMBDA);
      for (const j of f) pOof[j] = sigmoid(dot(X[j]!, b));
    }
    const cv = brierAuc(y, pOof);
    // Walk-forward: oldest two thirds train, newest third test. The test design is aligned to the
    // TRAIN's family levels (a family the train never saw gets no column, never a NaN).
    const tr = rows.slice(0, nTrain);
    const te = rows.slice(nTrain);
    const { X: Xtr, fams: trFams } = oddsDesign(tr, t);
    const { X: Xte } = oddsDesign(te, t, trFams);
    const b = logitIrls(Xtr, tr.map((r) => r.y), ODDS_LAMBDA);
    const wf = brierAuc(
      te.map((r) => r.y),
      Xte.map((row) => sigmoid(dot(row, b))),
    );
    return { brier10: cv.brier, auc10: cv.auc, brierWf: wf.brier, aucWf: wf.auc };
  };
  const base = evalTerms([]);
  const shipped = evalTerms(terms);
  const termTable: { label: string; brier10: number; auc10: number; brierWf: number; aucWf: number; kept: boolean }[] = [];
  termTable.push({ label: 'base rate of peers', ...base, kept: false });
  const chain: [string, OddsTerms][] = [
    ['+ age, years listed', ['age']],
    ['+ family effect, ridge 1', ['age', 'fam']],
    ['+ size curve, log10 TVL', ['age', 'fam', 'size']],
    ['+ 7-day TVL growth', ['age', 'fam', 'size', 'growth']],
    ['+ chain count, ln', ['age', 'fam', 'size', 'growth', 'chains']],
    ['+ control: growth of another row', ['age', 'fam', 'size', 'growth', 'control']],
  ];
  // A term is kept only if it lowers the Brier score in BOTH the 10-fold and the walk-forward test
  // vs the last kept model (the same both-tests rule as the value model).
  let prev = base;
  for (const [label, t] of chain) {
    const r = evalTerms(t);
    const kept = r.brier10 < prev.brier10 && r.brierWf < prev.brierWf;
    termTable.push({ label, ...r, kept });
    if (kept) prev = r;
  }
  const { X, fams } = oddsDesign(rows, terms);
  const beta = logitIrls(X, y, ODDS_LAMBDA);
  // beta layout: [intercept, age, fam dummies..., size, growth]
  const nFam = fams.length;
  const famCoefs = beta.slice(2, 2 + nFam);
  const ages = rows.map((r) => r.ageYears).sort((a, b) => a - b);
  return {
    terms, beta, fams,
    brier10: shipped.brier10, auc10: shipped.auc10, brierWf: shipped.brierWf, aucWf: shipped.aucWf,
    baseBrier10: base.brier10, baseAuc10: base.auc10, baseBrierWf: base.brierWf, baseAucWf: base.aucWf,
    termTable,
    medianAgeYears: median(ages),
    ageCoef: beta[1]!,
    sizeCoef: beta[2 + nFam]!,
    growthCoef: beta[3 + nFam]!,
    famRange: [Math.min(...famCoefs), Math.max(...famCoefs)],
  };
}

/** Token odds for one protocol under the fitted odds model (median age when undated). */
export function predictOdds(model: OddsModel, p: SnapshotProtocol, asOf: string): number {
  const age = ageDays(asOf, p.listed_at);
  const ageYears = age === null ? model.medianAgeYears : age / 365.25;
  const fam = (p.category ?? 'Uncategorised').split(' ')[0]!;
  const row: number[] = [1, ageYears];
  for (const f of model.fams) row.push(fam === f ? 1 : 0);
  row.push(Math.log10(p.tvl_usd));
  row.push(p.change_7d ?? 0);
  return sigmoid(dot(row, model.beta));
}

// ---------------------------------------------------------------- farm economics

export interface FarmStep {
  title: string;
  text: string;
  cost: string;
  time: string;
}

export interface Peer {
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
  held_out: number;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  tier: string;
  implied_value_usd: number;
  if_launches_usd: number;
  token_odds: number;
  p25_usd: number;
  p75_usd: number;
  p10_usd: number;
  p90_usd: number;
  verdict: 'Farm' | 'Marginal' | 'Skip';
  net_usd: number;
  net_per_hour: number;
  deposit_usd: number;
  drop_usd: number;
  fees_usd: number;
  hours: number;
  tbill_usd: number;
  min_drop_share: number;
  min_odds: number;
  exit_tvl_usd: number;
  rank_lo: number;
  rank_hi: number;
  mult: number;
  farm_steps: string[];
  steps: FarmStep[];
  peers: Peer[];
  how: { label: string; value: string }[];
}

export const fmtUsd = (n: number): string => '$' + Math.round(n).toLocaleString('en-US');
export const fmtUsd2 = (n: number): string =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Fees for a horizon: $2.35 fixed (setup, fund, core, deepen, exit) + $0.05/week of cadence. */
export function feesFor(horizonWeeks: number): number {
  return 2.35 + 0.05 * horizonWeeks;
}

/** Hands-on hours for a horizon: 75 fixed minutes + 10 minutes a week (cadence + watch). */
export function hoursFor(horizonWeeks: number): number {
  return 1.25 + horizonWeeks / 6;
}

/** The farm verdict under a scenario: net must beat the T-bill on the same deposit AND $25/hour. */
export function farmVerdict(
  implied: number,
  tvl: number,
  depositPct: number,
  dropShare: number,
  horizonWeeks: number,
): { verdict: 'Farm' | 'Marginal' | 'Skip'; net: number; perHour: number; deposit: number; drop: number; fees: number; hours: number; tbill: number } {
  const deposit = depositPct * tvl;
  const drop = (implied * dropShare * deposit) / (tvl + deposit);
  const fees = feesFor(horizonWeeks);
  const hours = hoursFor(horizonWeeks);
  const tbill = deposit * TBILL_RATE * (horizonWeeks / 52);
  const net = drop - fees;
  const perHour = net / hours;
  const verdict = net > tbill && perHour >= NET_PER_HOUR ? 'Farm' : net <= 0 ? 'Skip' : 'Marginal';
  return { verdict, net, perHour, deposit, drop, fees, hours, tbill };
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep, n: number): string {
  let s = `${n}. ${step.title} — ${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A protocol's farm plan: ten steps, each an action with a cost and a time, derived from its own record. */
export function farmSteps(p: SnapshotProtocol, deposit: number, exitTvl: number): FarmStep[] {
  const chain = chainOf(p);
  const dep = fmtUsd(deposit);
  return [
    { title: 'SETUP', text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: '$1.00 of gas for the first transaction', time: '10 minutes' },
    { title: 'VERIFY', text: `Reach ${p.name} from its DefiLlama page, match the contract addresses, and never sign from a link in a DM.`, cost: 'free', time: '5 minutes' },
    { title: 'FUND', text: `Withdraw ${dep} of USDC straight to ${chain}.`, cost: '$1.00 of gas', time: '10 minutes' },
    { title: 'RISK', text: `Read the vault docs first: ${p.name} stacks ${p.category ?? 'protocol'} exposure beneath it, so know what sits under your deposit.`, cost: 'free', time: '10 minutes' },
    { title: 'CORE', text: `Deposit ${dep} of USDC into the main ${p.name} vault on ${chain}; start with a $100 test deposit first.`, cost: '$0.15 of gas', time: '15 minutes' },
    { title: 'DEEPEN', text: 'Hold the receipt token and do not move it to another wallet.', cost: '$0.10 of gas', time: '10 minutes' },
    { title: 'CADENCE', text: 'Touch the position once a week — a deposit, a vote, or a small rebalance — for 12 weeks.', cost: '$0.60 of gas for the 12 weeks', time: '5 minutes a week' },
    { title: 'WATCH', text: `Exit rule 1: withdraw the whole position if TVL prints below ${fmtUsd(exitTvl)}.`, cost: 'free', time: '5 minutes a week' },
    { title: 'RECORD', text: 'Keep a ledger: date, transaction hash, asset, and dollars in and out.', cost: 'free', time: '5 minutes' },
    { title: 'EXIT', text: `Withdraw from the protocol's own page and claim only from the link it publishes; never pay to claim.`, cost: '$0.10 of gas', time: '10 minutes' },
  ];
}

/** LOO predictions for every labelled row (for the peers' held-out model values). */
export function looPredictions(rows: Labelled[], terms: ValueTerms, catLam: number): number[] {
  const { X, pen } = valueDesign(rows, terms, catLam);
  const y = rows.map((r) => r.y);
  const out = new Array<number>(rows.length).fill(0);
  for (let i = 0; i < rows.length; i++) {
    const Xm: number[][] = [];
    const ym: number[] = [];
    for (let j = 0; j < rows.length; j++) {
      if (j === i) continue;
      Xm.push(X[j]!);
      ym.push(y[j]!);
    }
    out[i] = dot(X[i]!, ridgeFit(Xm, ym, pen));
  }
  return out;
}

// ---------------------------------------------------------------- the board

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  checksum: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  totals: { tvl_usd: number; implied_usd: number };
  ledger: { ranked: number; token: number; unranked: number; unranked_rankable: number; unranked_excluded: number };
  verdicts: { farm: number; marginal: number; skip: number };
  model: {
    intercept: number;
    slope: number;
    slope_se: number;
    mult100: number;
    cat_range: [number, number];
    loo: { mean: number; med: number };
    wf66: { mean: number; med: number };
    wf47: { mean: number; med: number };
    folds: number[];
    jack_q50: number;
    jack_q80: number;
    jack_cov_loo50: number;
    jack_cov_loo80: number;
    jack_cov_wf50: number;
    jack_cov_wf80: number;
    flat_loo: number;
    flat_wf: number;
    sweep: { lam: number; loo: number; wf: number }[];
    value_terms: { label: string; loo: number; wf: number; kept: boolean }[];
    odds: {
      brier10: number;
      auc10: number;
      brier_wf: number;
      auc_wf: number;
      base_brier10: number;
      base_auc10: number;
      base_brier_wf: number;
      base_auc_wf: number;
      age_coef: number;
      size_coef: number;
      growth_coef: number;
      fam_range: [number, number];
      median_age_years: number;
      terms: { label: string; brier10: number; auc10: number; brier_wf: number; auc_wf: number; kept: boolean }[];
    };
  };
  chart: { points: [number, number][]; line: [number, number, number, number]; q50: number };
  rows: BoardRow[];
  live: LiveRow[];
}

export interface BuiltRadar {
  board: BoardRow[];
  radar: RadarData;
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, checksum: string): BuiltRadar {
  const lab = labelledSet(snapshot);
  const value = fitValueModel(lab);
  const oddsRows = oddsSet(snapshot);
  const odds = fitOddsModel(oddsRows);
  const looPred = looPredictions(lab, ['size', 'cat'], CAT_LAMBDA);

  // Board selection: the whole watchlist, then the largest pre-token protocols below the floor.
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  // Score every chosen protocol.
  interface Scored {
    p: SnapshotProtocol;
    pred: number;
    mult: number;
    ifLaunches: number;
    odds: number;
    implied: number;
    age: number | null;
  }
  const scored: Scored[] = [...chosen.values()].map((p) => {
    const pred = predictValue(value, p, snapshot.as_of);
    const mult = 10 ** pred;
    const ifLaunches = p.tvl_usd * mult;
    const od = predictOdds(odds, p, snapshot.as_of);
    return { p, pred, mult, ifLaunches, odds: od, implied: Math.max(1, Math.round(ifLaunches * od)), age: ageDays(snapshot.as_of, p.listed_at) };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  // Bootstrap rank ranges: 200 refits of the value model (seed 7), odds held at the full fit.
  const { X, pen } = valueDesign(lab, ['size', 'cat'], CAT_LAMBDA);
  const y = lab.map((r) => r.y);
  const ranks: number[][] = scored.map(() => []);
  const rand = mulberry32(7);
  for (let k = 0; k < 200; k++) {
    const idx: number[] = [];
    for (let i = 0; i < lab.length; i++) idx.push(Math.floor(rand() * lab.length));
    const bb = ridgeFit(idx.map((i) => X[i]!), idx.map((i) => y[i]!), pen);
    const imp = scored.map((s) => {
      const row: number[] = [1, Math.log10(s.p.tvl_usd)];
      for (const c of value.cats) row.push((s.p.category ?? 'Uncategorised') === c ? 1 : 0);
      return Math.max(1, Math.round(s.p.tvl_usd * 10 ** dot(row, bb) * s.odds));
    });
    const order = imp.map((v, i) => i).sort((a, b) => imp[b]! - imp[a]! || (scored[a]!.p.slug < scored[b]!.p.slug ? -1 : 1));
    for (let r = 0; r < order.length; r++) ranks[order[r]!]!.push(r + 1);
  }

  // Nearest priced peers per row (labelled set only, so the held-out model value is a real LOO fit).
  const peerOf = (s: Scored): Peer[] => {
    const same = lab.filter((l) => l.cat === (s.p.category ?? 'Uncategorised'));
    const rest = lab.filter((l) => l.cat !== (s.p.category ?? 'Uncategorised'));
    const byClose = (a: Labelled, b: Labelled) =>
      Math.abs(a.logTvl - Math.log10(s.p.tvl_usd)) - Math.abs(b.logTvl - Math.log10(s.p.tvl_usd));
    const picked = [...same].sort(byClose).slice(0, 8);
    if (picked.length < 8) picked.push(...[...rest].sort(byClose).slice(0, 8 - picked.length));
    return picked.map((l) => {
      const modelValue = l.p.tvl_usd * 10 ** looPred[lab.indexOf(l)]!;
      return {
        name: l.p.name,
        category: l.p.category,
        tvl_usd: l.p.tvl_usd,
        mcap_usd: l.p.mcap_usd!,
        ratio: round4(l.p.mcap_usd! / l.p.tvl_usd),
        held_out: round2(l.p.mcap_usd! / modelValue),
      };
    });
  };

  const flat = flatEval(lab, 66);
  const board: BoardRow[] = scored.map((s, i) => {
    const dep = DEPOSIT_PCT * s.p.tvl_usd;
    const exitTvl = Math.round(s.p.tvl_usd * EXIT_DROP);
    const v = farmVerdict(s.implied, s.p.tvl_usd, DEPOSIT_PCT, DROP_SHARE, HORIZON_WEEKS);
    const steps = farmSteps(s.p, dep, exitTvl);
    const rr = [...ranks[i]!].sort((a, b) => a - b);
    const rankLo = Math.round(quantile(rr, 0.05));
    const rankHi = Math.round(quantile(rr, 0.95));
    const p25 = Math.max(1, Math.round(s.ifLaunches * s.odds * 10 ** -value.jackQ50));
    const p75 = Math.max(1, Math.round(s.ifLaunches * s.odds * 10 ** value.jackQ50));
    const p10 = Math.max(1, Math.round(s.ifLaunches * s.odds * 10 ** -value.jackQ80));
    const p90 = Math.max(1, Math.round(s.ifLaunches * s.odds * 10 ** value.jackQ80));
    const minShare = (v.fees * (s.p.tvl_usd + dep)) / (s.implied * dep);
    const minOdds = (v.fees * (s.p.tvl_usd + dep)) / (s.ifLaunches * DROP_SHARE * dep);
    const catFactor = (() => {
      const ci = value.cats.indexOf(s.p.category ?? 'Uncategorised');
      return ci < 0 ? 1 : 10 ** value.beta[2 + ci]!;
    })();
    const how: { label: string; value: string }[] = [
      { label: 'TVL', value: fmtUsd(s.p.tvl_usd) },
      { label: 'base multiple', value: `×${round4(value.mult100)} (fitted on ${lab.length} traded tokens, read at $100M TVL)` },
      { label: 'size curve', value: `×${round4(10 ** (value.slope * (Math.log10(s.p.tvl_usd) - 8)))} at this TVL (slope ${round3(value.slope)} ± ${round3(value.slopeSe)})` },
      { label: 'category · ' + (s.p.category ?? 'Uncategorised'), value: `×${round4(catFactor)}` },
      { label: '= value if a token launches', value: fmtUsd(s.ifLaunches) },
      { label: 'token odds', value: `${Math.round(s.odds * 100)}% (peers of its age, family, size and 7-day growth)` },
      { label: '= implied value', value: fmtUsd(s.implied) },
    ];
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      listed_at: s.p.listed_at,
      age_days: s.age,
      watchlist: snapshot.watchlist.includes(s.p.slug),
      tier: snapshot.watchlist.includes(s.p.slug) ? 'Watchlist' : 'Early',
      implied_value_usd: s.implied,
      if_launches_usd: Math.round(s.ifLaunches),
      token_odds: round4(s.odds),
      p25_usd: p25,
      p75_usd: p75,
      p10_usd: p10,
      p90_usd: p90,
      verdict: v.verdict,
      net_usd: Math.round(v.net * 100) / 100,
      net_per_hour: Math.round(v.perHour * 100) / 100,
      deposit_usd: Math.round(dep * 100) / 100,
      drop_usd: Math.round(v.drop * 100) / 100,
      fees_usd: v.fees,
      hours: v.hours,
      tbill_usd: Math.round(v.tbill * 100) / 100,
      min_drop_share: round4(minShare),
      min_odds: round4(minOdds),
      exit_tvl_usd: exitTvl,
      rank_lo: rankLo,
      rank_hi: rankHi,
      mult: round4(s.mult),
      farm_steps: steps.map((st, n) => stepText(st, n + 1)),
      steps,
      peers: peerOf(s),
      how,
    };
  });

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 24)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));

  const preCount = snapshot.protocols.filter(isPreToken).length;
  const rankableCount = snapshot.protocols.filter(isRankable).length;
  const verdicts = { farm: 0, marginal: 0, skip: 0 };
  for (const r of board) {
    if (r.verdict === 'Farm') verdicts.farm++;
    else if (r.verdict === 'Marginal') verdicts.marginal++;
    else verdicts.skip++;
  }
  const totals = {
    tvl_usd: board.reduce((s, r) => s + r.tvl_usd, 0),
    implied_usd: board.reduce((s, r) => s + r.implied_value_usd, 0),
  };
  const chartPoints: [number, number][] = lab.map((r) => [round3(r.logTvl), round3(r.y)] as [number, number]);
  const xs = lab.map((r) => r.logTvl);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    // The sealed snapshot's source line names an https address; the dashboard never displays it,
    // and the gate refuses network addresses, so the entry carries the provenance without the URL.
    source: 'DefiLlama protocols, fetched ' + snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    checksum,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early.length,
    live_size: live.length,
    totals,
    ledger: {
      ranked: board.length,
      token: snapshot.protocols.length - preCount,
      unranked: preCount - board.length,
      unranked_rankable: rankableCount - board.length,
      unranked_excluded: preCount - rankableCount,
    },
    verdicts,
    model: {
      intercept: round4(value.intercept),
      slope: round4(value.slope),
      slope_se: round4(value.slopeSe),
      mult100: round4(value.mult100),
      cat_range: [round4(value.catRange[0]), round4(value.catRange[1])],
      loo: { mean: round3(value.loo.mean), med: round3(value.loo.med) },
      wf66: { mean: round3(value.wf66.mean), med: round3(value.wf66.med) },
      wf47: { mean: round3(value.wf47.mean), med: round3(value.wf47.med) },
      folds: value.folds.map(round2),
      jack_q50: round3(value.jackQ50),
      jack_q80: round3(value.jackQ80),
      jack_cov_loo50: round3(value.jackCovLoo50),
      jack_cov_loo80: round3(value.jackCovLoo80),
      jack_cov_wf50: round3(value.jackCovWf50),
      jack_cov_wf80: round3(value.jackCovWf80),
      flat_loo: round3(flat.loo.mean),
      flat_wf: round3(flat.wf.mean),
      sweep: value.sweep.map((s) => ({ lam: s.lam, loo: round3(s.loo), wf: round3(s.wf) })),
      value_terms: value.termTable.map((t) => ({ label: t.label, loo: round3(t.loo), wf: round3(t.wf), kept: t.kept })),
      odds: {
        brier10: round3(odds.brier10),
        auc10: round3(odds.auc10),
        brier_wf: round3(odds.brierWf),
        auc_wf: round3(odds.aucWf),
        base_brier10: round3(odds.baseBrier10),
        base_auc10: round3(odds.baseAuc10),
        base_brier_wf: round3(odds.baseBrierWf),
        base_auc_wf: round3(odds.baseAucWf),
        age_coef: round3(odds.ageCoef),
        size_coef: round3(odds.sizeCoef),
        growth_coef: round3(odds.growthCoef),
        fam_range: [round3(odds.famRange[0]), round3(odds.famRange[1])],
        median_age_years: round2(odds.medianAgeYears),
        terms: odds.termTable.map((t) => ({ label: t.label, brier10: round3(t.brier10), auc10: round3(t.auc10), brier_wf: round3(t.brierWf), auc_wf: round3(t.aucWf), kept: t.kept })),
      },
    },
    chart: {
      points: chartPoints,
      line: [round3(x0), round3(value.intercept + value.slope * x0), round3(x1), round3(value.intercept + value.slope * x1)],
      q50: round3(value.jackQ50),
    },
    rows: board,
    live,
  };
  return { board, radar };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
