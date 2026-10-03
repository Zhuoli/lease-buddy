// Runs Gemma inside the browser (Web Worker) with Transformers.js.
// WebGPU when available, otherwise WebAssembly on the CPU. The lease never leaves the device.
import { pipeline, TextStreamer, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js';

env.allowLocalModels = false;
const MODEL_ID = 'onnx-community/gemma-3-1b-it-ONNX';
// The q4 export uses GatherBlockQuantized, which the WASM backend lacks; int8 works on CPU.
const WASM_DTYPE = 'int8';
let generator = null;
let config = null;

async function pickConfig() {
  try {
    if (self.navigator?.gpu) {
      const adapter = await self.navigator.gpu.requestAdapter();
      if (adapter) {
        // q4f16 is smaller/faster but needs fp16 shaders; plenty of GPUs (and headless Chrome) lack them.
        return { device: 'webgpu', dtype: adapter.features.has('shader-f16') ? 'q4f16' : 'q4' };
      }
    }
  } catch { /* fall through */ }
  return { device: 'wasm', dtype: WASM_DTYPE };
}

async function load(cfg) {
  config = cfg;
  generator = await pipeline('text-generation', MODEL_ID, {
    device: cfg.device,
    dtype: cfg.dtype,
    // model_int8.onnx is a single file; the q4 variants keep weights in an external .onnx_data file.
    ...(cfg.dtype === 'int8' ? { use_external_data_format: false } : {}),
    progress_callback: (p) => self.postMessage({ type: 'progress', p }),
  });
  // Smoke test so a broken GPU path fails here, not on the user's first question.
  await generator([{ role: 'user', content: 'Say OK.' }], { max_new_tokens: 2, do_sample: false });
}

async function generate(id, messages, maxNewTokens) {
  const streamer = new TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (t) => self.postMessage({ type: 'token', id, t }),
  });
  const out = await generator(messages, { max_new_tokens: maxNewTokens, do_sample: false, streamer });
  return out[0].generated_text.at(-1).content.trim();
}

self.onmessage = async (e) => {
  const { type, id, messages, maxNewTokens = 220, forceDevice } = e.data;
  try {
    if (type === 'load') {
      const cfg = forceDevice ? { device: forceDevice, dtype: forceDevice === 'wasm' ? WASM_DTYPE : 'q4' } : await pickConfig();
      try {
        await load(cfg);
      } catch (err) {
        if (cfg.device !== 'webgpu') throw err;
        self.postMessage({ type: 'progress', p: { status: 'fallback', message: String(err?.message || err) } });
        await load({ device: 'wasm', dtype: WASM_DTYPE });
      }
      self.postMessage({ type: 'ready', device: config.device, dtype: config.dtype, model: MODEL_ID });
    } else if (type === 'generate') {
      if (!generator) throw new Error('Model not loaded');
      self.postMessage({ type: 'done', id, text: await generate(id, messages, maxNewTokens) });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id, error: String(err?.message || err) });
  }
};
