// Uso: node tests/recent.test.js — lista de "Recientes": orden, repetidos y favoritos (aitAddRecent de settings.js).
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'settings.js'), 'utf8') + ';this.f={aitAddRecent,aitRecentCsv,aitRecentAnki}', ctx);
const { aitAddRecent, aitRecentCsv, aitRecentAnki } = ctx.f;
const e = (o, lang = 'Español', fav = false) => ({ o, t: `T:${o}`, lang, fav });

// La nueva va primero y una repetida (mismo texto e idioma) no se duplica; con otro idioma es otra.
let h = aitAddRecent([e('a'), e('b')], e('b'));
assert.strictEqual(h.map((x) => x.o).join(), 'b,a');
assert.strictEqual(aitAddRecent(h, e('b', 'Français')).length, 3);

// Repetir una con estrella la conserva.
h = aitAddRecent([e('a', 'Español', true)], e('a'));
assert.strictEqual(h[0].fav, true);

// 20 sin estrella: la 21 empuja afuera a la más vieja, pero no a los favoritos.
h = [e('fijo', 'Español', true)];
for (let i = 0; i < 25; i++) h = aitAddRecent(h, e(`n${i}`), 20);
assert.strictEqual(h.filter((x) => !x.fav).length, 20);
assert.ok(h.some((x) => x.o === 'fijo'));
assert.ok(!h.some((x) => x.o === 'n0'));
assert.strictEqual(h[0].o, 'n24');
// Exportar: CSV con comillas y sin fórmulas (el texto sale de páginas ajenas); Anki separado por tabuladores.
process.env.TZ = 'UTC';
const at = Date.UTC(2026, 10, 1, 15, 4);
const list = [
  { o: 'Hello, "world"', t: 'Hola, «mundo»', lang: 'Español', at, fav: true },
  { o: '=HYPERLINK("x")', t: '+1\tdos\nlíneas', lang: 'Español', at },
];
assert.strictEqual(aitRecentCsv(list), '﻿Original,Translation,Language,Date,Pinned\r\n'
  + '"Hello, ""world""","Hola, «mundo»",Español,2026-11-01 15:04,yes\r\n'
  + `"'=HYPERLINK(""x"")","'+1\tdos\nlíneas",Español,2026-11-01 15:04,\r\n`);
assert.strictEqual(aitRecentAnki(list), '#separator:tab\n#html:false\n#columns:Front\tBack\n'
  + 'Hello, "world"\tHola, «mundo»\n'
  + '=HYPERLINK("x")\t+1 dos líneas\n');

console.log('recent OK');
