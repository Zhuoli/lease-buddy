import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseNumberWord, splitClauses, extractFacts, findConflicts, keyDates, findFlags, analyzeLease,
  retrieve, retrieveForQuestion, relevantConflicts, verifyAnswer, numbersIn, makeIcs, addDays, buildQAMessages,
} from '../src/lease.js';

const SAMPLE = readFileSync(new URL('../samples/sample-lease.txt', import.meta.url), 'utf8');
const A = analyzeLease(SAMPLE);
const fact = (slot) => A.facts.filter((f) => f.slot === slot).map((f) => [f.value, f.clause]);

test('number words', () => {
  assert.equal(parseNumberWord('sixty (60)'), 60);
  assert.equal(parseNumberWord('twenty-four'), 24);
  assert.equal(parseNumberWord('$1,250'), 1250);
  assert.equal(parseNumberWord('one hundred'), 100);
  assert.equal(parseNumberWord('banana'), null);
});

test('splits numbered clauses and addendum clauses', () => {
  const ids = A.clauses.map((c) => c.id);
  assert.deepEqual(ids, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', 'A1', 'A2', 'A3']);
  assert.equal(A.clauses.find((c) => c.id === '13').title, 'RENEWAL');
  // "10:00 PM" inside a clause must not start a new clause
  assert.match(A.clauses.find((c) => c.id === 'A1').text, /10:00 PM to 7:00 AM/);
});

test('falls back to paragraphs for unnumbered text', () => {
  const c = splitClauses('Rent is $900 per month.\n\nNo pets.');
  assert.equal(c.length, 2);
  assert.equal(c[0].id, 'P1');
});

test('extracts the key facts with clause citations', () => {
  assert.deepEqual(fact('monthly_rent'), [[2150, '3']]);
  assert.deepEqual(fact('rent_due_day'), [[1, '3']]);
  assert.deepEqual(fact('security_deposit'), [[2150, '5']]);
  assert.deepEqual(fact('start_date'), [['2026-11-01', '2']]);
  assert.deepEqual(fact('end_date'), [['2027-10-31', '2']]);
  assert.deepEqual(fact('late_fee'), [[150, '4']]);
  assert.deepEqual(fact('daily_late_fee'), [[15, '4']]);
  assert.deepEqual(fact('early_termination_fee_months'), [[2, '12']]);
  assert.deepEqual(fact('non_refundable_fee'), [[300, '5'], [400, '10']]);
  assert.deepEqual(fact('auto_renewal'), [[true, '13']]);
});

test('pet rent is not mistaken for monthly rent', () => {
  assert.ok(!fact('monthly_rent').some(([v]) => v === 50));
});

test('early-termination notice is kept separate from end-of-term notice', () => {
  assert.deepEqual(fact('early_termination_notice'), [[60, '12']]);
  assert.deepEqual(fact('end_of_term_notice'), [[60, '13'], [30, '14']]);
});

test('finds exactly the three planted contradictions', () => {
  const got = Object.fromEntries(A.conflicts.map((c) => [c.slot, c.facts.map((f) => `${f.value}@${f.clause}`).sort()]));
  assert.deepEqual(got, {
    end_of_term_notice: ['30@14', '60@13'],
    entry_notice: ['24@A2', 'unspecified@9'],
    late_from_day: ['4@A3', '6@4'],
  });
});

test('no false conflicts on a consistent lease', () => {
  const clean = `1. TERM. The term begins on January 1, 2027 and ends on December 31, 2027.
2. RENT. Tenant shall pay monthly rent of $1,500 per month, due on the 1st day of each month.
3. NOTICE TO VACATE. Tenant shall give at least thirty (30) days' written notice before vacating.
4. ENTRY. Landlord will give at least 48 hours' notice before entering, except emergencies.`;
  const r = analyzeLease(clean);
  assert.equal(r.conflicts.length, 0);
  assert.equal(r.flags.length, 0);
  assert.equal(r.dates[0].date, '2027-12-01');
});

test('notice deadline uses the stricter (earlier) date and shows both', () => {
  const d = A.dates.find((x) => x.id === 'notice-deadline');
  assert.equal(d.date, '2027-09-01'); // 60 days before 2027-10-31
  assert.deepEqual(d.alternatives.map((a) => a.date), ['2027-09-01', '2027-10-01']);
  assert.equal(A.dates.find((x) => x.id === 'increase-notice').date, '2027-10-02'); // 30 days before Nov 1, 2027
});

test('date math crosses months, years and leap days', () => {
  assert.equal(addDays('2027-10-31', -60), '2027-09-01');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('manual end date overrides a missing one', () => {
  const r = analyzeLease('1. RENEWAL. This Lease shall automatically renew unless notice is given at least sixty (60) days before the end of the term.', { endDate: '2027-06-30' });
  assert.equal(r.dates[0].date, '2027-05-01');
});

test('flags are tied to clauses and phrased as questions', () => {
  const ids = A.flags.map((f) => f.id);
  for (const id of ['auto-renewal', 'late-fee', 'early-term', 'repairs', 'entry-9', 'fees-16']) assert.ok(ids.includes(id), id);
  const late = A.flags.find((f) => f.id === 'late-fee');
  assert.match(late.title, /7% of rent plus \$15\/day/);
  assert.match(A.flags.find((f) => f.id === 'early-term').title, /\$4,300/);
  for (const f of A.flags) assert.match(f.ask, /\?$/);
});

test('retrieval finds the right clauses for tenant-language questions', () => {
  assert.ok(retrieve(A.clauses, 'Can I get a dog?').map((c) => c.id).includes('10'));
  assert.equal(retrieve(A.clauses, 'What if I need to break the lease?')[0].id, '12');
  assert.ok(retrieve(A.clauses, 'Will I get my deposit back?').map((c) => c.id).includes('5'));
});

test('conflict-aware retrieval pulls in the contradicting clause', () => {
  const ids = retrieveForQuestion(A, 'How much notice do I need to give before moving out?').map((c) => c.id);
  assert.ok(ids.includes('13') && ids.includes('14'));
  const entry = retrieveForQuestion(A, 'Can my landlord come in whenever they want?').map((c) => c.id);
  assert.ok(entry.includes('9') && entry.includes('A2'));
});

test('prompt tells Gemma about contradictions found by code', () => {
  const q = 'How much notice do I need to give before moving out?';
  const ctx = retrieveForQuestion(A, q);
  const confs = relevantConflicts(A, q, ctx);
  assert.deepEqual(confs.map((c) => c.slot), ['end_of_term_notice']);
  const m = buildQAMessages(q, ctx, confs)[1].content;
  assert.match(m, /contradict/);
  assert.match(m, /\[§13\] ".*sixty \(60\) days/);
  assert.equal(relevantConflicts(A, 'Will I get my whole deposit back?', retrieveForQuestion(A, 'Will I get my whole deposit back?')).length, 0);
});

test('prompt contains only the provided clauses', () => {
  const ctx = A.clauses.filter((c) => ['13', '14'].includes(c.id));
  const m = buildQAMessages('notice?', ctx);
  assert.match(m[1].content, /\[§13\]/);
  assert.doesNotMatch(m[1].content, /\[§5\]/);
});

test('numbersIn normalizes digits, dollars and words', () => {
  assert.deepEqual([...numbersIn('sixty (60) days and $2,150')].sort((a, b) => a - b), [60, 2150]);
  assert.ok(numbersIn('thirty days').has(30));
});

test('verifier accepts a grounded answer', () => {
  const ctx = A.clauses.filter((c) => ['13', '14'].includes(c.id));
  const v = verifyAnswer('Your lease says 60 days for non-renewal [§13] but 30 days to vacate [§14]. Give 60 days to be safe.', ctx);
  assert.equal(v.ok, true);
});

test('verifier catches invented numbers and citations', () => {
  const ctx = A.clauses.filter((c) => ['13', '14'].includes(c.id));
  const v = verifyAnswer('You need 45 days notice [§13], see also [§22].', ctx);
  assert.equal(v.ok, false);
  assert.deepEqual(v.unsupportedNumbers, [45]);
  assert.deepEqual(v.badCitations, ['22']);
});

test('verifier traces each number to the clause that contains it', () => {
  const ctx = A.clauses.filter((c) => ['3', '4', 'A3'].includes(c.id));
  const v = verifyAnswer('A late fee of $150 applies [§4]. Rent is $2,150.', ctx);
  assert.equal(v.ok, true);
  assert.deepEqual(v.trace.find((t) => t.n === 2150).clauses, ['3']);
  assert.deepEqual(v.trace.find((t) => t.n === 150).clauses, ['4']);
});

test('verifier catches a number cited to the wrong clause', () => {
  const ctx = A.clauses.filter((c) => ['13', '14'].includes(c.id));
  const v = verifyAnswer('You need to give thirty days notice, as stated in [§13]. Non-renewal needs sixty days [§14].', ctx);
  assert.equal(v.ok, false);
  assert.deepEqual(v.misattributed.map((m) => [m.n, m.actual]), [[30, ['14']], [60, ['13']]]);
});

test('a tag placed after the period still counts for the previous sentence', () => {
  const ctx = A.clauses.filter((c) => ['3', '4', 'A3'].includes(c.id));
  assert.equal(verifyAnswer('A late fee of $150 applies after the 5th. [§4] Rent is $2,150 a month [§3].', ctx).ok, true);
  const wrong = verifyAnswer('A late fee of $150 applies after the 5th. [§A3] Rent is $2,150 a month. [§3]', ctx);
  assert.deepEqual(wrong.misattributed.map((m) => m.n).sort((a, b) => a - b), [5, 150]);
});

test('verifier catches an answer that hides one side of a contradiction', () => {
  const ctx = retrieveForQuestion(A, 'How much notice do I need to give before moving out?');
  const oneSided = verifyAnswer('You need to give 30 days of written notice [§14].', ctx, A.conflicts);
  assert.equal(oneSided.ok, false);
  assert.deepEqual(oneSided.missedConflicts.map((m) => m.missing.map((x) => x.clause)), [['13']]);
  const both = verifyAnswer('§14 says 30 days, but §13 says 60 days before the end of the term. Use 60 to be safe.', ctx, A.conflicts);
  assert.deepEqual(both.missedConflicts, []);
  assert.equal(both.ok, true);
});

test('verifier flags uncited answers but accepts "the lease doesn\'t say"', () => {
  const ctx = A.clauses.filter((c) => c.id === '10');
  assert.equal(verifyAnswer('Yes you can.', ctx).uncited, true);
  assert.equal(verifyAnswer("The lease doesn't say.", ctx).ok, true);
});

test('ics has one all-day event per date with reminders', () => {
  const ics = makeIcs(A.dates, { now: new Date('2026-10-03T12:00:00Z') });
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, A.dates.length);
  assert.match(ics, /DTSTART;VALUE=DATE:20270901/);
  assert.match(ics, /TRIGGER:-P7D/);
  assert.ok(ics.includes('\r\n'));
});
