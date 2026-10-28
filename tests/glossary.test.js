// Uso: node tests/glossary.test.js — glosario propio: reglas "X = Y" y "X", y los marcadores del Traductor de Chrome (settings.js).
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'settings.js'), 'utf8') + ';this.f={aitGlossary,aitGlossMark,aitGlossRestore}', ctx);
const { aitGlossary, aitGlossMark, aitGlossRestore } = ctx.f;

const g = aitGlossary('deploy = despliegue\n\n  Magento  \npull request=\n = nada\nMagento Cloud');
assert.deepStrictEqual(JSON.parse(JSON.stringify(g)), [
  { from: 'deploy', to: 'despliegue' },
  { from: 'Magento', to: null },
  { from: 'pull request', to: null },
  { from: 'Magento Cloud', to: null },
]);
assert.deepStrictEqual(JSON.parse(JSON.stringify(aitGlossary(''))), []);

// Palabras enteras, sin importar mayúsculas; la regla más larga gana; las marcas de la página no se tocan.
let m = aitGlossMark('Deploy <g0>Magento Cloud</g0> before the deployment of Magento.<x1/>', g);
assert.strictEqual(m.t, '<x9000/> <g0><x9001/></g0> before the deployment of <x9002/>.<x1/>');
assert.deepStrictEqual([...m.subs], ['Despliegue', 'Magento Cloud', 'Magento']);

// Vuelve cada marcador una vez; si el traductor perdió o repitió uno, no sirve.
assert.strictEqual(aitGlossRestore('<x9000/> <g0><x9001/></g0> antes de <x9002/>.<x1/>', m.subs), 'Despliegue <g0>Magento Cloud</g0> antes de Magento.<x1/>');
assert.strictEqual(aitGlossRestore('<x9000/> antes de <x9002/>.', m.subs), null);
assert.strictEqual(aitGlossRestore('<x9000/> <x9000/> <x9001/> <x9002/>', m.subs), null);

// Sin coincidencias, el texto queda igual.
m = aitGlossMark('Nothing here', g);
assert.strictEqual(m.t, 'Nothing here');
assert.strictEqual(aitGlossRestore('Nada', m.subs), 'Nada');

// Letras no latinas y caracteres especiales en la regla.
m = aitGlossMark('Usa C++ y Node.js', aitGlossary('C++\nnode.js = Node'));
assert.strictEqual(m.t, 'Usa <x9000/> y <x9001/>');
assert.deepStrictEqual([...m.subs], ['C++', 'Node']);

console.log('glossary: ok');
