---
title: "Lease Buddy: a private lease checker for a friend, with Gemma running on their own laptop"
published: true
description: "It finds the clauses in a lease that contradict each other, computes the dates you can't miss, and Gemma explains them in plain words. Nothing leaves your device."
tags: devchallenge, weekendchallenge, hf26challenge, ai
cover_image: https://raw.githubusercontent.com/Zhuoli/lease-buddy/main/docs/hero.png
---

*This is a submission for the [Hacktoberfest Weekend Challenge: Build for a Friend](https://dev.to/challenges/hacktoberfest-weekend-2026-10-01)*

## What I Built

I built this for a friend who is about to sign a 12-month apartment lease: pages of dense legal English, plus an addendum. I can read it with them once, but I won't be there for the next lease, or the renewal letter. And a lease is exactly the kind of document you shouldn't paste into a random website: name, address, rent, signature.

So I built them **Lease Buddy**: paste a lease (or open a `.txt` / `.pdf`), and it gives you:

- **The short version:** rent, due date, late fee, deposit, start and end dates, notice periods, early-termination cost. Every item cites its clause (`§3`, `§13`…).
- **Clauses that contradict each other.** This is the part I care about most. In real leases the scary stuff usually isn't hidden; it's *scattered*. One clause says you need 60 days' notice to avoid auto-renewal, another says 30 days to vacate, and an addendum quietly moves the late-rent cutoff from the 5th to the 3rd.
- **Dates you can't miss**, computed rather than guessed, with a `.ics` export and 7-day reminders. When two clauses disagree, it uses the earlier (safer) date and shows both.
- **Questions to send the landlord:** each flag (auto-renewal, non-refundable fees, "reasonable notice" with no number, "tenant pays any repair under $250 regardless of cause", one-sided attorney fees) becomes a copy-paste question rather than legal advice.
- **Ask Gemma.** "Can my landlord come in whenever they want?" or "Explain §13 in plain words." Gemma runs **in the browser tab or on your own computer**, never on a server.

![Contradictions found in the sample lease](https://raw.githubusercontent.com/Zhuoli/lease-buddy/main/docs/conflicts.png)

## Demo

**Live:** https://lease-buddy-gemma.vercel.app. Click **"Try the sample lease"** (a fictional lease with three contradictions planted on purpose). The rule checks are instant and need no model. Then hit **Start Gemma** to ask questions.

![Key terms with clause citations](https://raw.githubusercontent.com/Zhuoli/lease-buddy/main/docs/terms.png)

![Dates you can't miss, with an .ics export](https://raw.githubusercontent.com/Zhuoli/lease-buddy/main/docs/dates.png)

Here's Gemma 4 (E2B, via Ollama on my dev box) answering the question that matters most in this lease. The yellow line comes from the rule checker, not the model. The green line is the code verifying Gemma's answer:

![Gemma 4 answering with both contradictory clauses cited](https://raw.githubusercontent.com/Zhuoli/lease-buddy/main/docs/gemma-answer.png)

## Code

{% embed https://github.com/Zhuoli/lease-buddy %}

Plain HTML + ES modules, no build step, no backend, no API keys. Apache-2.0. `npm test` runs 25 unit tests (clause splitting, fact extraction, contradiction detection, date math, retrieval, the answer verifier, `.ics`).

## How I Built It

I built it this weekend with an AI coding agent doing a lot of the typing, while I made the calls on scope, tests and the parts below.

**The split that made it work: code finds the facts, Gemma explains them.**

1. **Deterministic layer (`src/lease.js`):** splits the lease into clauses (including addendum ids like `A2`), reads number words ("sixty (60) days"), and pulls out typed facts like `end_of_term_notice = 60 days @ §13`. If two clauses give different values for the same thing, that's a contradiction. Dates are plain date math in UTC.
2. **Retrieval:** a tiny BM25 over clauses, plus a few tenant-language synonyms ("moving out" → vacate / non-renewal). It's **contradiction-aware**: if a retrieved clause is part of a contradiction, the clause that contradicts it gets pulled in too.
3. **Gemma** only sees those clauses, plus a note from the checker listing the contradiction, and is told to cite `[§x]` after each fact.
4. **Verifier:** every number in Gemma's answer must appear in a clause it was shown (and in the clause cited in *that sentence*), every `[§x]` must be real, and if a contradiction is in play, both sides must be mentioned. Otherwise the answer gets a ⚠️ that says exactly what's off.

**Two ways to run Gemma, both on hardware you control:**

- **In the browser:** `gemma-3-1b-it` (ONNX) via **Transformers.js** in a Web Worker. WebGPU (q4f16, or q4 when the GPU lacks fp16 shaders) with a CPU/WASM fallback (int8). About a 0.8–1 GB one-time download, then cached.
- **Ollama on your computer:** `ollama pull gemma4:e2b`, allow the site's origin with `OLLAMA_ORIGINS`, and the page streams from `localhost:11434`.

**I measured it instead of eyeballing it.** `npm run gemma:check` runs the real prompts against the sample lease and saves every answer to `results/` (all on CPU):

| Model | Q&A answers passing the checker | Clause explanations passing | Same 3 contradiction questions *without* the checker's hint |
|---|---|---|---|
| Gemma 4 E2B (Ollama) | **7/7** | 3/3 | 2/3 |
| Gemma 3 1B (the in-browser model) | 5/7 | 2/3 | 1/3 |

Three things I learned:

- **Small models answer from one clause.** Without the hint, Gemma 4 answered "how much notice before moving out?" with *"at least thirty (30) days' written notice [§14]"*. That's true, but it skipped §13's 60-day non-renewal deadline, which is the one that locks you into another year. The system prompt already said "if two clauses disagree, say so and cite both", and that wasn't enough. When the checker's note naming the specific contradiction was added, it cited both.
- **The verifier earns its keep on the 1B model.** It caught Gemma 3 1B citing numbers to the wrong clause ("thirty days … [§13]"), inventing a clause id (`§A9`), and turning "sixty (60) days" into "six months".
- **It can't check meaning**, and I'd rather say so. 1B once said "the lease doesn't allow you to bring a cat" when the clause says pets need written consent. That's why each answer shows the exact clauses Gemma saw, why the summary, contradictions and dates come from code, and why the app labels the 1B option "small, sometimes cites the wrong clause" and recommends Gemma 4 for answers.

Also: the first in-browser run crashed with *"Program Sub requires f16 but the device does not support it"*. Lots of GPUs don't expose `shader-f16`, so the worker now checks the adapter, picks `q4` instead of `q4f16`, runs a 2-token smoke test, and falls back to the CPU if the GPU path still fails.

## Why Does Open Innovation Matter?

Because of what a lease *is*: legal name, address, rent, sometimes income and a signature. Uploading that to someone else's server to get it explained is exactly the wrong move. With an open-weight model:

- **The document never leaves the device.** The site is static files on Vercel. Gemma runs in the tab (Transformers.js) or on your own machine (Ollama). There's no server I could log to, even by accident.
- **It costs nothing to run**, for my friend or for me. No API key, no per-token bill, no account.
- **I could pick the model size to match the job.** A 1B model that loads in a browser for a quick private look, or Gemma 4 E2B on a laptop when you want answers you can lean on. The same prompts and the same verifier work for both, and I could measure both.
- **The open stack let me fix the hard part.** Swapping models, reading their failure modes in `results/`, and adding a verifier around them is how the "answers from one clause" problem got solved. A closed API would have given me a nicer-sounding answer with the same blind spot.

Not legal advice: Lease Buddy tells you what to *ask*. For what the law says where you live, a local tenant-rights group is the right call. Next step: going through my friend's real lease with them.

## Prize Categories

- **Best Use of Gemma:** Gemma 3 1B runs fully in the browser via Transformers.js (WebGPU/WASM), and Gemma 4 E2B runs locally through Ollama. Both are wrapped in contradiction-aware retrieval and a code verifier, with a measured comparison in the repo.
