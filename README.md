# 🏠 Lease Buddy

**Read your lease like a friend who has read a lot of leases.** Paste a lease (or open a .txt/.pdf). Lease Buddy finds the money, the dates, and the clauses that **contradict each other**. Then **Gemma, running on your own device**, explains them in plain words.

**Live:** https://lease-buddy-gemma.vercel.app · Built for the DEV Hacktoberfest 2026 Weekend Challenge ("Build for a Friend").

> Not legal advice. Lease Buddy points at things to ask about. A local tenant-rights group or a lawyer can tell you what the law says where you live.

## Why

I built this for a friend who is about to sign a 12-month lease written in dense legal English. The scary parts of a lease are rarely hidden. They're *scattered*: the renewal clause says one notice period, the "notice to vacate" clause says another, and an addendum quietly changes when rent counts as late. I wanted something they could run privately, on a laptop, without uploading a lease (name, address, rent, signature) to someone's server.

## What it does

| Part | Done by | Notes |
|---|---|---|
| Split the lease into numbered clauses (incl. addenda like `A2`) | code | falls back to paragraphs |
| Pull out the key terms: rent, due day, late fee, deposit, dates, notice periods, early-termination fee | code | each one cites its clause |
| **Find contradictions**: two clauses giving different values for the same thing | code | e.g. §13 "60 days" vs §14 "30 days" |
| Compute the dates you can't miss and export a `.ics` with 7-day reminders | code | uses the *stricter* reading when clauses disagree |
| Flag unusual terms (auto-renewal, non-refundable fees, vague entry notice, "you pay repairs regardless of cause", one-sided attorney fees) as **questions for the landlord** | code | copy-paste list |
| Explain a clause in plain words / answer questions | **Gemma** | gets only the retrieved clauses, plus any clause that contradicts them, plus the contradictions code found |
| Check Gemma's answer | code | every number must appear in a clause Gemma was shown, every `[§x]` must be real, and both sides of a contradiction must be mentioned. Otherwise you see a ⚠️ |

### Two ways to run Gemma, both on your hardware
1. **In the browser:** `onnx-community/gemma-3-1b-it-ONNX` via [Transformers.js](https://github.com/huggingface/transformers.js) in a Web Worker. WebGPU if available, WebAssembly otherwise. A one-time download of about 0.8–1 GB (q4f16 or q4 on WebGPU, int8 on CPU), cached by the browser. Add `?device=wasm` to force the CPU path.
2. **Ollama on your computer:** any Gemma you've pulled, e.g. Gemma 4:
   ```bash
   ollama pull gemma4:e2b
   OLLAMA_ORIGINS="https://lease-buddy-gemma.vercel.app" ollama serve
   ```
   Then choose "Gemma via Ollama" in the app.

The site is static (HTML + ES modules). There's no backend, no analytics, and no API keys.

## How well does Gemma do? (measured, not vibes)

`npm run gemma:check` runs the real prompts against `samples/sample-lease.txt` (a fictional lease with 3 planted contradictions) and records whether each answer passes the code verifier. Results are in `results/`.

| Model (all local, CPU) | Q&A answers passing the checker | Clause explanations passing | Same 3 contradiction questions **without** telling the model about contradictions |
|---|---|---|---|
| **Gemma 4 E2B** (`gemma4:e2b`, Ollama) | **7/7** | 3/3 | 2/3: it answered "30 days [§14]" and left out the 60-day auto-renewal clause |
| **Gemma 3 1B** (the in-browser model; ONNX q4 via Transformers.js in Node) | 5/7 | 2/3 | 1/3 |

What the checker caught from Gemma 3 1B: numbers cited to the wrong clause ("thirty days … [§13]"), a clause id that doesn't exist (`§A9`), and an explanation that turned "sixty (60) days" into "six months". What it **can't** catch is meaning. For example, 1B said "the lease doesn't allow you to bring a cat" when the clause says pets need written consent. That's why every answer shows the exact clauses Gemma saw, and why the summary, contradictions and dates at the top come from code, not the model. Every Gemma 4 answer in `results/gemma-check-ollama.json` was also checked by hand against the clauses, and they all match.

The main lesson: small models like to answer from **one** clause. When the lease contradicts itself, the code has to find the contradiction and hand it to the model.

## Develop

```bash
npm install          # only needed for the Node Gemma check
npm test             # 25 unit tests (parser, facts, conflicts, dates, retrieval, verifier, .ics)
npm run gemma:check  # optional: real Gemma runs (transformers.js and/or local Ollama)
npm run serve        # http://localhost:8080
```

Code map: `src/lease.js` (all the deterministic logic, shared by browser and tests) · `src/engines.js` + `src/gemma-worker.js` (Gemma runtimes) · `src/app.js` (UI).

## Credits

- Gemma by Google DeepMind ([Gemma terms](https://ai.google.dev/gemma/terms)); ONNX conversions by the onnx-community on Hugging Face.
- Transformers.js (Apache-2.0), pdf.js (Apache-2.0), Ollama (MIT).
- Built with an AI coding agent; I reviewed and directed the work. The idea of "find clauses that disagree, then make the model show both" comes from my earlier [Fine Print](https://github.com/Zhuoli/fine-print) project, but this is a new codebase written during the challenge weekend.

## License

Apache-2.0
