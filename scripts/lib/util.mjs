import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const p = (...parts) => join(ROOT, ...parts);

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    if (fallback !== undefined) return fallback;
    throw err;
  }
}

export async function writeJson(file, data) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

export function decodeEntities(s = '') {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

export function stripHtml(s = '') {
  return decodeEntities(
    String(s)
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<(script|style|noscript|svg|nav|footer|header|aside|form)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

export function slugify(s = '') {
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

export function normTitle(s = '') {
  return slugify(s).replace(/-/g, ' ');
}

/** Similaridad de Jaccard entre títulos (0 a 1), útil para detectar la misma noticia en dos medios. */
export function titleSimilarity(a, b) {
  const stop = new Set(['de', 'la', 'el', 'en', 'y', 'a', 'los', 'las', 'del', 'con', 'por', 'para', 'un', 'una', 'que', 'se', 'su', 'al', 'the', 'to', 'of', 'and', 'in', 'for']);
  const set = (s) => new Set(normTitle(s).split(' ').filter((w) => w.length > 2 && !stop.has(w)));
  const A = set(a), B = set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

export const UA = 'Mozilla/5.0 (compatible; BlogViajeroUruguayoBot/1.0; +https://github.com/)';

export async function fetchText(url, { timeout = 15000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': UA, 'accept-language': 'es-UY,es;q=0.9,en;q=0.6', ...headers },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { text: await res.text(), url: res.url };
  } finally {
    clearTimeout(t);
  }
}

export function log(...args) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}]`, ...args);
}
