// Uso: node tests/wrap.test.js — stripWrapperTag de content.js (la IA envuelve la frase en <p>…</p>).
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'content.js'), 'utf8');
const fn = new Function(/(function stripWrapperTag[\s\S]*?\n  })\n/.exec(src)[1] + '; return stripWrapperTag;')();
const assert = require('node:assert');
assert.strictEqual(fn('<p>Obligatorio, pero nunca se muestra</p>', 'Required, but never shown'), 'Obligatorio, pero nunca se muestra');
assert.strictEqual(fn('<g0>Inicio</g0>', '<g0>Home</g0>'), '<g0>Inicio</g0>');
assert.strictEqual(fn('si a<b y c>d', 'if a<b and c>d'), 'si a<b y c>d');
assert.strictEqual(fn('<p>Usa la etiqueta</p>', '<p>Use the tag</p>'), '<p>Usa la etiqueta</p>');
assert.strictEqual(fn('Texto <b>normal</b> aquí', 'Normal text'), 'Texto <b>normal</b> aquí');
// Con atributos inventados (Gemini en los títulos de GitHub: <h1 id="getting-started-…">).
assert.strictEqual(fn('<h1 id="getting-started-with-create-react-app">Primeros pasos con Create React App</h1>', 'Getting Started with Create React App'), 'Primeros pasos con Create React App');
assert.strictEqual(fn('<h2 id="languages">Idiomas</h2>', 'Languages'), 'Idiomas');
assert.strictEqual(fn('<p class="x">Usa la etiqueta</p>', 'Use the <p class="x"> tag</p>'), '<p class="x">Usa la etiqueta</p>');
console.log('wrap OK');
