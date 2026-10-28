// node tests/i18n.test.js — los textos de _locales: mismas claves y $N en todos los idiomas, y ninguna clave usada que falte.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const load = (loc) => JSON.parse(read(`_locales/${loc}/messages.json`));
const subs = (msg) => [...new Set(msg.match(/\$\d/g) || [])].sort().join(' ');

const en = load('en');
const keys = Object.keys(en);
const errors = [];

for (const loc of fs.readdirSync(path.join(root, '_locales'))) {
  const m = load(loc);
  for (const k of keys) {
    if (!m[k]) errors.push(`${loc}: falta ${k}`);
    else if (subs(m[k].message) !== subs(en[k].message)) errors.push(`${loc}: ${k} tiene "${subs(m[k].message)}", en tiene "${subs(en[k].message)}"`);
    else if (/\$(?![\d$])/.test(m[k].message)) errors.push(`${loc}: ${k} tiene un $ suelto (va $$)`);
  }
  for (const k of Object.keys(m)) if (!en[k]) errors.push(`${loc}: sobra ${k}`);
  // Límites de la Chrome Web Store.
  if ([...(m.extDesc?.message || '')].length > 132) errors.push(`${loc}: extDesc pasa de 132 caracteres`);
  if ([...(m.extName?.message || '')].length > 75) errors.push(`${loc}: extName pasa de 75 caracteres`);
}

// Claves que usa el código: data-i18n y data-i18n-attr en el HTML, __MSG_ en el manifest, y en JS el literal que
// sigue a aitT( (o a ? y : en un ternario dentro de aitT) más las etiquetas de RASGOS.
const used = new Set();
for (const f of ['options.html', 'popup.html']) {
  for (const [, k] of read(f).matchAll(/data-i18n="([^"]+)"/g)) used.add(k);
  for (const [, v] of read(f).matchAll(/data-i18n-attr="([^"]+)"/g)) v.split(/\s+/).forEach((p) => used.add(p.split(':')[1]));
}
for (const [, k] of read('manifest.json').matchAll(/__MSG_(\w+)__/g)) used.add(k);
const NOT_KEYS = new Set(['ok', 'error', 'aviso', 'rasgo', 'password', 'downloadable', 'translated']);
for (const f of ['settings.js', 'nano.js', 'background.js', 'content.js', 'options.js', 'popup.js']) {
  for (const line of read(f).split('\n')) {
    if (!/aitT\(|\['tag/.test(line)) continue;
    for (const [, k] of line.matchAll(/(?:aitT\(|[?:] |\[)'([a-z][A-Za-z0-9]*)'/g)) if (!NOT_KEYS.has(k)) used.add(k);
  }
}
for (const k of used) if (!en[k]) errors.push(`se usa ${k} y no está en en`);
for (const k of keys) if (!used.has(k)) errors.push(`${k} está en en y no se usa`);

assert.deepStrictEqual(errors, []);

// "Interfaz en inglés": aitT con los textos de en sustituye $N y $$ como chrome.i18n.
eval(read('settings.js') + ';globalThis.setMsgs = (m) => { aitMsgs = m; };');
setMsgs({ a: { message: 'Done: $1 of $2, $$5' } });
assert.strictEqual(aitT('a', 3, 7), 'Done: 3 of 7, $5');
assert.strictEqual(aitT('a', '$2', 'x'), 'Done: $2 of x, $5');
assert.strictEqual(aitT('a'), 'Done:  of , $5');
assert.strictEqual(aitT('missing'), 'missing');
// Los números salen con el formato del idioma de la interfaz; los textos, tal cual.
assert.strictEqual(aitT('a', 40000, '40000'), 'Done: 40,000 of 40000, $5');

// Textos del offscreen (sin chrome.i18n): clave y valores, también anidados, y con un prefijo delante.
setMsgs({ b: { message: 'Use $1 in $2.' }, g: { message: 'Gemini' } });
const tag = (k, ...s) => JSON.stringify({ i18n: [k, ...s] });
assert.strictEqual(aitOffscreenText(tag('b', 'Brave', tag('g'))), 'Use Brave in Gemini.');
assert.strictEqual(aitOffscreenText(`Gemini Nano: ${tag('g')}`), 'Gemini Nano: Gemini');
assert.strictEqual(aitOffscreenText('Gemini Nano: plain error'), 'Gemini Nano: plain error');
console.log(`ok: ${fs.readdirSync(path.join(root, '_locales')).length} idiomas, ${keys.length} textos`);
