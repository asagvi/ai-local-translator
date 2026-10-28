// Uso: node tests/services.test.js — cada servicio guarda su key, dirección y modelo (settings.js).
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let stored;
let session = {};
const chrome = { storage: {
  local: {
    get: async () => ({ settings: stored }),
    set: async (o) => { stored = JSON.parse(JSON.stringify(o.settings)); },
  },
  session: {
    get: async () => ({ keys: session }),
    set: async (o) => { session = JSON.parse(JSON.stringify(o.keys)); },
  },
} };
const ctx = { chrome };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'settings.js'), 'utf8') + ';this.f={aitGetSettings,aitSaveSettings,aitApiSettings,aitProviderType}', ctx);
const { aitGetSettings, aitSaveSettings, aitApiSettings, aitProviderType } = ctx.f;

(async () => {
  // Config de antes: un solo apiKey/baseUrl/model, que es del servicio elegido.
  stored = { provider: 'openrouter', apiKey: 'or-key', baseUrl: 'https://openrouter.ai/api/v1', model: 'x/y:free' };
  let s = await aitGetSettings();
  assert.strictEqual(s.services.openrouter.apiKey, 'or-key');
  assert.strictEqual(s.model, 'x/y:free');

  // Pasar a Gemini no arrastra la key ni el modelo de OpenRouter.
  s = await aitSaveSettings({ provider: 'gemini' });
  assert.strictEqual(s.apiKey, '');
  assert.strictEqual(s.model, '');
  assert.strictEqual(s.baseUrl, 'https://generativelanguage.googleapis.com/v1beta');
  // Los campos sueltos no se guardan: salen de services.
  assert.ok(!('apiKey' in stored) && !('model' in stored) && !('baseUrl' in stored));

  s = await aitSaveSettings({ services: { ...s.services, gemini: { apiKey: 'g-key', baseUrl: '', model: 'gemini-x' } } });
  assert.strictEqual(s.apiKey, 'g-key');
  s = await aitSaveSettings({ provider: 'openrouter' });
  assert.strictEqual(s.apiKey, 'or-key');

  // Con "Traductor de Chrome + Google Gemini", la IA usa los de Gemini, aunque una config vieja diga otra.
  s = await aitSaveSettings({ provider: 'hybrid', fixProvider: 'openrouter' });
  assert.ok(!('fixProvider' in stored));
  assert.strictEqual(aitApiSettings(s).apiKey, 'g-key');
  assert.strictEqual(aitApiSettings(s).model, 'gemini-x');

  // "Olvidar las keys al cerrar el navegador": van a storage.session, no al disco.
  s = await aitSaveSettings({ sessionKeys: true });
  assert.strictEqual(s.apiKey, 'g-key');
  assert.ok(!JSON.stringify(stored).includes('-key'));
  assert.deepStrictEqual(session, { gemini: 'g-key', openrouter: 'or-key' });
  assert.strictEqual((await aitGetSettings()).services.openrouter.apiKey, 'or-key');
  // Al cerrar el navegador se borra storage.session: queda todo menos la key.
  session = {};
  s = await aitGetSettings();
  assert.strictEqual(s.apiKey, '');
  assert.strictEqual(s.services.gemini.model, 'gemini-x');
  // Apagarlo vuelve a guardar en disco la key que se pegó de nuevo.
  s = await aitSaveSettings({ sessionKeys: false, services: { ...s.services, gemini: { ...s.services.gemini, apiKey: 'g2' } } });
  assert.strictEqual(stored.services.gemini.apiKey, 'g2');
  assert.deepStrictEqual(session, {});

  // Un servicio local no se migra: su modelo es fijo.
  stored = { provider: 'chrome', model: 'chrome-translator', apiKey: '', baseUrl: '' };
  s = await aitGetSettings();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(s.services)), {});
  assert.strictEqual(s.model, 'chrome-translator');

  // Ollama sin nada guardado: la dirección de su preset.
  stored = { provider: 'ollama', services: {} };
  assert.strictEqual((await aitGetSettings()).baseUrl, 'http://localhost:11434/v1');
  // Gemini Nano ya no se elige: pasa al Traductor de Chrome.
  stored = { provider: 'nano', model: 'gemini-nano' };
  s = await aitGetSettings();
  assert.strictEqual(s.provider, 'chrome');
  assert.strictEqual(aitProviderType(s), 'chrome');
  console.log('services OK');
})().catch((e) => { console.error(e); process.exit(1); });
