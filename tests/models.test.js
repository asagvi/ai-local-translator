// Uso: node tests/models.test.js — elección del modelo recomendado (aitTextModels / aitPickModel de settings.js).
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'settings.js'), 'utf8') + ';this.f={aitTextModels,aitPickModel,aitGeminiThinking,aitIsFreeModel}', ctx);
const { aitTextModels, aitPickModel, aitGeminiThinking, aitIsFreeModel } = ctx.f;

const gemini = aitTextModels(['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-flash-image',
  'gemini-3-flash-preview', 'gemini-2.5-pro', 'text-embedding-004', 'gemini-2.5-flash-preview-tts', 'gemma-3-27b-it', 'gemini-2.5-flash-live']);
assert.ok(!gemini.some((m) => /image|embedding|tts|live/.test(m)), `quedan modelos que no son de texto: ${gemini}`);
// Para traducir conviene Flash-Lite: más rápido y casi sin thinking. Si no hay, el Flash estable más nuevo.
assert.strictEqual(aitPickModel('gemini', gemini), 'gemini-2.5-flash-lite');
assert.strictEqual(aitPickModel('gemini', ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.6-flash-lite-preview']), 'gemini-3.5-flash-lite');
assert.strictEqual(aitPickModel('gemini', ['gemini-10-flash', 'gemini-9.5-flash']), 'gemini-10-flash');
assert.strictEqual(aitPickModel('gemini', ['gemini-3-flash-preview', 'gemini-2.5-pro']), 'gemini-3-flash-preview');

// Anthropic devuelve el más nuevo primero.
assert.strictEqual(aitPickModel('anthropic', ['claude-opus-5-5', 'claude-haiku-5-5', 'claude-haiku-4-5']), 'claude-haiku-5-5');

// OpenAI: ya vienen ordenados por fecha; el "mini" más nuevo, sin audio ni búsqueda.
const openai = aitTextModels(['gpt-6-mini-realtime', 'gpt-6-mini', 'gpt-6', 'gpt-5-mini', 'whisper-1', 'dall-e-3', 'text-embedding-3-small']);
assert.deepStrictEqual(Array.from(openai), ['gpt-6-mini', 'gpt-6', 'gpt-5-mini']);
assert.strictEqual(aitPickModel('openai', openai), 'gpt-6-mini');

// OpenRouter: cientos de modelos, que elija el usuario. Servidores locales: Gemma 4 12B o el primero cargado.
assert.strictEqual(aitPickModel('openrouter', ['a/b', 'c/d']), '');
assert.strictEqual(aitPickModel('ollama', ['qwen2.5:7b', 'llama3:8b']), 'qwen2.5:7b');
// Gemma 4 12B, el que recomienda Opciones para traducir, si está descargado.
assert.strictEqual(aitPickModel('ollama', ['qwen3:14b', 'gemma4:12b']), 'gemma4:12b');
assert.strictEqual(aitPickModel('lmstudio', ['qwen/qwen3-coder-30b', 'google/gemma-4-12b']), 'google/gemma-4-12b');
assert.strictEqual(aitPickModel('lmstudio', ['gemma-40-12b', 'gemma-3-12b-it']), 'gemma-40-12b');
assert.strictEqual(aitPickModel('gemini', []), '');

// Thinking mínimo que acepta cada familia (documentación de Gemini, consultada 2026-10-24).
assert.deepStrictEqual(JSON.parse(JSON.stringify(aitGeminiThinking('gemini-3.8-flash'))), { thinkingLevel: 'low' });
assert.deepStrictEqual(JSON.parse(JSON.stringify(aitGeminiThinking('gemini-4-argon'))), { thinkingLevel: 'low' });
assert.deepStrictEqual(JSON.parse(JSON.stringify(aitGeminiThinking('gemini-2.5-flash'))), { thinkingBudget: 0 });
assert.strictEqual(aitGeminiThinking('gemini-3.5-flash-lite'), null); // ya viene en minimal
assert.strictEqual(aitGeminiThinking('gemini-2.5-flash-lite'), null); // no piensa
assert.strictEqual(aitGeminiThinking('gemini-2.5-pro'), null); // no se puede apagar
assert.deepStrictEqual(JSON.parse(JSON.stringify(aitGeminiThinking('gemini-3.1-pro-preview'))), { thinkingLevel: 'low' });
assert.strictEqual(aitGeminiThinking('gemini-flash-latest'), null);

// OpenRouter: los de música (Lyria) no son de texto; gratis = precio 0 de entrada y salida, o ":free".
assert.deepStrictEqual(aitTextModels(['google/lyria-3-pro-preview', 'openrouter/free']), ['openrouter/free']);
assert.ok(aitIsFreeModel({ id: 'openrouter/free', pricing: { prompt: '0', completion: '0' } }));
assert.ok(aitIsFreeModel({ id: 'x/y:free' }));
assert.ok(!aitIsFreeModel({ id: 'openrouter/auto', pricing: { prompt: '-1', completion: '-1' } }));
assert.ok(!aitIsFreeModel({ id: 'a/b', pricing: { prompt: '0', completion: '0.000002' } }));
assert.ok(!aitIsFreeModel({ id: 'a/b' }));

// Buscador de Opciones: qué partes del nombre se resaltan (markParts de options.js).
const opt = fs.readFileSync(path.join(__dirname, '..', 'options.js'), 'utf8');
const markParts = new Function(/(function markParts[\s\S]*?\n})\n/.exec(opt)[1] + '; return markParts;')();
assert.deepStrictEqual(markParts('gemini-2.5-flash-lite', ['flash']), [['gemini-2.5-', false], ['flash', true], ['-lite', false]]);
assert.deepStrictEqual(markParts('Claude-Haiku-4', ['haiku', '4']), [['Claude-', false], ['Haiku', true], ['-', false], ['4', true]]);
assert.deepStrictEqual(markParts('a-a', ['a']), [['a', true], ['-', false], ['a', true]]);
assert.deepStrictEqual(markParts('flash-lite', ['flash', 'sh-l']), [['flash-l', true], ['ite', false]]);
assert.deepStrictEqual(markParts('mock', []), [['mock', false]]);

console.log('models.test.js OK');
