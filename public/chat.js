const fab = document.getElementById('chat-fab');
const panel = document.getElementById('chat-panel');
const closeBtn = document.getElementById('chat-close');
const expandBtn = document.getElementById('chat-expand');
const body = document.getElementById('chat-body');
const input = document.getElementById('chat-text');
const sendBtn = document.getElementById('chat-send');
const chips = document.getElementById('chat-chips');

const history = [];
let busy = false;
let lastUserMessage = '';

function toggle(open) {
  panel.classList.toggle('open', open);
  if (open) {
    if (!body.childElementCount) greet();
    input.focus();
  }
}
fab.addEventListener('click', () => toggle(!panel.classList.contains('open')));
closeBtn.addEventListener('click', () => toggle(false));
expandBtn.addEventListener('click', () => {
  const expanded = panel.classList.toggle('expanded');
  expandBtn.textContent = expanded ? '🗗' : '⛶';
  expandBtn.title = expanded ? 'Shrink' : 'Expand';
  input.focus();
});

// Minimal, safe Markdown renderer (bold, headings, bullets, links, line breaks).
function renderMarkdown(text) {
  let html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Links: [label](url) and bare urls
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  html = html.replace(/(^|[^"=])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  // Headings ### / ####
  html = html.replace(/^#{3,4}\s*(.+)$/gm, '<strong class="md-h">$1</strong>');
  // Bold **text**
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Bullets
  html = html.replace(/^(\s*)[*-]\s+(.+)$/gm, '<li>$2</li>');
  html = html.replace(/(<li>[\s\S]*?<\/li>)/g, (m) => `<ul>${m}</ul>`).replace(/<\/ul>\s*<ul>/g, '');
  // Blockquotes
  html = html.replace(/^&gt;\s*(.+)$/gm, '<div class="md-quote">$1</div>');
  // Remaining newlines
  html = html.replace(/\n/g, '<br>');
  html = html.replace(/(<\/(ul|div)>)<br>/g, '$1');
  return html;
}

function addMsg(text, who, meta = {}) {
  const el = document.createElement('div');
  el.className = `msg ${who}`;
  el.innerHTML = who === 'bot' ? renderMarkdown(text) : renderMarkdown(text);

  if (who === 'bot' && meta.feedback !== false) {
    const fb = document.createElement('div');
    fb.className = 'feedback';
    fb.innerHTML =
      '<span class="fb-label">Was this helpful?</span>' +
      '<button class="fb-btn up" title="Helpful">👍</button>' +
      '<button class="fb-btn down" title="Not helpful">👎</button>';
    const q = meta.question || '';
    fb.querySelector('.up').addEventListener('click', (e) => sendFeedback(e, fb, 'up', q, text));
    fb.querySelector('.down').addEventListener('click', (e) => sendFeedback(e, fb, 'down', q, text));
    el.appendChild(fb);
  }

  body.appendChild(el);
  body.scrollTop = body.scrollHeight;
  return el;
}

async function sendFeedback(e, container, rating, question, reply) {
  container.querySelectorAll('.fb-btn').forEach((b) => (b.disabled = true));
  e.target.classList.add('chosen');
  container.querySelector('.fb-label').textContent =
    rating === 'up' ? 'Thanks for your feedback! 🙏' : 'Thanks — we’ll improve. 🙏';
  try {
    await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: question, reply, rating }),
    });
  } catch { /* non-critical */ }
}

function renderFollowUps(questions) {
  if (!questions || !questions.length) return;
  const wrap = document.createElement('div');
  wrap.className = 'followups';
  wrap.innerHTML = '<div class="fu-title">You might also ask:</div>';
  questions.forEach((q) => {
    const b = document.createElement('button');
    b.className = 'fu-chip';
    b.textContent = q;
    b.addEventListener('click', () => { wrap.remove(); send(q); });
    wrap.appendChild(b);
  });
  body.appendChild(wrap);
  body.scrollTop = body.scrollHeight;
}

function greet() {
  addMsg(
    "Namaste! 🙏 I'm **NalandaMitra**, the AI assistant for Nava Nalanda Mahavihara. " +
    "Ask me anything about **admissions, courses, departments, faculty, facilities or notices** — " +
    "I'll find accurate answers from the official website.",
    'bot',
    { feedback: false }
  );
}

function showTyping() {
  const el = document.createElement('div');
  el.className = 'msg bot typing';
  el.innerHTML = '<span></span><span></span><span></span>';
  body.appendChild(el);
  body.scrollTop = body.scrollHeight;
  return el;
}

async function send(text) {
  text = (text || input.value).trim();
  if (!text || busy) return;
  busy = true;
  lastUserMessage = text;
  input.value = '';
  // Remove any lingering follow-up suggestions
  body.querySelectorAll('.followups').forEach((n) => n.remove());
  addMsg(text, 'user', { feedback: false });
  history.push({ role: 'user', content: text });
  const typing = showTyping();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, history }),
    });
    const data = await res.json();
    typing.remove();
    const reply = data.reply || data.error || 'Sorry, something went wrong.';
    const el = addMsg(reply, 'bot', { question: text });
    if (data.sources && data.sources.length) {
      const s = document.createElement('div');
      s.className = 'src';
      s.innerHTML = '🔗 ' + data.sources.slice(0, 3)
        .map((u) => `<a href="${u}" target="_blank" rel="noopener">${new URL(u).pathname.replace(/\/$/, '') || u}</a>`)
        .join(' · ');
      el.insertBefore(s, el.querySelector('.feedback'));
    }
    history.push({ role: 'assistant', content: reply });
    renderFollowUps(data.followUps);
    // Land on the top of the new answer so the user starts reading from the beginning.
    requestAnimationFrame(() => {
      body.scrollTop = Math.max(0, el.offsetTop - body.offsetTop - 8);
    });
  } catch (e) {
    typing.remove();
    addMsg('⚠️ Could not reach the assistant. Please make sure the server is running.', 'bot', { feedback: false });
  } finally {
    busy = false;
  }
}

sendBtn.addEventListener('click', () => send());
input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
chips.addEventListener('click', (e) => {
  if (e.target.classList.contains('chip')) send(e.target.textContent);
});
