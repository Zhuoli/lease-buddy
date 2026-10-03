import {
  analyzeLease, slotLabel, fmtValue, retrieveForQuestion, buildQAMessages, buildExplainMessages,
  verifyAnswer, makeIcs, conflictQuestion, relevantConflicts,
} from './lease.js';
import { BrowserGemma, OllamaGemma } from './engines.js';

const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(String(k)));
  return n;
};

let analysis = null;
let engine = null;
const fmtDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });

$('#load-sample').addEventListener('click', async () => {
  $('#lease').value = await (await fetch('./samples/sample-lease.txt')).text();
  run();
});

$('#file').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) {
    const pdfjs = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
    const doc = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise;
    let text = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((it) => it.str + (it.hasEOL ? '\n' : '')).join('') + '\n';
    }
    $('#lease').value = text;
  } else {
    $('#lease').value = await f.text();
  }
  run();
});

$('#analyze').addEventListener('click', run);

function run() {
  const text = $('#lease').value;
  if (!text.trim()) return;
  analysis = analyzeLease(text, { endDate: $('#end-date').value || undefined });
  render();
  $('#results').hidden = false;
  $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function render() {
  const { facts, conflicts, flags, dates, questions, clauses } = analysis;
  // Terms
  const order = ['monthly_rent', 'rent_due_day', 'late_from_day', 'late_fee', 'security_deposit', 'start_date', 'end_date', 'end_of_term_notice', 'early_termination_fee_months', 'entry_notice'];
  const terms = $('#terms');
  terms.replaceChildren();
  for (const slot of order) {
    const list = facts.filter((f) => f.slot === slot);
    if (!list.length) continue;
    const vals = [...new Set(list.map((f) => (f.unit === 'date' ? fmtDate(f.value) : fmtValue(f))))];
    terms.append(el('div', { class: 'term' },
      el('div', { class: 'k' }, slotLabel(slot)),
      el('div', { class: 'v' }, vals.join(' / '), vals.length > 1 ? ' ⚠️' : ''),
      el('div', { class: 'c' }, list.map((f) => `§${f.clause}`).join(', '))));
  }
  if (!terms.children.length) terms.append(el('p', { class: 'sub' }, `Found ${clauses.length} clauses, but no standard terms. Try a lease with numbered sections.`));

  // Conflicts
  $('#conflicts-card').hidden = conflicts.length === 0;
  $('#conflicts').replaceChildren(...conflicts.map((c) => el('div', { class: 'conflict' },
    el('strong', {}, c.label),
    el('div', { class: 'sides' }, c.facts.map((f) => el('div', {}, el('div', {}, `§${f.clause}${f.title ? ' ' + f.title : ''}: `, el('strong', {}, f.unit === 'date' ? fmtDate(f.value) : fmtValue(f))), el('blockquote', {}, f.quote)))),
    el('div', { class: 'sub' }, '→ ', conflictQuestion(c)))));

  // Dates
  $('#dates').replaceChildren(...(dates.length ? dates.map((d) => el('div', {},
    el('div', { class: 'date' }, el('span', { class: 'd' }, fmtDate(d.date)), el('span', {}, d.label)),
    el('div', { class: 'b' }, `Based on ${d.basis}.`),
    d.alternatives.length ? el('div', { class: 'b' }, `The lease gives different numbers: ${d.alternatives.map((a) => `${a.days} days (§${a.clause}) → ${fmtDate(a.date)}`).join(' vs ')}. Lease Buddy uses the earliest date to be safe.`) : null))
    : [el('p', { class: 'sub' }, 'No end date found. Enter it above to compute your notice deadline.')]));
  $('#ics').hidden = dates.length === 0;

  // Flags
  $('#flags').replaceChildren(...(flags.length ? flags.map((f) => el('div', { class: 'flag' },
    el('div', {}, el('span', { class: `sev ${f.severity}` }, f.severity), el('strong', {}, f.title), ` (§${f.clause})`),
    el('div', { class: 'sub' }, f.why),
    el('button', { class: 'secondary explain', onclick: () => explainClause(f.clause) }, `Explain §${f.clause} in plain words`)))
    : [el('p', { class: 'sub' }, 'Nothing unusual found by the rule checks.')]));

  // Questions
  $('#questions').replaceChildren(...questions.map((q) => el('li', {}, q)));

  // Suggested questions
  const sugg = ['How much notice do I need to give before moving out?', 'Can my landlord come in whenever they want?', 'Will I get my whole deposit back?', 'What happens if I pay rent a few days late?', 'Can I get a cat?', 'What if I need to break the lease?'];
  $('#chips').replaceChildren(...sugg.map((s) => el('button', { onclick: () => { $('#question').value = s; ask(); } }, s)));
}

$('#ics').addEventListener('click', () => {
  const blob = new Blob([makeIcs(analysis.dates)], { type: 'text/calendar' });
  const a = el('a', { href: URL.createObjectURL(blob), download: 'lease-dates.ics' });
  document.body.append(a); a.click(); a.remove();
});

$('#copy-questions').addEventListener('click', async () => {
  const text = analysis.questions.map((q, i) => `${i + 1}. ${q}`).join('\n');
  await navigator.clipboard.writeText(text);
  $('#copy-questions').textContent = 'Copied ✓';
  setTimeout(() => { $('#copy-questions').textContent = 'Copy questions'; }, 1500);
});

for (const r of document.querySelectorAll('input[name=engine]')) r.addEventListener('change', () => { $('#ollama-opts').hidden = r.value !== 'ollama' || !r.checked; });

$('#load-model').addEventListener('click', async () => {
  const choice = document.querySelector('input[name=engine]:checked').value;
  const status = $('#model-status');
  const bar = $('#model-progress');
  $('#load-model').disabled = true;
  try {
    if (choice === 'ollama') {
      engine = new OllamaGemma({ baseUrl: $('#ollama-url').value, model: $('#ollama-model').value });
      status.textContent = 'Connecting to Ollama…';
      await engine.load();
    } else {
      const files = new Map();
      engine = new BrowserGemma({
        onProgress: (p) => {
          if (p.status === 'progress' && p.total) {
            files.set(p.file, [p.loaded, p.total]);
            const [l, t] = [...files.values()].reduce((a, b) => [a[0] + b[0], a[1] + b[1]], [0, 0]);
            bar.hidden = false; bar.value = (l / t) * 100;
            status.textContent = `Downloading Gemma once (cached afterwards): ${(l / 1e6).toFixed(0)} / ${(t / 1e6).toFixed(0)} MB`;
          } else if (p.status === 'ready') status.textContent = 'Warming up Gemma…';
          else if (p.status === 'fallback') status.textContent = 'This GPU can\'t run the model, so I\'m switching to the CPU (slower, still private)…';
        },
      });
      status.textContent = 'Loading Gemma…';
      const forced = new URLSearchParams(location.search).get('device'); // ?device=wasm forces the CPU path
      await engine.load(forced === 'wasm' || forced === 'webgpu' ? { forceDevice: forced } : {});
      bar.hidden = true;
    }
    status.textContent = `✅ Ready: ${engine.label}. Your lease stays on this device.`;
    $('#ask').disabled = false;
  } catch (err) {
    status.textContent = `Couldn't start Gemma: ${err.message}. The rule checks above still work without it.`;
    $('#load-model').disabled = false;
  }
});

$('#ask').addEventListener('click', ask);
$('#question').addEventListener('keydown', (e) => { if (e.key === 'Enter') ask(); });

function answerBox(title, ctx, conflicts = []) {
  const body = el('div', { class: 'body' }, '…');
  const check = el('div', { class: 'check' });
  const facts = conflicts.length ? el('div', { class: 'facts' }, '📌 From the rule checker (not the model): ', conflicts.map((c) => `${c.label}: ${c.facts.map((f) => `§${f.clause} says ${f.unit === 'date' ? f.value : fmtValue(f)}`).join(' but ')}.`).join(' ')) : null;
  const src = el('details', {}, el('summary', {}, `Clauses Gemma saw (${ctx.map((c) => '§' + c.id).join(', ')})`), ctx.map((c) => el('blockquote', {}, `§${c.id} ${c.full || c.text}`)));
  const box = el('div', { class: 'answer' }, el('div', { class: 'q' }, title), facts, body, check, src);
  $('#answers').prepend(box);
  return { body, check };
}

async function generate(title, messages, ctx, conflicts = []) {
  if (!engine) { $('#model-status').textContent = 'Start Gemma first (button above).'; return; }
  const { body, check } = answerBox(title, ctx, conflicts);
  let streamed = '';
  try {
    const text = await engine.chat(messages, { onToken: (t) => { streamed += t; body.textContent = streamed; } });
    body.textContent = text;
    const v = verifyAnswer(text, ctx, analysis.conflicts);
    const traced = v.trace.filter((t) => t.clauses.length).map((t) => `${t.n} → §${t.clauses.join('/§')}`);
    if (v.ok) {
      check.className = 'check ok';
      check.textContent = `✓ No made-up numbers or citations found${traced.length ? ` (${traced.join(', ')})` : ''}. The code can't check meaning, so skim the clauses below.`;
    } else {
      check.className = 'check bad';
      const bits = [];
      if (v.unsupportedNumbers.length) bits.push(`these numbers are not in any clause Gemma saw: ${v.unsupportedNumbers.join(', ')}`);
      if (v.badCitations.length) bits.push(`it cites clauses it wasn't given: ${v.badCitations.map((c) => '§' + c).join(', ')}`);
      for (const m of v.misattributed) bits.push(`${m.n} is in §${m.actual.join('/§')}, not §${m.cited.join('/§')}`);
      for (const m of v.missedConflicts) bits.push(`it left out the other side of a contradiction: ${m.missing.map((x) => `§${x.clause} says "${x.quote}"`).join('; ')}`);
      if (!bits.length && v.uncited) bits.push('it cited nothing');
      check.textContent = `⚠️ Double-check this answer: ${bits.join('. ')}. The clauses are below.`;
    }
  } catch (err) {
    body.textContent = `Error: ${err.message}`;
  }
}

async function ask() {
  const q = $('#question').value.trim();
  if (!q || !analysis) return;
  const ctx = retrieveForQuestion(analysis, q, 3);
  if (!ctx.length) { answerBox(q, []).body.textContent = "I couldn't find any clause about that, so I didn't ask Gemma. The lease probably doesn't mention it; ask the landlord to put it in writing."; return; }
  const confs = relevantConflicts(analysis, q, ctx);
  await generate(q, buildQAMessages(q, ctx, confs), ctx, confs);
}

async function explainClause(id) {
  const c = analysis.clauses.find((x) => x.id === id);
  if (!c) return;
  document.querySelector('.gemma').scrollIntoView({ behavior: 'smooth' });
  await generate(`Explain §${id}${c.title ? ' ' + c.title : ''}`, buildExplainMessages(c), [c]);
}
