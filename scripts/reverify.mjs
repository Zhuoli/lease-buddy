// Re-run the (deterministic) verifier over saved Gemma answers without calling a model again.
import { readFileSync, writeFileSync } from 'node:fs';
import { analyzeLease, retrieveForQuestion, verifyAnswer } from '../src/lease.js';
const A = analyzeLease(readFileSync(new URL('../samples/sample-lease.txt', import.meta.url), 'utf8'));
for (const f of process.argv.slice(2)) {
  const rep = JSON.parse(readFileSync(f, 'utf8'));
  for (const e of rep.engines) {
    for (const r of e.rows) {
      if (r.kind === 'qa' && r.context.length) {
        const ctx = retrieveForQuestion(A, r.q, 3);
        const v = verifyAnswer(r.answer, ctx, A.conflicts);
        Object.assign(r, { verified: v.ok, unsupportedNumbers: v.unsupportedNumbers, badCitations: v.badCitations, missedConflicts: v.missedConflicts, misattributed: v.misattributed });
      } else if (r.kind === 'explain') {
        const c = A.clauses.find((x) => x.id === r.clause);
        const v = verifyAnswer(`${r.answer} [§${r.clause}]`, [c]);
        Object.assign(r, { verified: v.ok, unsupportedNumbers: v.unsupportedNumbers });
      }
    }
    const qa = e.rows.filter((r) => r.kind === 'qa');
    e.qaVerified = `${qa.filter((r) => r.verified).length}/${qa.length}`;
    { const ex = e.rows.filter((r) => r.kind === 'explain'); e.explainVerified = ex.length ? `${ex.filter((r) => r.verified).length}/${ex.length}` : 'not run'; }
    console.log(e.engine, 'QA verified', e.qaVerified, 'explain', e.explainVerified);
    for (const r of qa) if (!r.verified) console.log('  ✗', r.q, JSON.stringify({ mis: r.misattributed, miss: r.missedConflicts?.map((m) => m.missing.map((x) => x.clause)), u: r.unsupportedNumbers, b: r.badCitations }));
  }
  writeFileSync(f, JSON.stringify(rep, null, 2));
}
