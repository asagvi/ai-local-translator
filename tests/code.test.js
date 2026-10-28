// Uso: node tests/code.test.js — looksLikeCode de content.js (qué texto se deja sin traducir).
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'content.js'), 'utf8');
const fn = new Function(/(function looksLikeCode[\s\S]*?\n  })\n/.exec(src)[1] + '; return looksLikeCode;')();
const assert = require('node:assert');
for (const t of ['<code> ', '</div>', '<!DOCTYPE>', '<!-->', '<a href="x">', 'README.md', 'getElementById', 'Node.js']) assert.ok(fn(t), t);
for (const t of ['Tag', 'Complete HTML', 'Home', 'si a < b y c > d', '< volver']) assert.ok(!fn(t), t);
console.log('code OK');

const spaces = new Function(/(function spacesOutside[\s\S]*?\n  })\n/.exec(src)[1] + '; return spacesOutside;')();
assert.strictEqual(spaces('<g0>Complete HTML </g0>Reference'), '<g0>Complete HTML</g0> Reference');
assert.strictEqual(spaces('HTML <x0/> Tag'), 'HTML <x0/> Tag');
assert.strictEqual(spaces('a<g0> <g1>b </g1></g0>c'), 'a <g0><g1>b</g1></g0> c');
assert.strictEqual(spaces('Run\n  <x0/>  now'), 'Run <x0/> now');
console.log('spaces OK');

const off = require('fs').readFileSync(require('path').join(__dirname, '..', 'offscreen.js'), 'utf8');
const isLabel = new Function(/(function isLabel[\s\S]*?\n})\n/.exec(off)[1] + '; return isLabel;')();
for (const t of ['Settings', 'Pull requests', 'Sign in', 'Security and quality']) assert.ok(isLabel(t), t);
for (const t of ['<g0>Settings</g0>', '<x0/> Settings', 'Run this command before you deploy', '']) assert.ok(!isLabel(t), t);
console.log('label OK');

// Una sola palabra (con IA lleva tipo y significados): sin la puntuación de los bordes.
const oneWord = new Function('const LETTER_RE = /\\p{L}/u;' + /(function oneWord[\s\S]*?\n  })\n/.exec(src)[1] + '; return oneWord;')();
assert.strictEqual(oneWord('pursue,'), 'pursue');
assert.strictEqual(oneWord('“well-known”'), 'well-known');
for (const t of ['two words', '42', '...', 'a'.repeat(31)]) assert.strictEqual(oneWord(t), '', t);
console.log('word OK');
