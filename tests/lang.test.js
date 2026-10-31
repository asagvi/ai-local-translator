// node tests/lang.test.js — nombre de idioma → código para la Translator API y Nano.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
// Los const de un eval no salen de él: se exponen los que usa la prueba.
eval(fs.readFileSync(path.join(__dirname, '..', 'settings.js'), 'utf8') + ';globalThis.AIT_LANGUAGES = AIT_LANGUAGES;');

const cases = {
  // De la lista
  'Español': 'es', 'Español (Latinoamérica)': 'es', 'English': 'en', 'Português (Brasil)': 'pt',
  '日本語': 'ja', '中文 (简体)': 'zh', '中文 (繁體)': 'zh-Hant', 'Polski': 'pl', 'Nederlands': 'nl', 'Русский': 'ru',
  // Escritos a mano: en español, en inglés o en el propio idioma, sin importar tildes ni mayúsculas
  'polaco': 'pl', 'Polish': 'pl', 'neerlandés': 'nl', 'Dutch': 'nl', 'catalán': 'ca', 'Català': 'ca',
  'aleman': 'de', 'Turco': 'tr', 'Tiếng Việt': 'vi', 'हिन्दी': 'hi', 'Swahili': 'sw',
  // Un código también vale
  'pl': 'pl', 'pt-BR': 'pt-BR',
  // Lo que no es un idioma no se adivina
  'Klingon': '', '': '', 'xyz123': '',
};
for (const [name, code] of Object.entries(cases)) assert.strictEqual(aitLangCode(name), code, `${name} → ${aitLangCode(name)} (esperado ${code})`);
for (const name of AIT_LANGUAGES) assert.ok(aitLangCode(name), `${name} de la lista no tiene código`);
// Lo que se ve en los selectores: el nombre en el idioma de la interfaz y el propio al lado.
const labels = [
  ['한국어', 'es', 'Coreano — 한국어'], ['বাংলা', 'es', 'Bengalí — বাংলা'], ['한국어', 'en', 'Korean — 한국어'],
  ['Español', 'es', 'Español'], ['Español (Latinoamérica)', 'es', 'Español (Latinoamérica)'], ['English', 'en', 'English'],
  ['Português (Brasil)', 'en', 'Brazilian Portuguese — Português (Brasil)'], ['Klingon', 'es', 'Klingon'], ['Italiano', 'es', 'Italiano'],
];
for (const [name, ui, want] of labels) assert.strictEqual(aitLangLabel(name, ui), want, `${name} en ${ui}`);
console.log('lang OK');
