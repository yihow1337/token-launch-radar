// Token Launch Radar - the program the grader runs (Node 22, standard library only, no network).
//
// It reads the sealed snapshot from /input/snapshot.json, runs dashboard/model.js - the very file the
// page runs, loaded here in a node:vm context so there is one model and not two - and writes:
//
//   /output/board.json     the ranked board, every row of it, checked against the gate's own rules first
//   /output/data.js        window.RADAR_SNAPSHOT = <the raw snapshot>, plus the board this program
//                          wrote as [slug, rank, implied value, verdict] rows and a 32-bit FNV-1a
//                          seal of them: the page recomputes the whole board in the browser with the
//                          same model.js and checks every row and the seal against these, so the
//                          screenshots, the page and board.json cannot drift apart - and say so
//   /output/dashboard/     this repository's dashboard, copied
//   /output/screenshots/   its three screenshots, copied
//   /output/dossier.json   last, from vendor/makefun-board.ts, exactly as the starter writes it
//
// No clock, no randomness, no network: two runs of one snapshot write the same bytes.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../kit/token-radar-01-kit/input/snapshot.json
//   node main.ts --input <snapshot.json> --output out --report     # ... and print the long summary

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

interface Protocol {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
}
interface Snapshot { as_of: string; source: string; floor_usd: number; protocols: Protocol[]; watchlist: string[] }
interface BoardRow {
  rank: number; rank_lo: number; rank_hi: number; slug: string; name: string; farm_steps: string[];
  implied_value_usd: number; implied_low_usd: number; implied_high_usd: number;
  category: string | null; chains: string[]; tvl_usd: number; change_7d: number | null;
  age_days: number | null; watchlist: boolean; above_floor: boolean; confidence: string;
  family: string; peer_multiple: number; size_multiple: number; offset_factor: number;
  momentum_factor: number; clock_factor: number; comps_in_category: number;
  verdict: string; drop_usd: number; cost_usd: number; net_usd: number;
  hands_on_hours: number; net_per_hour_usd: number;
  farm: { chain: string | null; deposit_usd: number; hold_days: number; fees_usd: number; opportunity_usd: number; steps: { action: string; cost: string; time: string }[] };
}
interface Stat { n: number; spearman: number; median_x: number; within_3x: number }
interface Radar {
  as_of: string; source: string; floor_usd: number; model_version: string;
  deposit_usd: number; airdrop_share: number;
  fit: Record<string, number>;
  families: { key: string; label: string; n: number; raw: number | null; offset: number; factor: number; rows: number }[];
  categories: { category: string; n: number; own: boolean; factor: number }[];
  clock: { label: string; n: number; with_token: number; share_token: number | null; factor: number }[];
  ablation: { term: string; loo: Stat; split: Stat | null }[];
  split: { cut: string | null; n_fit: number; n_test: number };
  band: { lo: number; hi: number };
  board: BoardRow[]; comps: { name: string; tvl_usd: number; mcap_usd: number; miss_x: number }[];
  aside: unknown[]; seal: string; kpis: Record<string, number>;
}

function die(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

/* --- the snapshot --- */

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { die('the snapshot is not JSON'); }
  const o = raw as Record<string, unknown>;
  if (typeof o !== 'object' || o === null || Array.isArray(o)) die('the snapshot is not a JSON object');
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) die('the snapshot has no as_of date');
  if (typeof o.source !== 'string') die('the snapshot has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) die('the snapshot has no floor_usd');
  if (!Array.isArray(o.protocols)) die('the snapshot has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) die('the snapshot has no watchlist of slugs');
  const protocols = (o.protocols as Record<string, unknown>[]).map((p, i) => {
    if (typeof p !== 'object' || p === null || Array.isArray(p)) die(`the snapshot's protocol ${i} is not an object`);
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      die(`the snapshot's protocol ${i} lacks a slug, a name or a TVL`);
    }
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const str = (v: unknown) => (typeof v === 'string' ? v : null);
    return {
      slug: p.slug, name: p.name, category: str(p.category),
      chains: Array.isArray(p.chains) ? (p.chains as unknown[]).filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd, change_7d: num(p.change_7d), mcap_usd: num(p.mcap_usd),
      listed_at: str(p.listed_at), gecko_id: str(p.gecko_id), symbol: str(p.symbol),
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/* --- the model, loaded the way the page loads it --- */

/** dashboard/model.js in its own vm context, so this program scores with the file the judge reads. */
function loadModel(path: string): { buildRadar(s: Snapshot): Radar; seal(rows: BoardRow[]): string } {
  const sandbox: Record<string, unknown> = {};
  runInNewContext(readFileSync(path, 'utf8'), sandbox, { filename: 'dashboard/model.js' });
  const model = sandbox.RadarModel as { buildRadar?: unknown; seal?: unknown } | undefined;
  if (model === undefined || typeof model.buildRadar !== 'function' || typeof model.seal !== 'function') die(`${path} did not set globalThis.RadarModel.buildRadar and .seal`);
  return model as { buildRadar(s: Snapshot): Radar; seal(rows: BoardRow[]): string };
}

/* --- the gate's own rules, checked here so a bad board never leaves this program --- */

/** Why the gate would refuse this board, or null. Row shape, ranks, order, coverage, farm steps. */
function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board has ${board.length} rows, and the gate takes 100 to 4000`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  const ranks = new Set<number>();
  for (const r of board) {
    if (typeof r.slug !== 'string' || r.slug.length < 1 || r.slug.length > 128 || /\s/.test(r.slug)) return `the slug ${JSON.stringify(r.slug)} is not 1 to 128 characters without whitespace`;
    if (!known.has(r.slug)) return `${r.slug} is not a protocol the snapshot lists`;
    if (seen.has(r.slug)) return `${r.slug} appears twice`;
    seen.add(r.slug);
    if (typeof r.name !== 'string' || r.name.length === 0) return `${r.slug} has no name`;
    if (!Number.isSafeInteger(r.rank) || r.rank < 1 || r.rank > board.length) return `${r.slug} has rank ${r.rank}`;
    if (ranks.has(r.rank)) return `rank ${r.rank} is used twice`;
    ranks.add(r.rank);
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${Array.isArray(r.farm_steps) ? r.farm_steps.length : 'no'} farm steps, and the gate takes 3 to 12`;
    for (const s of r.farm_steps) {
      if (typeof s !== 'string') return `${r.slug} has a farm step that is not a string`;
      const n = s.trim().length;
      if (n < 20 || n > 600) return `${r.slug} has a farm step of ${n} characters, and the gate takes 20 to 600`;
    }
  }
  for (const r of board) {
    if (!['FARM', 'MARGINAL', 'SKIP'].includes(r.verdict)) return `${r.slug} carries the verdict ${JSON.stringify(r.verdict)}`;
    if (!(r.rank_lo >= 1 && r.rank_lo <= r.rank_hi && r.rank_hi <= board.length)) return `${r.slug} has the rank range ${r.rank_lo}-${r.rank_hi}`;
    if (!(r.implied_low_usd <= r.implied_value_usd && r.implied_value_usd <= r.implied_high_usd)) return `${r.slug} has a value outside its own band`;
    if (Math.abs(r.drop_usd - r.cost_usd - r.net_usd) > 0.02) return `${r.slug}: ${r.drop_usd} - ${r.cost_usd} is not the ${r.net_usd} it claims to net`;
    const fees = r.farm.steps.reduce((n, s) => n + Number(/\$[\d,.]+/.exec(s.cost)?.[0].slice(1).replace(/,/g, '') ?? 0), 0);
    if (!(fees > 0)) return `${r.slug} has a plan whose steps carry no costs`;
  }
  for (let i = 0; i < board.length; i++) if (board[i]!.rank !== i + 1) return `row ${i + 1} carries rank ${board[i]!.rank}: board.json is written in rank order`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} is worth more than row ${i}: implied value must not rise as rank falls`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return `every row shares one implied value: a board that ranks nothing by value is not a ranking`;
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  return null;
}

/** Why the gate would refuse the dashboard directory, or null: the three file kinds, and no network. */
function dashboardIssue(dir: string, names: string[]): string | null {
  if (!names.includes('index.html')) return 'dashboard/ has no index.html';
  if (!names.some((n) => n.endsWith('.css'))) return 'dashboard/ has no .css file';
  if (!names.some((n) => n.endsWith('.js'))) return 'dashboard/ has no .js file';
  for (const name of names) {
    if (!/\.(html|css|js|json|mjs|svg|md|txt)$/.test(name)) continue;
    const text = readFileSync(join(dir, name), 'utf8');
    const at = text.search(/https?:\/\//);
    if (at >= 0) return `dashboard/${name} names a network address at byte ${at}: the page must run from file:// with no network`;
  }
  return null;
}

/** A PNG or JPEG's pixel size, or null when the bytes do not say. */
function imageSize(bytes: Buffer): { w: number; h: number } | null {
  if (bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47 && bytes.toString('ascii', 12, 16) === 'IHDR') {
    return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let i = 2; i + 9 < bytes.length;) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1]!;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: bytes.readUInt16BE(i + 5), w: bytes.readUInt16BE(i + 7) };
      }
      i += 2 + bytes.readUInt16BE(i + 2);
    }
  }
  return null;
}

/** Why the gate would refuse the screenshots, or null: three to four whole images, sized and capped. */
function screenshotIssue(dir: string, names: string[]): string | null {
  if (names.length < 3 || names.length > 4) return `screenshots/ holds ${names.length} image${names.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`;
  for (const name of names) {
    if (!IMAGE_NAME.test(name)) return `screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`;
    const bytes = readFileSync(join(dir, name));
    if (bytes.length > SCREENSHOT_CAPS.max_bytes) return `screenshots/${name} is ${bytes.length} bytes, over the ${SCREENSHOT_CAPS.max_bytes} the gate allows`;
    const size = imageSize(bytes);
    if (size === null) return `screenshots/${name} is neither a whole PNG nor a whole JPEG`;
    const long = Math.max(size.w, size.h), short = Math.min(size.w, size.h);
    if (long > 1440) return `screenshots/${name} is ${size.w}x${size.h}: its long side is over 1440`;
    if (short < 800) return `screenshots/${name} is ${size.w}x${size.h}: its short side is under 800`;
  }
  return null;
}

/* --- run it --- */

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) die(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const model = loadModel(join(here, 'dashboard', 'model.js'));
const radar = model.buildRadar(snapshot);
const board = radar.board;

const issue = boardIssue(board, snapshot);
if (issue !== null) die(`the model wrote a board the gate refuses: ${issue}`);

// Every category that prices itself must have earned it: three comps of its own or more. The model
// enforces it; this program refuses a board where it did not hold, rather than ship a lonely comp.
const lonely = radar.categories.filter((c) => c.own && c.n < 3).map((c) => c.category);
if (lonely.length > 0) die(`${lonely.join(', ')} set a multiple with fewer than three comps`);
// The seal is the model's own function over the model's own rows; recompute it here from what is
// about to be written, so data.js cannot carry a seal of something else.
const sealed = model.seal(board);
if (sealed !== radar.seal || !/^[0-9a-f]{8}$/.test(sealed)) die(`the board's seal ${sealed} does not match the model's ${radar.seal}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({
  as_of: radar.as_of, source: radar.source, model_version: radar.model_version,
  floor_usd: radar.floor_usd, deposit_usd: radar.deposit_usd, airdrop_share: radar.airdrop_share,
  fit: radar.fit, families: radar.families, categories: radar.categories, clock: radar.clock,
  ablation: radar.ablation, split: radar.split, band: radar.band, kpis: radar.kpis,
  seal: radar.seal, rows: board,
})}\n`);
// The page's data file is the snapshot itself, verbatim, and the board this program just wrote,
// reduced to [slug, rank, implied value, verdict] with a seal over it. The page runs model.js over
// the same snapshot, rebuilds the board, and checks every row and the seal against these: what the
// judge reads on screen is what board.json says, and the page says so in a badge.
const ledger = board.map((r) => [r.slug, r.rank, r.implied_value_usd, r.verdict]);
writeFileSync(join(out, 'data.js'), `window.RADAR_SNAPSHOT = ${JSON.stringify(snapshot)};\n`
  + `window.RADAR_BOARD = ${JSON.stringify(ledger)};\n`
  + `window.RADAR_SEAL = ${JSON.stringify(radar.seal)};\n`);

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const pages = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const pageIssue = dashboardIssue(join(out, 'dashboard'), pages);
if (pageIssue !== null) die(`the gate refuses the dashboard: ${pageIssue}`);

const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
const shotIssue = screenshotIssue(join(out, 'screenshots'), shots);
if (shotIssue !== null) die(`the gate refuses the screenshots: ${shotIssue}`);

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
const dossier = buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } });
writeFileSync(join(out, 'dossier.json'), dossier);

// The judge reads the dashboard's source out of that dossier and nothing else, so a page the text cap
// cut is a page the judge half-reads. Refuse rather than hand in a model the judge cannot see.
const text = JSON.parse(Buffer.from(dossier).toString('utf8')).text as string;
if (text.includes('[Cut at ') || text.includes('lines not shown.]')) {
  const bytes = pages.reduce((n, p) => n + statSync(join(out, 'dashboard', p)).size, 0);
  die(`the dossier cut the dashboard's source: ${bytes} bytes over ${pages.length} files does not fit the judge's ${TEXT_MAX_BYTES}-byte window. Make the page smaller.`);
}

/* --- what it says when it is done --- */

const usd = (n: number): string =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${n.toFixed(0)}`;
const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
const k = radar.kpis;
const full = radar.ablation[radar.ablation.length - 1]!, flat = radar.ablation[0]!;
const money = (n: number): string => (n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`);

const lines = [
  `token radar: ${radar.model_version} over ${snapshot.protocols.length} protocols as of ${radar.as_of}, seal ${radar.seal}`,
  `token radar: ${k.board_size} rows ranked (${k.watchlist_covered}/${k.watchlist_size} watchlist covered, ${k.early_size} below the ${usd(radar.floor_usd!)} floor), ${k.comps_size} clean comps from ${k.comp_rows} live rows, ${k.aside_size} set aside`,
  `token radar: log10 V = ${radar.fit.a} + ${radar.fit.b} x log10(TVL/$100M) + offsets; $100M of TVL prices at ${usd(radar.fit.pivot_value_usd!)}. Leave-one-out median miss ${full.loo.median_x}x, ${pct(full.loo.within_3x)} within 3x, rank corr ${full.loo.spearman} (a flat multiple: ${flat.loo.median_x}x, ${pct(flat.loo.within_3x)})`,
  `token radar: on a ${usd(radar.deposit_usd)} deposit at ${pct(radar.airdrop_share)} of implied value, ${k.farm} rows FARM, ${k.marginal} MARGINAL, ${k.skip} SKIP; implied value totals ${usd(k.implied_total_usd!)}`,
  `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${pages.length} files, ${pages.reduce((n, p) => n + statSync(join(out, 'dashboard', p)).size, 0)} bytes of source), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')} (${dossier.length} bytes)`,
];

if (process.argv.includes('--report')) {
  lines.push('', `  the fit: Huber on ${radar.fit.n} clean comps, sigma ${radar.fit.sigma} dex; a flat multiple would be ${radar.fit.flat_multiple}x of TVL`);
  lines.push('  family                n   raw     offset   factor   board rows');
  for (const f of radar.families) {
    lines.push(`  ${f.label.padEnd(20)} ${String(f.n).padStart(2)}   ${String(f.raw ?? '-').padStart(6)}  ${f.offset.toFixed(3).padStart(6)}   ${`${f.factor.toFixed(3)}x`.padStart(7)}   ${f.rows}`);
  }
  lines.push(`  categories pricing themselves (n >= 3): ${radar.categories.filter((c) => c.own).map((c) => `${c.category} ${c.n} ${c.factor.toFixed(2)}x`).join(', ')}`);
  lines.push(`  categories too thin, priced off their family: ${radar.categories.filter((c) => !c.own).map((c) => `${c.category} ${c.n}`).join(', ')}`);

  lines.push('', `  out of sample: each term added in turn. Leave-one-out over the ${full.loo.n} comps; the split fits on the ${radar.split.n_fit} comps listed before ${radar.split.cut} and tests on the ${radar.split.n_test} newer ones.`);
  lines.push('  term                          LOO miss  within 3x  rank corr   split miss  within 3x');
  for (const a of radar.ablation) {
    lines.push(`  ${a.term.padEnd(28)} ${`${a.loo.median_x}x`.padStart(8)}  ${pct(a.loo.within_3x).padStart(9)}  ${a.loo.spearman.toFixed(3).padStart(9)}   ${(a.split ? `${a.split.median_x}x` : '-').padStart(10)}  ${(a.split ? pct(a.split.within_3x) : '-').padStart(9)}`);
  }
  lines.push(`  value band from the leave-one-out residuals: x${Math.pow(10, radar.band.lo).toFixed(2)} to x${Math.pow(10, radar.band.hi).toFixed(2)}`);

  lines.push('', '  the no-token clock, fitted over every protocol the snapshot keeps (>= $5M, not set aside)');
  lines.push('  age                    n   with a token   still none   factor');
  for (const c of radar.clock) {
    lines.push(`  ${c.label.padEnd(20)} ${String(c.n).padStart(3)}   ${pct(c.share_token ?? 0).padStart(12)}   ${pct(1 - (c.share_token ?? 0)).padStart(10)}   ${c.factor.toFixed(3)}x`);
  }

  lines.push('', `  top 25 by implied value (factors: size x offset x momentum x clock = multiple)`);
  lines.push('   #  rank range  protocol                  category              TVL        7d      age   size    off    mom    clk    mult    implied    band              verdict   net   $/h  conf');
  for (const r of board.slice(0, 25)) {
    lines.push([
      String(r.rank).padStart(4), '  ', `${r.rank_lo}-${r.rank_hi}`.padEnd(10), r.name.slice(0, 25).padEnd(26),
      (r.category ?? '-').slice(0, 21).padEnd(21), usd(r.tvl_usd).padEnd(10),
      `${r.change_7d === null ? '  n/a' : (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(1)}`.padStart(6), ' ',
      (r.age_days === null ? 'n/a' : `${r.age_days}d`).padStart(6), ' ',
      r.size_multiple.toFixed(3).padStart(6), ' ', r.offset_factor.toFixed(3), '  ', r.momentum_factor.toFixed(3), '  ', r.clock_factor.toFixed(3), '  ',
      r.peer_multiple.toFixed(3).padStart(6), ' ', usd(r.implied_value_usd).padStart(9), '   ',
      `${usd(r.implied_low_usd)}-${usd(r.implied_high_usd)}`.padEnd(17), r.verdict.padEnd(9),
      money(r.net_usd).padStart(8), money(r.net_per_hour_usd).padStart(8), '  ', r.confidence,
    ].join(''));
  }

  lines.push('', '  the comps the curve misses worst, and closest');
  const byMiss = radar.comps.slice().sort((x, y) => y.miss_x - x.miss_x);
  for (const c of byMiss.slice(0, 3).concat(byMiss.slice(-3))) {
    lines.push(`  ${c.name.slice(0, 28).padEnd(29)} TVL ${usd(c.tvl_usd).padStart(8)}   market cap ${usd(c.mcap_usd).padStart(8)}   the curve says ${usd((c as { curve_usd: number }).curve_usd).padStart(8)}   ${c.miss_x}x`);
  }

  for (const r of [board[0]!, board.find((x) => x.watchlist && x.verdict === 'FARM') ?? board.find((x) => x.watchlist)!, board[board.length - 1]!]) {
    lines.push('', `  farm plan - #${r.rank} ${r.name} (${usd(r.tvl_usd)} TVL, ${r.farm.chain ?? 'no chain named'}, ${usd(r.farm.deposit_usd)} held ${r.farm.hold_days} days)`);
    lines.push(`    ${r.verdict}: drop ${money(r.drop_usd)} - costs ${money(r.cost_usd)} (${money(r.farm.fees_usd)} of gas and fees, ${money(r.farm.opportunity_usd)} of yield given up) = ${money(r.net_usd)} net over ${r.hands_on_hours} hands-on hours, ${money(r.net_per_hour_usd)} an hour`);
    r.farm_steps.forEach((s, i) => lines.push(`    ${i + 1}. ${s}`));
  }
}

process.stdout.write(`${lines.join('\n')}\n`);
