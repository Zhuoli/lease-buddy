// Lease Buddy core: pure, deterministic functions shared by the browser app and Node tests.
// No network, no model. Gemma only ever *explains*; every fact shown as a fact comes from here.

const WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};

/** "sixty (60)" -> 60, "twenty-four" -> 24, "30" -> 30, "1,250" -> 1250. Returns null if not a number. */
export function parseNumberWord(s) {
  if (s == null) return null;
  const t = String(s).trim().toLowerCase();
  const paren = t.match(/\((\d[\d,]*)\)/);
  if (paren) return Number(paren[1].replace(/,/g, ''));
  if (/^\$?\d[\d,]*(\.\d+)?$/.test(t)) return Number(t.replace(/[$,]/g, ''));
  const parts = t.split(/[\s-]+/).filter(Boolean);
  if (!parts.length || !parts.every((p) => p in WORDS)) return null;
  let total = 0;
  for (const p of parts) total = p === 'hundred' ? (total || 1) * 100 : total + WORDS[p];
  return total;
}

const NUM = String.raw`(?:(?:[a-z]+(?:-[a-z]+)?)\s*\(\d[\d,]*\)|\d[\d,]*|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:-[a-z]+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen)`;

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Split lease text into numbered clauses. Supports "12.", "12)", "Section 12", "A1." addendum ids. */
export function splitClauses(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const head = /^\s*(?:section\s+)?((?:[A-Z]{1,2})?\d+(?:\.\d+)*)[.)]?\s+(?:([A-Z][A-Z0-9 &'’/,-]{2,60}?)[.:]\s*)?(.*)$/;
  const clauses = [];
  let cur = null;
  let preamble = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    const m = line.match(head);
    const looksLikeClause = m && (m[2] || /[.)]/.test(line.slice(0, line.indexOf(m[1]) + m[1].length + 1)) || /^\s*section\s/i.test(line));
    if (m && looksLikeClause && !/^\s*\d+\s*(am|pm)\b/i.test(line)) {
      if (cur) clauses.push(cur);
      cur = { id: m[1], title: (m[2] || '').trim(), text: (m[3] || '').trim() };
    } else if (cur) {
      if (line.trim() === '') continue;
      if (/^[A-Z][A-Z0-9 —–&'’-]{6,}$/.test(line.trim())) { clauses.push(cur); cur = null; preamble.push(line.trim()); continue; }
      cur.text += (cur.text ? ' ' : '') + line.trim();
    } else if (line.trim()) {
      preamble.push(line.trim());
    }
  }
  if (cur) clauses.push(cur);
  if (!clauses.length && String(text || '').trim()) {
    // Unnumbered lease: fall back to paragraphs, numbered P1, P2, ...
    return String(text).split(/\n\s*\n/).map((p, i) => ({ id: `P${i + 1}`, title: '', text: p.replace(/\s+/g, ' ').trim() })).filter((c) => c.text);
  }
  return clauses.map((c) => ({ ...c, full: `${c.title ? c.title + '. ' : ''}${c.text}` }));
}

const TOPICS = {
  term: /\bterm of this lease\b|\bbegins on\b|\bends on\b|\bcommenc/i,
  rent: /\brent\b/i,
  late: /\blate (fee|charge)|\blate\b.*\brent\b|\brent\b.*\blate\b/i,
  deposit: /\bsecurity deposit\b|\bdeposit\b/i,
  fees: /\bnon-?refundable\b|\bfee\b/i,
  entry: /\benter(ing)?\b|\bentry\b|\baccess to the (unit|premises)\b/i,
  repairs: /\brepair|maintenance\b/i,
  pets: /\bpets?\b/i,
  sublet: /\bsublet|\bassign/i,
  renewal: /\brenew/i,
  vacate: /\bvacat|\bmove[- ]out\b|\bnon-renewal\b/i,
  early_termination: /\bearly termination\b|\bend this lease before\b|\bbreak (the|this) lease\b/i,
  increase: /\bincrease\b/i,
  legal: /\battorney|\bcourt costs\b|\blegal action\b/i,
  utilities: /\butilit|\belectricity\b|\bwater\b|\btrash\b/i,
  guests: /\bguests?\b|\boccupan/i,
};

export function topicsOf(clause) {
  const s = `${clause.title} ${clause.text}`;
  return Object.keys(TOPICS).filter((k) => TOPICS[k].test(s));
}

function money(s) { return Number(String(s).replace(/[$,]/g, '')); }

function findDays(text) {
  const re = new RegExp(`(${NUM})\\s*(?:calendar\\s+|business\\s+)?(days?|hours?|months?)(?:['’]s?)?`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(text))) {
    const n = parseNumberWord(m[1]);
    if (n != null) out.push({ n, unit: m[2].toLowerCase().replace(/s$/, ''), raw: m[0], index: m.index });
  }
  return out;
}

function findDate(text) {
  const re = new RegExp(`(${MONTHS.join('|')})\\s+(\\d{1,2}),?\\s+(\\d{4})`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(text))) {
    const mo = MONTHS.indexOf(m[1].toLowerCase()) + 1;
    out.push({ iso: `${m[3]}-${String(mo).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`, raw: m[0], index: m.index });
  }
  return out;
}

const ordinalDay = /\b(\d{1,2})(?:st|nd|rd|th)\s+(?:day\s+)?(?:of\s+(?:the|each)\s+month|day)/i;

/**
 * Extract "facts": each fact is {slot, value, unit, clause, quote}. A slot is something that
 * should have exactly one value in a lease (e.g. notice to vacate). Multiple values = conflict.
 */
export function extractFacts(clauses) {
  const facts = [];
  const add = (slot, value, unit, c, quote) => facts.push({ slot, value, unit, clause: c.id, title: c.title, quote: quote.trim() });
  for (const c of clauses) {
    const t = c.full || c.text;
    const topics = topicsOf(c);
    // Lease term dates
    if (topics.includes('term')) {
      const ds = findDate(t);
      const begins = t.match(/begins?\s+on\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i);
      const ends = t.match(/(?:ends?|expires?|terminates?)\s+on\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i);
      if (begins) add('start_date', findDate(begins[1])[0]?.iso, 'date', c, begins[0]);
      if (ends) add('end_date', findDate(ends[1])[0]?.iso, 'date', c, ends[0]);
      if (!begins && !ends && ds.length === 2) { add('start_date', ds[0].iso, 'date', c, ds[0].raw); add('end_date', ds[1].iso, 'date', c, ds[1].raw); }
    }
    // Monthly rent amount (skip pet rent / fees)
    const rentM = t.match(/(?<!pet\s)\brent\s+of\s+\$\s?([\d,]+(?:\.\d{2})?)\s*(?:per month|\/\s?month|a month|monthly)?/i)
      || t.match(/\$\s?([\d,]+(?:\.\d{2})?)\s*(?:per month|\/\s?month)[^.]*\bas rent\b/i);
    if (rentM && !/\bpet rent\b/i.test(rentM[0])) add('monthly_rent', money(rentM[1]), 'usd', c, rentM[0]);
    // Rent due day
    if (topics.includes('rent') && /\bdue\b/i.test(t)) {
      const d = t.match(new RegExp(`due\\s+(?:on\\s+)?(?:the\\s+)?${ordinalDay.source}`, 'i'));
      if (d) add('rent_due_day', Number(d[1]), 'day_of_month', c, d[0]);
    }
    // When rent becomes late
    const lateAfter = t.match(/(?:not received by|received after|paid after|late (?:if|when) (?:not )?(?:paid|received) (?:by|after))\s+the\s+(\d{1,2})(?:st|nd|rd|th)/i);
    if (lateAfter) {
      // "not received by the 5th" => late from the 6th; "received after the 3rd" => late from the 4th
      add('late_from_day', Number(lateAfter[1]) + 1, 'day_of_month', c, lateAfter[0]);
    }
    // Late fee
    const lf = t.match(/late (?:fee|charge)s?\s+of\s+\$\s?([\d,]+)/i);
    if (lf) add('late_fee', money(lf[1]), 'usd', c, lf[0]);
    const daily = t.match(/\$\s?([\d,]+)\s+per day/i);
    if (daily && topics.includes('late')) add('daily_late_fee', money(daily[1]), 'usd_per_day', c, daily[0]);
    // Security deposit
    const dep = t.match(/security deposit\s+of\s+\$\s?([\d,]+)/i);
    if (dep) add('security_deposit', money(dep[1]), 'usd', c, dep[0]);
    // Entry notice
    if (topics.includes('entry') && /\benter|entering|entry\b/i.test(t)) {
      const hrs = findDays(t).find((d) => d.unit === 'hour');
      if (hrs && /notice/i.test(t)) add('entry_notice', hrs.n, 'hours', c, sentenceAround(t, hrs.index));
      else if (/reasonable notice|at any time/i.test(t)) add('entry_notice', 'unspecified', 'hours', c, sentenceAround(t, t.search(/reasonable notice|at any time/i)));
    }
    // Notice before leaving at end of term (non-renewal / vacate). Early termination is its own slot.
    if ((topics.includes('renewal') || topics.includes('vacate')) && !topics.includes('early_termination') && /notice/i.test(t) && !/\bincrease\b/i.test(t)) {
      const d = findDays(t).find((x) => x.unit === 'day');
      if (d) add('end_of_term_notice', d.n, 'days', c, sentenceAround(t, d.index));
    }
    if (topics.includes('early_termination')) {
      const d = findDays(t).find((x) => x.unit === 'day');
      if (d) add('early_termination_notice', d.n, 'days', c, sentenceAround(t, d.index));
      const fee = t.match(new RegExp(`fee equal to\\s+(${NUM})\\s+months?['’]?\\s+rent`, 'i'));
      if (fee) add('early_termination_fee_months', parseNumberWord(fee[1]), 'months_rent', c, fee[0]);
    }
    if (topics.includes('increase') && /notice/i.test(t)) {
      const d = findDays(t).find((x) => x.unit === 'day');
      if (d) add('rent_increase_notice', d.n, 'days', c, sentenceAround(t, d.index));
    }
    if (topics.includes('renewal') && /automatic(ally)?\s+renew|auto-?renew/i.test(t)) add('auto_renewal', true, 'bool', c, sentenceAround(t, t.search(/automatic|auto-?renew/i)));
    const nonref = [...t.matchAll(/(?:([a-z]+(?: [a-z]+)?) fee of \$\s?([\d,]+) is non-?refundable|non-?refundable ([a-z]+ )?fee of \$\s?([\d,]+))/gi)];
    for (const n of nonref) add('non_refundable_fee', money(n[2] || n[4]), 'usd', c, n[0]);
    const repair = t.match(/(?:cost of )?any repair under \$\s?([\d,]+)/i);
    if (repair) add('tenant_repair_threshold', money(repair[1]), 'usd', c, sentenceAround(t, repair.index));
  }
  return facts;
}

function sentenceAround(t, idx) {
  if (idx < 0) idx = 0;
  const start = Math.max(t.lastIndexOf('. ', idx) + 1, 0);
  let end = t.indexOf('. ', idx);
  end = end === -1 ? t.length : end + 1;
  return t.slice(start, end).trim();
}

const SLOT_LABEL = {
  start_date: 'Lease starts', end_date: 'Lease ends', monthly_rent: 'Monthly rent', rent_due_day: 'Rent due',
  late_from_day: 'When rent counts as late', late_fee: 'Late fee', daily_late_fee: 'Extra late fee per day',
  security_deposit: 'Security deposit', entry_notice: 'Notice before landlord enters', end_of_term_notice: 'Notice to leave at end of term',
  early_termination_notice: 'Notice to break the lease early', early_termination_fee_months: 'Early termination fee',
  rent_increase_notice: 'Notice before a rent increase', auto_renewal: 'Auto-renews', non_refundable_fee: 'Non-refundable fee',
  tenant_repair_threshold: 'You pay for repairs under',
};
export const slotLabel = (s) => SLOT_LABEL[s] || s;

const MULTI_OK = new Set(['non_refundable_fee']);

/** Two or more clauses give different values for the same slot. */
export function findConflicts(facts) {
  const by = new Map();
  for (const f of facts) {
    if (MULTI_OK.has(f.slot)) continue;
    if (!by.has(f.slot)) by.set(f.slot, []);
    by.get(f.slot).push(f);
  }
  const conflicts = [];
  for (const [slot, list] of by) {
    const values = [...new Set(list.map((f) => String(f.value)))];
    if (values.length > 1) conflicts.push({ slot, label: slotLabel(slot), facts: list });
  }
  return conflicts;
}

/** Strictest reading for a slot where the tenant must act early (bigger notice = stricter). */
export function strictest(facts, slot) {
  const list = facts.filter((f) => f.slot === slot && typeof f.value === 'number');
  if (!list.length) return null;
  return list.reduce((a, b) => (b.value > a.value ? b : a));
}

export function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Key dates the friend must not miss, computed (not guessed). */
export function keyDates(facts, { endDate } = {}) {
  const end = endDate || facts.find((f) => f.slot === 'end_date')?.value;
  if (!end) return [];
  const out = [];
  const notices = facts.filter((f) => f.slot === 'end_of_term_notice' && typeof f.value === 'number');
  if (notices.length) {
    const strict = notices.reduce((a, b) => (b.value > a.value ? b : a));
    const dates = notices.map((n) => ({ days: n.value, clause: n.clause, date: addDays(end, -n.value) }));
    out.push({
      id: 'notice-deadline',
      label: 'Last day to give written notice that you are leaving (or the lease may auto-renew)',
      date: addDays(end, -strict.value),
      basis: `${strict.value} days before ${end} (§${strict.clause})`,
      alternatives: dates.length > 1 ? dates : [],
    });
  }
  const inc = strictest(facts, 'rent_increase_notice');
  if (inc) out.push({ id: 'increase-notice', label: 'Landlord must tell you about a renewal rent increase by', date: addDays(end, -inc.value + 1), basis: `${inc.value} days before the renewal term begins (§${inc.clause})`, alternatives: [] });
  out.push({ id: 'lease-end', label: 'Lease ends', date: end, basis: `§${facts.find((f) => f.slot === 'end_date')?.clause ?? '?'}`, alternatives: [] });
  return out;
}

/** Things worth a second look, each tied to a clause. Not legal advice: phrased as questions. */
export function findFlags(clauses, facts) {
  const flags = [];
  const get = (slot) => facts.filter((f) => f.slot === slot);
  const rent = get('monthly_rent')[0]?.value;
  for (const f of get('auto_renewal')) flags.push({ id: 'auto-renewal', severity: 'high', clause: f.clause, title: 'It renews by itself', why: 'If nobody sends written notice in time, you could be locked into another full term.', ask: 'Can we change this to month-to-month after the first year, or shorten the notice window?' });
  for (const f of get('non_refundable_fee')) flags.push({ id: `nonref-${f.clause}-${f.value}`, severity: 'medium', clause: f.clause, title: `$${f.value.toLocaleString('en-US')} you won't get back`, why: `"${f.quote}"`, ask: 'What exactly does this fee cover, and can it be removed or made refundable?' });
  const lf = get('late_fee')[0];
  if (lf && rent) {
    const pct = Math.round((lf.value / rent) * 1000) / 10;
    const daily = get('daily_late_fee')[0];
    flags.push({ id: 'late-fee', severity: daily ? 'high' : 'medium', clause: lf.clause, title: `Late fee is ${pct}% of rent${daily ? ` plus $${daily.value}/day` : ''}`, why: daily ? `Ten days late would cost $${lf.value + daily.value * 10}.` : 'Check when the fee kicks in.', ask: 'Is there a grace period, and is the daily fee capped?' });
  }
  for (const f of get('entry_notice')) if (f.value === 'unspecified') flags.push({ id: `entry-${f.clause}`, severity: 'medium', clause: f.clause, title: 'Vague entry notice', why: `"${f.quote}" doesn't say how much notice.`, ask: 'Can we write in a specific notice period (e.g. 24 or 48 hours) except emergencies?' });
  for (const f of get('early_termination_fee_months')) flags.push({ id: 'early-term', severity: 'medium', clause: f.clause, title: `Breaking the lease costs ${f.value} months' rent${rent ? ` ($${(f.value * rent).toLocaleString('en-US')})` : ''}`, why: 'Plus the notice period in the same clause.', ask: 'Would the fee be reduced if a replacement tenant is found?' });
  for (const f of get('tenant_repair_threshold')) flags.push({ id: 'repairs', severity: 'medium', clause: f.clause, title: `You pay for any repair under $${f.value}`, why: /regardless of cause/i.test(f.quote) ? 'Even if you did not cause the damage ("regardless of cause").' : f.quote, ask: 'Can this be limited to damage caused by me or my guests?' });
  for (const c of clauses) {
    if (/tenant shall pay landlord'?s?['’]? (reasonable )?attorney/i.test(c.text) && !/prevailing party/i.test(c.text)) flags.push({ id: `fees-${c.id}`, severity: 'low', clause: c.id, title: 'One-sided attorney fees', why: 'Only the tenant pays legal fees; it does not say what happens if the landlord loses.', ask: 'Can this be changed to "the prevailing party" pays?' });
  }
  return flags;
}

/** Conflict -> plain question. */
export function conflictQuestion(conf) {
  const parts = conf.facts.map((f) => `§${f.clause} says ${fmtValue(f)}`);
  return `${parts.join(' but ')}. Which one applies? Please confirm in writing.`;
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function fmtValue(f) {
  if (f.value === 'unspecified') return '"reasonable notice" (no number)';
  switch (f.unit) {
    case 'usd': return `$${Number(f.value).toLocaleString('en-US')}`;
    case 'usd_per_day': return `$${f.value}/day`;
    case 'days': return `${f.value} days`;
    case 'hours': return `${f.value} hours`;
    case 'day_of_month': return f.slot === 'late_from_day' ? `late from the ${ordinal(f.value)}` : `the ${ordinal(f.value)}`;
    case 'months_rent': return `${f.value} months' rent`;
    case 'bool': return f.value ? 'yes' : 'no';
    default: return String(f.value);
  }
}

export function analyzeLease(text, opts = {}) {
  const clauses = splitClauses(text);
  const facts = extractFacts(clauses);
  const conflicts = findConflicts(facts);
  const flags = findFlags(clauses, facts);
  const dates = keyDates(facts, opts);
  const questions = [...conflicts.map(conflictQuestion), ...flags.map((f) => `§${f.clause}: ${f.ask}`)];
  return { clauses, facts, conflicts, flags, dates, questions };
}

// ---------- Retrieval + grounding for the Gemma Q&A ----------

const STOP = new Set('a an the of to and or in on for is are be by if i my me we our you your it this that with at as from do does can what when how much who which will would should lease landlord tenant there any get have has need give happen happens about there'.split(' '));
const tokens = (s) => String(s).toLowerCase().match(/[a-z0-9]+/g)?.filter((w) => !STOP.has(w) && w.length > 1) || [];
const stem = (w) => w.replace(/(ing|ed|es|s)$/, '');

const SYNONYMS = {
  move: ['vacate', 'vacat', 'renewal', 'non'], mov: ['vacate', 'vacat', 'renewal', 'non'], leave: ['vacate', 'renewal', 'non'], leav: ['vacate', 'renewal', 'non'],
  out: ['vacate'], break: ['early', 'termination'], quit: ['early', 'termination', 'vacate'],
  enter: ['entry', 'entering'], come: ['entry', 'enter'], inspect: ['entry', 'enter'],
  late: ['late', 'charge'], pet: ['pet'], dog: ['pet'], cat: ['pet'], deposit: ['deposit', 'refundable'],
  back: ['refundable', 'deposit'], fix: ['repair', 'maintenance'], broken: ['repair'], raise: ['increase'],
  roommate: ['sublet', 'occupancy', 'guest'], friend: ['guest'],
};

/** Small BM25 over clauses (with a few tenant-language synonyms). Returns top-k clauses for a question. */
export function retrieve(clauses, question, k = 3) {
  const docs = clauses.map((c) => tokens(`${c.title} ${c.title} ${c.text}`).map(stem));
  const raw = tokens(question);
  const base = raw.map(stem);
  const q = [...new Set([...base, ...[...raw, ...base].flatMap((t) => SYNONYMS[t] || []).map(stem)])];
  const N = docs.length || 1;
  const avg = docs.reduce((a, d) => a + d.length, 0) / N;
  const df = (t) => docs.filter((d) => d.includes(t)).length;
  const scored = docs.map((d, i) => {
    let s = 0;
    for (const t of q) {
      const tf = d.filter((x) => x === t).length;
      if (!tf) continue;
      const idf = Math.log(1 + (N - df(t) + 0.5) / (df(t) + 0.5));
      s += idf * ((tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (d.length / avg))));
    }
    return { clause: clauses[i], score: s };
  });
  return scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, k).map((x) => x.clause);
}

/**
 * Conflict-aware retrieval: if a retrieved clause takes part in a detected conflict,
 * pull in the clause(s) that contradict it, so the model sees both sides.
 */
export function retrieveForQuestion(analysis, question, k = 3) {
  const hits = retrieve(analysis.clauses, question, k);
  const ids = new Set(hits.map((c) => c.id));
  for (const conf of analysis.conflicts) {
    const cids = conf.facts.map((f) => f.clause);
    if (cids.some((id) => ids.has(id))) for (const id of cids) ids.add(id);
  }
  const byId = new Map(analysis.clauses.map((c) => [c.id, c]));
  return [...ids].map((id) => byId.get(id)).filter(Boolean);
}

/** Conflicts whose clauses are all in the context, plus at least one of the top-2 retrieved clauses. */
export function relevantConflicts(analysis, question, ctx) {
  const top = new Set(retrieve(analysis.clauses, question, 2).map((c) => c.id));
  const inCtx = new Set(ctx.map((c) => c.id));
  return analysis.conflicts.filter((conf) => conf.facts.every((f) => inCtx.has(f.clause)) && conf.facts.some((f) => top.has(f.clause)));
}

export const SYSTEM_PROMPT = `You are Lease Buddy, helping a friend understand their apartment lease.
Rules:
- Answer using ONLY the lease clauses provided.
- After each fact, put the clause tag it came from, like [§13].
- Copy numbers, dollar amounts and dates exactly as they appear in the clause.
- If two clauses disagree, say so and cite both.
- Only if none of the clauses are about the question, reply exactly: The lease doesn't say.
- Plain, friendly words. 2-4 short sentences. You are not a lawyer; don't give legal advice.`;

export function buildQAMessages(question, contextClauses, conflicts = []) {
  const ctx = contextClauses.map((c) => `[§${c.id}] ${c.full || c.text}`).join('\n');
  const hints = conflicts.map((conf) => `- ${conf.label}: ${conf.facts.map((f) => `[§${f.clause}] "${f.quote}"`).join(' versus ')}.`).join('\n');
  const hintBlock = hints ? `\n\nThe lease checker found clauses that contradict each other. Mention BOTH sides and cite both:\n${hints}` : '';
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Question: ${question}\n\nLease clauses:\n${ctx}${hintBlock}\n\nAnswer the question in 2-4 short sentences, with a [§…] tag after each fact.` },
  ];
}

export function buildExplainMessages(clause, language = 'English') {
  return [
    { role: 'system', content: `You explain one apartment-lease clause to a friend in plain ${language}. Use only what the clause says. Copy every number exactly. 2-3 short sentences. No legal advice.` },
    { role: 'user', content: `[§${clause.id}] ${clause.full || clause.text}\n\nExplain this clause in plain ${language}.` },
  ];
}

/** Every number mentioned in a text, normalized (digits, $ amounts, number words, "sixty (60)"). */
export function numbersIn(text) {
  const s = String(text);
  const out = new Set();
  for (const m of s.matchAll(/\$?\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/[$,]/g, ''));
    if (!Number.isNaN(n)) out.add(n);
  }
  for (const m of s.toLowerCase().matchAll(/\b(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:-[a-z]+)?\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\b/g)) {
    const n = parseNumberWord(m[0]);
    if (n != null) out.add(n);
  }
  return out;
}

/**
 * Check a model answer against the clauses it was given. Code, not the model, decides what is "verified":
 * - every number in the answer must appear in one of the provided clauses (each is traced to its clause)
 * - every [§x] citation must point to a provided clause
 * - if two provided clauses contradict each other, the answer must mention both sides
 */
export function verifyAnswer(answer, contextClauses, conflicts = []) {
  const text = String(answer);
  const provided = new Map(contextClauses.map((c) => [c.id, c]));
  const cited = [...new Set([...text.matchAll(/§\s?([A-Z]{0,2}\d+(?:\.\d+)*)/g)].map((m) => m[1]))];
  const badCitations = cited.filter((id) => !provided.has(id));
  const withoutCites = text.replace(/\[?§\s?[A-Z]{0,2}\d+(?:\.\d+)*\]?/g, ' ');
  const clauseNums = contextClauses.map((c) => [c.id, numbersIn(c.full || c.text)]);
  const trace = [...numbersIn(withoutCites)].map((n) => ({ n, clauses: clauseNums.filter(([, set]) => set.has(n)).map(([id]) => id) }));
  const unsupportedNumbers = trace.filter((t) => !t.clauses.length).map((t) => t.n);
  const lower = withoutCites.toLowerCase();
  const answerNums = numbersIn(withoutCites);
  const missedConflicts = [];
  for (const conf of conflicts) {
    if (!conf.facts.every((f) => provided.has(f.clause))) continue;
    const touches = (f) => {
      if (cited.includes(f.clause)) return true;
      if (f.value === 'unspecified') return /reasonable|any time|anytime/.test(lower);
      return [...numbersIn(f.quote)].some((n) => answerNums.has(n));
    };
    // Only judge conflicts the answer actually talks about; then every side must be mentioned.
    if (!conf.facts.some(touches)) continue;
    const missing = conf.facts.filter((f) => !touches(f));
    if (missing.length) missedConflicts.push({ slot: conf.slot, label: conf.label, missing: missing.map((f) => ({ clause: f.clause, value: f.value, unit: f.unit, quote: f.quote })) });
  }
  // Sentence-level attribution: a number in a sentence that cites [§x] must actually be in §x.
  const misattributed = [];
  const sentences = text.split(/(?<=[.!?])\s+(?=\S)/);
  const citesIn = (t) => [...t.matchAll(/§\s?([A-Z]{0,2}\d+(?:\.\d+)*)/g)].map((m) => m[1]).filter((id) => provided.has(id));
  // Small models often put the tag *after* the period ("...month. [§4] Next sentence"), so a tag that
  // opens a sentence counts for that sentence and the one before it.
  const leading = sentences.map((t) => citesIn((t.match(/^\s*(?:\[?§\s?[A-Z]{0,2}\d+(?:\.\d+)*\]?[\s,]*)+/) || [''])[0]));
  for (const [i, sent] of sentences.entries()) {
    const ids = [...new Set([...citesIn(sent), ...(leading[i + 1] || [])])];
    if (!ids.length) continue;
    const local = new Set(ids.flatMap((id) => [...numbersIn(provided.get(id).full || provided.get(id).text)]));
    const sentNums = numbersIn(sent.replace(/\[?§\s?[A-Z]{0,2}\d+(?:\.\d+)*\]?/g, ' '));
    for (const n of sentNums) {
      if (local.has(n)) continue;
      const actual = clauseNums.filter(([, set]) => set.has(n)).map(([id]) => id);
      if (actual.length) misattributed.push({ n, cited: ids, actual });
    }
  }
  const doesntSay = /lease doesn['’]?t say|does not say/i.test(text);
  return {
    ok: badCitations.length === 0 && unsupportedNumbers.length === 0 && missedConflicts.length === 0 && misattributed.length === 0 && (cited.length > 0 || trace.length > 0 || doesntSay),
    misattributed,
    cited,
    badCitations,
    unsupportedNumbers,
    trace,
    missedConflicts,
    uncited: cited.length === 0 && !doesntSay,
  };
}

/** iCalendar file for the key dates (all-day events with a 7-day reminder). */
export function makeIcs(dates, { now = new Date() } = {}) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s) => String(s).replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\n/g, '\\n');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lease Buddy//EN', 'CALSCALE:GREGORIAN'];
  for (const d of dates) {
    const day = d.date.replace(/-/g, '');
    const next = addDays(d.date, 1).replace(/-/g, '');
    lines.push('BEGIN:VEVENT', `UID:${d.id}-${day}@lease-buddy`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${next}`,
      `SUMMARY:${esc(d.label)}`, `DESCRIPTION:${esc(`Based on ${d.basis}. Double-check with your lease.`)}`,
      'BEGIN:VALARM', 'TRIGGER:-P7D', 'ACTION:DISPLAY', `DESCRIPTION:${esc(d.label)}`, 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
