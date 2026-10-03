// Two ways to run Gemma, both on hardware the user controls:
//  1. BrowserGemma: Gemma 3 1B (instruction-tuned, ONNX q4) inside this tab via Transformers.js.
//  2. OllamaGemma: any Gemma you pulled with Ollama on your own computer (e.g. gemma4:e2b, gemma3:4b).

export class BrowserGemma {
  constructor({ onProgress, onReady } = {}) {
    this.worker = new Worker(new URL('./gemma-worker.js', import.meta.url), { type: 'module' });
    this.pending = new Map();
    this.seq = 0;
    this.label = 'Gemma 3 1B in your browser';
    this.worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') onProgress?.(m.p);
      else if (m.type === 'ready') { this.device = m.device; this.label = `Gemma 3 1B in your browser (${m.device === 'webgpu' ? `WebGPU, ${m.dtype}` : 'CPU/WASM'})`; this._ready?.(m); onReady?.(m); }
      else if (m.type === 'token') this.pending.get(m.id)?.onToken?.(m.t);
      else if (m.type === 'done') { this.pending.get(m.id)?.resolve(m.text); this.pending.delete(m.id); }
      else if (m.type === 'error') {
        const p = this.pending.get(m.id);
        if (p) { p.reject(new Error(m.error)); this.pending.delete(m.id); } else this._fail?.(new Error(m.error));
      }
    };
  }
  load(opts = {}) {
    return new Promise((resolve, reject) => { this._ready = resolve; this._fail = reject; this.worker.postMessage({ type: 'load', ...opts }); });
  }
  chat(messages, { onToken, maxNewTokens = 160 } = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onToken });
      this.worker.postMessage({ type: 'generate', id, messages, maxNewTokens });
    });
  }
}

export class OllamaGemma {
  constructor({ baseUrl = 'http://localhost:11434', model = 'gemma4:e2b' } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
    this.label = `${model} via Ollama on your computer`;
  }
  async load() {
    const r = await fetch(`${this.baseUrl}/api/tags`);
    if (!r.ok) throw new Error(`Ollama answered ${r.status}`);
    const { models = [] } = await r.json();
    if (!models.some((m) => m.name === this.model || m.model === this.model)) {
      throw new Error(`Model ${this.model} not found. Run: ollama pull ${this.model}`);
    }
    return { device: 'ollama' };
  }
  async chat(messages, { onToken, maxNewTokens = 300 } = {}) {
    const r = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.model, messages, stream: true, think: false, options: { temperature: 0, num_predict: maxNewTokens } }),
    });
    if (!r.ok || !r.body) throw new Error(`Ollama error ${r.status}`);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let text = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const j = JSON.parse(line);
        const t = j.message?.content || '';
        if (t) { text += t; onToken?.(t); }
      }
    }
    return text.trim();
  }
}
