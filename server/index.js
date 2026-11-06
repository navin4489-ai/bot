import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  searchKnowledge,
  fetchLivePage,
  reloadKnowledge,
  knowledgeStats,
} from './retriever.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY;

const genAI = API_KEY ? new GoogleGenerativeAI(API_KEY) : null;

const SYSTEM_PROMPT = `You are "NalandaMitra", the official AI assistant for the Nava Nalanda Mahavihara (NNM) website, a Deemed-to-be University under the Ministry of Culture, Government of India, located in Nalanda, Bihar.

Your job: answer visitor questions about the university — admissions, courses, departments, faculty, facilities, library, events, notices, administration, contact details, etc. — using ONLY information retrieved from the official NNM website.

AGENTIC RULES:
- ALWAYS call the "search_website" tool first to find relevant pages before answering.
- If the search results are thin or the user asks about a specific page/URL, call "fetch_page" to read the live page.
- You may call tools multiple times to gather complete, accurate information.
- Base every factual claim strictly on retrieved content. If the information is not found, say so honestly and point the user to the relevant section or contact details, never invent facts.

STYLE & FORMATTING:
- Open with one short, direct sentence that answers the core question.
- Use Markdown: **bold** for key terms, bullet points for lists, and short clear headings (###) only when the answer has multiple distinct parts.
- Keep it scannable — prefer bullets over long paragraphs. Avoid filler and repetition.
- Highlight important specifics (dates, fees, names, phone numbers, deadlines) in **bold**.
- Reply in the language the user used (English or Hindi).
- End with a "Source:" line listing the page link(s) you actually used.
- Never dump raw page text; synthesize a clean, helpful answer.`;

const tools = [
  {
    functionDeclarations: [
      {
        name: 'search_website',
        description:
          'Search the Nava Nalanda Mahavihara website knowledge base for pages relevant to the user query. Returns top matching pages with title, URL and a text snippet.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search keywords or question.' },
          },
          required: ['query'],
        },
      },
      {
        name: 'fetch_page',
        description:
          'Fetch and read the full text content of a specific nnm.ac.in page by URL. Use for details not covered by search snippets.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'A full https://www.nnm.ac.in/... URL.' },
          },
          required: ['url'],
        },
      },
    ],
  },
];

async function runTool(name, args) {
  if (name === 'search_website') {
    const results = searchKnowledge(args.query || '', 5);
    return { results: results.length ? results : 'No matching pages found in the knowledge base.' };
  }
  if (name === 'fetch_page') {
    try {
      const url = String(args.url || '');
      if (!/nnm\.ac\.in/.test(url)) return { error: 'Only nnm.ac.in URLs are allowed.' };
      return await fetchLivePage(url);
    } catch (e) {
      return { error: e.message };
    }
  }
  return { error: 'unknown tool' };
}

app.post('/api/chat', async (req, res) => {
  const { message, history = [] } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message required' });

  if (!genAI) {
    // Graceful fallback when no API key: pure retrieval answer.
    const hits = searchKnowledge(message, 4);
    const reply = hits.length
      ? `I found these relevant pages on the NNM website:\n\n${hits
          .map((h) => `• ${h.title || h.url}\n  ${h.url}`)
          .join('\n')}\n\n(Add a free GEMINI_API_KEY in .env for full conversational answers.)`
      : "I couldn't find that on the NNM website. Please check the News & Notices section or contact the university at 8986426478.";
    return res.json({ reply, sources: hits.map((h) => h.url), mode: 'retrieval-only' });
  }

  try {
    const modelNames = (process.env.GEMINI_MODEL || 'gemini-flash-lite-latest,gemini-flash-latest,gemini-pro-latest')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);

    async function generateWithRetry(model, payload) {
      let lastErr;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return await model.generateContent(payload);
        } catch (e) {
          lastErr = e;
          const msg = String(e.message || '');
          // Retry once on transient overload; back off briefly.
          if (/\b(503|overload|high demand|unavailable)\b/i.test(msg) && attempt === 0) {
            await new Promise((r) => setTimeout(r, 1500));
            continue;
          }
          throw e;
        }
      }
      throw lastErr;
    }

    function makeModel(name) {
      return genAI.getGenerativeModel({
        model: name,
        systemInstruction: SYSTEM_PROMPT,
        tools,
      });
    }

    // Pick the first model that responds; fall back across the list on transient failures.
    let model = makeModel(modelNames[0]);
    let modelIdx = 0;

    const contents = [
      ...history.slice(-8).map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: String(m.content).slice(0, 2000) }],
      })),
      { role: 'user', parts: [{ text: message }] },
    ];

    const usedSources = new Set();
    let final = '';

    // Agentic loop: let the model call tools until it produces a final answer.
    for (let step = 0; step < 6; step++) {
      let result;
      let lastError;
      while (result === undefined) {
        try {
          result = await generateWithRetry(model, { contents });
        } catch (e) {
          lastError = e;
          // On any model failure (deprecated/quota/overload), fall through to the next model.
          if (modelIdx < modelNames.length - 1) {
            modelIdx++;
            model = makeModel(modelNames[modelIdx]);
          } else {
            throw lastError;
          }
        }
      }
      const cand = result.response.candidates?.[0];
      const parts = cand?.content?.parts || [];
      const calls = parts.filter((p) => p.functionCall).map((p) => p.functionCall);

      if (!calls.length) {
        final = result.response.text();
        break;
      }

      contents.push({ role: 'model', parts });
      const responseParts = [];
      for (const call of calls) {
        const out = await runTool(call.name, call.args || {});
        if (call.name === 'search_website' && Array.isArray(out.results)) {
          out.results.forEach((r) => usedSources.add(r.url));
        }
        if (call.name === 'fetch_page' && out.url) usedSources.add(out.url);
        responseParts.push({
          functionResponse: { name: call.name, response: out },
        });
      }
      contents.push({ role: 'user', parts: responseParts });
    }

    if (!final) final = 'Sorry, I could not compose an answer. Please try rephrasing your question.';

    // Generate 3 concise, relevant follow-up questions based on the conversation.
    let followUps = [];
    try {
      const fuModel = genAI.getGenerativeModel({ model: modelNames[modelIdx] });
      const fuRes = await fuModel.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text:
                  `A visitor to the Nava Nalanda Mahavihara university website asked: "${message}".\n` +
                  `The assistant answered:\n"""${final.slice(0, 1200)}"""\n\n` +
                  `Suggest exactly 3 short, natural follow-up questions the visitor is likely to ask next. ` +
                  `Each must be under 8 words, specific to NNM (admissions, courses, departments, faculty, facilities, fees, notices, etc.), and distinct from the original question. ` +
                  `Return ONLY a JSON array of 3 strings, e.g. ["Q1?","Q2?","Q3?"]. No other text.`,
              },
            ],
          },
        ],
      });
      let raw = fuRes.response.text().trim();
      const match = raw.match(/\[[\s\S]*\]/);
      if (match) {
        const arr = JSON.parse(match[0]);
        if (Array.isArray(arr)) followUps = arr.filter((q) => typeof q === 'string' && q.trim()).slice(0, 3);
      }
    } catch (e) {
      console.warn('followup gen failed:', e.message);
      followUps = [];
    }

    res.json({ reply: final, sources: [...usedSources], followUps, mode: 'agentic' });
  } catch (e) {
    console.error('chat error:', e.message);
    // Never show a hard error to the user — gracefully degrade to retrieval-only.
    const hits = searchKnowledge(message, 4);
    const reply = hits.length
      ? `Here are the most relevant pages on the NNM website for your question:\n\n${hits
          .map((h) => `• ${h.title || h.url}\n  ${h.url}`)
          .join('\n')}\n\n(The AI assistant is briefly busy; these official pages have your answer.)`
      : "I couldn't find that right now. Please check the News & Notices section or contact the university at 8986426478.";
    res.json({ reply, sources: hits.map((h) => h.url), followUps: [], mode: 'retrieval-fallback' });
  }
});

// Collect thumbs up/down feedback (logged for quality tracking).
const feedbackLog = [];
app.post('/api/feedback', (req, res) => {
  const { message, reply, rating } = req.body || {};
  if (!['up', 'down'].includes(rating)) return res.status(400).json({ error: 'invalid rating' });
  feedbackLog.push({ message, reply: String(reply || '').slice(0, 200), rating, at: new Date().toISOString() });
  console.log(`feedback: ${rating === 'up' ? '👍' : '👎'} — "${String(message || '').slice(0, 60)}"`);
  res.json({ ok: true });
});

app.get('/api/health', (_req, res) => res.json({ ok: true, ...knowledgeStats() }));
app.post('/api/reload', (_req, res) => res.json({ pages: reloadKnowledge() }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Nava Nalanda Mahavihara clone running on port ${PORT}`);
  console.log(`  Knowledge base:`, knowledgeStats());
  if (!API_KEY) console.log('  ⚠  No GEMINI_API_KEY set — chatbot runs in retrieval-only mode.\n');
});
