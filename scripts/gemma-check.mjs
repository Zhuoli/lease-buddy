// Runs the real Gemma prompts against the sample lease and records how often the answer passes the verifier.
// Engines: transformers.js (same Gemma 3 1B ONNX model the browser uses) and, if available, Ollama (e.g. gemma4:e2b).
// Usage: node scripts/gemma-check.mjs [--engine=tjs|ollama|both] [--ollama-model=gemma4:e2b]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { analyzeLease, retrieveForQuestion, relevantConflicts, buildQAMessages, buildExplainMessages, verifyAnswer } from '../src/lease.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const which = args.engine || 'both';
const ollamaModel = args['ollama-model'] || 'gemma4:e2b';
const noHints = 'no-hints' in args; // ablation: don't tell Gemma about contradictions found by code
const only = args.only ? args.only.split(',').map(Number) : null; // e.g. --only=0,1,3
const lease = readFileSync(new URL('../samples/sample-lease.txt', import.meta.url), 'utf8');
const A = analyzeLease(lease);

const QUESTIONS = [
  { q: 'How much notice do I need to give before moving out?', mustMention: [60] },
  { q: 'Can my landlord come in whenever they want?', mustMention: [24] },
  { q: 'Will I get my whole deposit back?', mustMention: [300] },
  { q: 'What happens if I pay rent a few days late?', mustMention: [150] },
  { q: 'Can I get a cat?', mustMention: [50] },
  { q: 'What if I need to break the lease?', mustMention: [60] },
  { q: 'Is there a parking spot included?', mustMention: [] },
];

async function tjsEngine() {
  const { pipeline } = await import('@huggingface/transformers');
  const gen = await pipeline('text-generation', 'onnx-community/gemma-3-1b-it-ONNX', { dtype: 'q4' });
  return { name: 'gemma-3-1b-it (ONNX q4, transformers.js, CPU)', chat: async (m) => (await gen(m, { max_new_tokens: 220, do_sample: false }))[0].generated_text.at(-1).content.trim() };
}
async function ollamaEngine() {
  const base = 'http://127.0.0.1:11434';
  return {
    name: `${ollamaModel} (Ollama, CPU)`,
    chat: async (messages) => {
      const r = await fetch(`${base}/api/chat`, { method: 'POST', body: JSON.stringify({ model: ollamaModel, messages, stream: false, think: false, options: { temperature: 0, num_predict: 300 } }) });
      return (await r.json()).message.content.trim();
    },
  };
}

const engines = [];
if (which === 'tjs' || which === 'both') engines.push(await tjsEngine());
if (which === 'ollama' || which === 'both') engines.push(await ollamaEngine());

const report = { date: new Date().toISOString(), lease: 'samples/sample-lease.txt', conflictHints: !noHints, engines: [] };
for (const eng of engines) {
  const rows = [];
  for (const [qi, { q, mustMention }] of QUESTIONS.entries()) {
    if (only && !only.includes(qi)) continue;
    const ctx = retrieveForQuestion(A, q, 3);
    if (!ctx.length) {
      rows.push({ kind: 'qa', q, context: [], answer: '(no matching clause; the app answers "The lease doesn\'t mention that" without calling Gemma)', verified: true, mentionsKeyNumber: mustMention.length === 0, ms: 0 });
      console.log(`\n[${eng.name}] Q: ${q}\n(no clause retrieved, Gemma not called)`);
      continue;
    }
    const t0 = Date.now();
    const answer = await eng.chat(buildQAMessages(q, ctx, noHints ? [] : relevantConflicts(A, q, ctx)));
    const v = verifyAnswer(answer, ctx, A.conflicts);
    const nums = [...answer.matchAll(/\d[\d,]*/g)].map((m) => Number(m[0].replace(/,/g, '')));
    const mentioned = mustMention.every((n) => nums.includes(n));
    rows.push({ kind: 'qa', q, context: ctx.map((c) => c.id), answer, verified: v.ok, unsupportedNumbers: v.unsupportedNumbers, badCitations: v.badCitations, missedConflicts: v.missedConflicts, misattributed: v.misattributed, uncited: v.uncited, mentionsKeyNumber: mentioned, ms: Date.now() - t0 });
    console.log(`\n[${eng.name}] Q: ${q}\n${answer}\n→ verified=${v.ok} key=${mentioned} ${JSON.stringify({ u: v.unsupportedNumbers, b: v.badCitations })}`);
  }
  for (const id of only ? [] : ['13', '5', '9']) {
    const c = A.clauses.find((x) => x.id === id);
    const t0 = Date.now();
    const answer = await eng.chat(buildExplainMessages(c));
    const v = verifyAnswer(`${answer} [§${id}]`, [c]);
    rows.push({ kind: 'explain', clause: id, answer, verified: v.ok, unsupportedNumbers: v.unsupportedNumbers, ms: Date.now() - t0 });
    console.log(`\n[${eng.name}] Explain §${id}\n${answer}\n→ verified=${v.ok}`);
  }
  const qa = rows.filter((r) => r.kind === 'qa');
  report.engines.push({
    engine: eng.name,
    qaVerified: `${qa.filter((r) => r.verified).length}/${qa.length}`,
    qaMentionsKeyNumber: `${qa.filter((r) => r.mentionsKeyNumber).length}/${qa.length}`,
    explainVerified: `${rows.filter((r) => r.kind === 'explain' && r.verified).length}/3`,
    rows,
  });
}
mkdirSync(new URL('../results/', import.meta.url), { recursive: true });
const out = new URL(`../results/gemma-check-${which}${noHints ? '-nohints' : ''}${only ? '-subset' : ''}.json`, import.meta.url);
writeFileSync(out, JSON.stringify(report, null, 2));
console.log('\nSUMMARY', report.engines.map((e) => `${e.engine}: QA verified ${e.qaVerified}, key number ${e.qaMentionsKeyNumber}, explain ${e.explainVerified}`).join(' | '));
