import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_FILE = path.join(__dirname, '..', 'data', 'knowledge.json');

let KB = { docs: [] };
function loadKB() {
  try {
    KB = JSON.parse(fs.readFileSync(KB_FILE, 'utf8'));
  } catch {
    KB = { docs: [] };
  }
  return KB;
}
loadKB();

const STOP = new Set(
  'the a an of and or to in on at is are was were be been for with as by from this that it its about into our your their you we they what which who how when where why'.split(' ')
);

function tokenize(s) {
  return (s.toLowerCase().match(/[a-z0-9\u0900-\u097F]+/g) || []).filter(
    (t) => t.length > 1 && !STOP.has(t)
  );
}

// Build a lightweight TF-IDF index over the crawled docs.
let INDEX = { df: new Map(), docs: [] };
function buildIndex() {
  const df = new Map();
  const docs = KB.docs.map((d) => {
    const tf = new Map();
    for (const tok of tokenize(`${d.title} ${d.content}`)) tf.set(tok, (tf.get(tok) || 0) + 1);
    for (const tok of tf.keys()) df.set(tok, (df.get(tok) || 0) + 1);
    return { ...d, tf };
  });
  INDEX = { df, docs };
}
buildIndex();

export function reloadKnowledge() {
  loadKB();
  buildIndex();
  return KB.docs.length;
}

export function searchKnowledge(query, k = 5) {
  const N = INDEX.docs.length || 1;
  const qTokens = tokenize(query);
  const scored = INDEX.docs.map((d) => {
    let score = 0;
    for (const qt of qTokens) {
      const tf = d.tf.get(qt);
      if (!tf) continue;
      const idf = Math.log(1 + N / (1 + (INDEX.df.get(qt) || 0)));
      score += tf * idf;
    }
    // Title boost
    const titleHits = tokenize(d.title).filter((t) => qTokens.includes(t)).length;
    score += titleHits * 2;
    return { ...d, score };
  });
  return scored
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ url, title, content, score }) => ({
      url,
      title,
      snippet: content.slice(0, 1600),
      score: Number(score.toFixed(2)),
    }));
}

// Live tool: fetch a page on demand (agent uses when cache is insufficient).
export async function fetchLivePage(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'NNM-AgenticBot/1.0' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  $('script, style, noscript, nav, header, footer, form, iframe').remove();
  const title = $('title').first().text().trim();
  const text = $('h1, h2, h3, p, li, td, th')
    .map((_, el) => $(el).text().replace(/\s+/g, ' ').trim())
    .get()
    .filter((t) => t.length > 2)
    .join('\n');
  return { url, title, content: text.slice(0, 6000) };
}

export function knowledgeStats() {
  return { pages: KB.docs.length, crawledAt: KB.crawledAt, source: KB.source };
}
