import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const OUT_FILE = path.join(DATA_DIR, 'knowledge.json');

const SOURCE = process.env.SOURCE_SITE || 'https://www.nnm.ac.in';
const MAX_PAGES = Number(process.env.MAX_CRAWL_PAGES || 120);
const ORIGIN = new URL(SOURCE).origin;

const SKIP_EXT = /\.(pdf|jpg|jpeg|png|gif|svg|webp|zip|doc|docx|xls|xlsx|mp4|mp3|ico|css|js)$/i;

function clean(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function extractContent($) {
  $('script, style, noscript, nav, header, footer, form, .modal, iframe').remove();
  const title = clean($('title').first().text()) || clean($('h1').first().text());
  const parts = [];
  $('h1, h2, h3, h4, p, li, td, th').each((_, el) => {
    const t = clean($(el).text());
    if (t && t.length > 2) parts.push(t);
  });
  // De-duplicate consecutive repeats (menus etc.)
  const seen = new Set();
  const body = parts.filter((p) => {
    if (seen.has(p)) return false;
    seen.add(p);
    return true;
  }).join('\n');
  return { title, body };
}

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'NNM-KnowledgeBot/1.0 (+clone-project)' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/html')) throw new Error('not html');
  return res.text();
}

function normalize(href, base) {
  try {
    const u = new URL(href, base);
    u.hash = '';
    if (u.origin !== ORIGIN) return null;
    if (SKIP_EXT.test(u.pathname)) return null;
    if (u.pathname.includes('/wp-admin') || u.pathname.includes('/wp-login')) return null;
    return u.toString().replace(/\/$/, '') || u.toString();
  } catch {
    return null;
  }
}

async function crawl() {
  const queue = [SOURCE.replace(/\/$/, '')];
  const visited = new Set();
  const docs = [];

  while (queue.length && docs.length < MAX_PAGES) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    try {
      const html = await fetchPage(url);
      const $ = cheerio.load(html);
      const { title, body } = extractContent($);

      if (body && body.length > 120) {
        docs.push({ url, title, content: body.slice(0, 8000) });
        console.log(`[${docs.length}] ${title || url}`);
      }

      // Reload links from original html (extractContent mutates the tree)
      const $links = cheerio.load(html);
      $links('a[href]').each((_, el) => {
        const next = normalize($links(el).attr('href'), url);
        if (next && !visited.has(next) && !queue.includes(next)) queue.push(next);
      });
    } catch (e) {
      console.warn(`skip ${url}: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    OUT_FILE,
    JSON.stringify({ source: SOURCE, crawledAt: new Date().toISOString(), docs }, null, 2)
  );
  console.log(`\nSaved ${docs.length} pages to ${OUT_FILE}`);
}

crawl().catch((e) => {
  console.error(e);
  process.exit(1);
});
