# Nava Nalanda Mahavihara — Clone + Agentic AI Chatbot

A demonstration clone of the NNM website with **NalandaMitra**, an agentic AI assistant
that answers visitor questions using content retrieved live from the official website
(https://www.nnm.ac.in). Powered by **Google Gemini (free tier)**.

> This is an educational demo. The homepage is an original, faithfully-styled recreation of
> the public site's layout. The chatbot cites the official website as its source of truth.

## How the agentic bot works

1. **Crawl** – `crawler.js` fetches pages from nnm.ac.in and builds a local knowledge base (`data/knowledge.json`).
2. **Retrieve** – `retriever.js` indexes pages with TF-IDF for fast keyword search.
3. **Agent loop** – `index.js` gives Gemini two tools:
   - `search_website` – find relevant pages in the knowledge base.
   - `fetch_page` – read any nnm.ac.in page live when more detail is needed.
   The model calls these tools repeatedly until it can answer accurately, then cites sources.
   Every factual claim must come from retrieved content — no hallucinations.

## Setup

```bash
cd nnm-clone
npm install
cp .env.example .env          # Windows: copy .env.example .env
```

Get a **free** Gemini API key at https://aistudio.google.com/apikey and put it in `.env`:

```
GEMINI_API_KEY=your_key_here
```

## Build the knowledge base (crawl the site)

```bash
npm run crawl
```

This saves crawled pages to `data/knowledge.json`. Re-run anytime to refresh.

## Run

```bash
npm start
```

Open http://localhost:3000 and click the 💬 button.

### Notes
- Without an API key, the bot still works in **retrieval-only** mode (returns relevant page links).
- Change `MAX_CRAWL_PAGES` in `.env` to crawl more/fewer pages.
- `POST /api/reload` reloads the knowledge base without restarting.
