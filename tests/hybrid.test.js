// Uso: node tests/hybrid.test.js — "Traductor de Chrome + Google Gemini": qué servicio recibe la IA y cómo se nombra (settings.js).
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'settings.js'), 'utf8') + ';this.f={aitApiSettings,aitServiceName,aitIsLocal,aitProviderType}', ctx);
const { aitApiSettings, aitServiceName, aitIsLocal, aitProviderType } = ctx.f;

const hybrid = { provider: 'hybrid', model: 'gemini-3.5-flash-lite', apiKey: 'k' };
// Lotes, perfil y caché son los del Traductor; la IA es la que corrige, con su key y su modelo.
assert.strictEqual(aitProviderType(hybrid), 'chrome');
assert.ok(aitIsLocal(hybrid));
assert.strictEqual(aitApiSettings(hybrid).provider, 'gemini');
assert.strictEqual(aitApiSettings(hybrid).apiKey, 'k');
assert.ok(!aitIsLocal(aitApiSettings(hybrid)));
assert.strictEqual(aitApiSettings({ provider: 'hybrid' }).provider, 'gemini');
// Antes se elegía la IA que corrige: ahora es siempre Gemini.
assert.strictEqual(aitApiSettings({ provider: 'hybrid', fixProvider: 'lmstudio' }).provider, 'gemini');
// Los demás servicios no cambian.
assert.strictEqual(aitApiSettings({ provider: 'chrome', fixProvider: 'openai' }).provider, 'chrome');

assert.strictEqual(aitServiceName(hybrid), 'svcChromeLabel + svcGeminiLabel (gemini-3.5-flash-lite)');
assert.strictEqual(aitServiceName({ ...hybrid, model: '' }), 'svcChromeLabel + svcGeminiLabel');
assert.strictEqual(aitServiceName({ provider: 'chrome', model: 'chrome-translator' }), 'svcChromeLabel');
assert.strictEqual(aitServiceName({ provider: 'gemini', model: 'gemini-3.5-flash-lite' }), 'svcGeminiLabel (gemini-3.5-flash-lite)');
console.log('hybrid OK');
