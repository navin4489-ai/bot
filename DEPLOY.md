# Deploying to Render + subdomain bot.wintechinov.com

This app is ready to deploy on [Render](https://render.com) as a Node web service,
then mapped to the custom subdomain **bot.wintechinov.com**.

---

## Part 1 — Push the code to GitHub

Render deploys from a Git repo. From the `nnm-clone` folder:

```bash
git init
git add .
git commit -m "NNM clone + agentic bot"
# create an empty repo on github.com, then:
git remote add origin https://github.com/<your-user>/nnm-bot.git
git branch -M main
git push -u origin main
```

> `.env` and `node_modules/` are git-ignored, so your API key is NOT pushed.

---

## Part 2 — Create the Render service

1. Go to https://dashboard.render.com → **New** → **Web Service**.
2. Connect your GitHub repo (`nnm-bot`).
3. Render auto-detects `render.yaml`. If asked manually, use:
   - **Runtime:** Node
   - **Build command:** `npm install && npm run build`
   - **Start command:** `npm start`
   - **Health check path:** `/api/health`
   - **Plan:** Free
4. Under **Environment**, add the secret:
   - `GEMINI_API_KEY` = *your Gemini key*
   (`SOURCE_SITE`, `MAX_CRAWL_PAGES`, `NODE_VERSION` come from `render.yaml`.)
5. Click **Create Web Service**. Render will install deps, crawl the NNM site
   (`npm run build`), and start the server. First deploy takes ~3–5 min.

Your app will be live at `https://nnm-bot.onrender.com` (verify it works there first).

---

## Part 3 — Map the subdomain bot.wintechinov.com

### On Render
1. Open your service → **Settings** → **Custom Domains** → **Add Custom Domain**.
2. Enter `bot.wintechinov.com` → Render shows a **CNAME target**
   (e.g. `nnm-bot.onrender.com`).

### On your DNS provider (where wintechinov.com is managed)
Add a DNS record:

| Type  | Name / Host | Value / Target          | TTL  |
|-------|-------------|-------------------------|------|
| CNAME | `bot`       | `nnm-bot.onrender.com`  | Auto |

> Use the exact target Render shows. If your DNS is Cloudflare, set the record to
> **DNS only** (grey cloud) during verification.

3. Back on Render, click **Verify**. Once DNS propagates (minutes to ~1 hour),
   Render auto-issues a free SSL cert and **https://bot.wintechinov.com** goes live.

---

## Notes
- **Free plan sleeps** after 15 min idle; first request after sleep takes ~30 s to wake.
  Upgrade to a paid instance for always-on.
- To refresh the knowledge base later, trigger a **Manual Deploy** (re-runs the crawl),
  or call `POST /api/reload` after updating data.
- The Gemini **free tier** still applies (daily request caps). Add billing on your
  Google AI Studio project for higher limits.
