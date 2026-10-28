// Uso: node tests/recent.test.js — lista de "Recientes": orden, repetidos y favoritos (aitAddRecent de settings.js).
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'settings.js'), 'utf8') + ';this.f={aitAddRecent}', ctx);
const { aitAddRecent } = ctx.f;
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
console.log('recent OK');
