// Uso: node tests/cache.test.js — caché de traducciones: vence a los 7 días y lo guardado sin fecha ya no sirve (settings.js).
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'settings.js'), 'utf8') + ';this.f={aitCacheValue,AIT_CACHE_DAYS}', ctx);
const { aitCacheValue, AIT_CACHE_DAYS } = ctx.f;
const now = Date.UTC(2026, 10, 1);
const day = 864e5;

assert.strictEqual(AIT_CACHE_DAYS, 7);
assert.strictEqual(aitCacheValue({ t: 'Hola', at: now }, now), 'Hola');
assert.strictEqual(aitCacheValue({ t: 'Hola', at: now - 6.9 * day }, now), 'Hola');
assert.strictEqual(aitCacheValue({ t: '', at: now }, now), '');
// Vencida, del futuro (reloj cambiado) o con otra forma: no sirve.
assert.strictEqual(aitCacheValue({ t: 'Hola', at: now - 7 * day }, now), null);
assert.strictEqual(aitCacheValue({ t: 'Hola', at: now - 8 * day }, now), null);
assert.strictEqual(aitCacheValue({ t: 'Hola', at: now + day }, now), null);
// Lo guardado antes de que hubiera fecha era el texto solo.
assert.strictEqual(aitCacheValue('Hola', now), null);
assert.strictEqual(aitCacheValue(undefined, now), null);
assert.strictEqual(aitCacheValue({ t: 1, at: now }, now), null);
assert.strictEqual(aitCacheValue({ t: 'Hola' }, now), null);

console.log('cache: ok');
