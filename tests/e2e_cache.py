import time, subprocess, sys, os
from playwright.sync_api import sync_playwright
from ext import launch
# Caché de traducciones: se guarda {t, at}, vence a los 7 días, lo guardado sin fecha no sirve y el barrido del
# arranque borra lo vencido (una vez por día).
HERE = os.path.dirname(os.path.abspath(__file__))
EXT = os.path.dirname(HERE)
srv = subprocess.Popen([sys.executable, os.path.join(HERE, 'server.py')])
time.sleep(1)
fails = ['no terminó']
DAY = 864e5
try:
  with sync_playwright() as p:
    ctx, sw = launch(p, EXT)
    fails = []
    def check(name, ok, got=None):
        print(('OK   ' if ok else 'FALLA'), name, '' if ok else got)
        if not ok: fails.append(name)
    time.sleep(1)
    check('barrido al arrancar', sw.evaluate("chrome.storage.local.get('cacheSweptAt').then(r => Date.now() - r.cacheSweptAt < 60000)"))
    sw.evaluate("""chrome.storage.local.set({settings:{provider:'custom',baseUrl:'http://127.0.0.1:8765/v1',model:'mock',apiKey:'',targetLang:'Español',contextFirst:true,useCache:true}})""")
    tr = """async () => { const r = await handleTranslate({items:[{id:'0',h:'p',t:'Hello world'}], page:{url:'http://127.0.0.1:8765/',title:'t',lang:'en'}}); return r.results['0'] }"""
    key = "cacheKey(withTarget(await aitGetSettings()), 'Hello world')"
    put = lambda v: sw.evaluate(f"async () => {{ await chrome.storage.local.set({{[{key}]: {v}}}) }}")
    got = sw.evaluate(tr)
    check('traduce', got == 'ES:HELLO WORLD', got)
    e = sw.evaluate(f"async () => {{ const k = {key}; return (await chrome.storage.local.get(k))[k] }}")
    check('guarda {t, at}', isinstance(e, dict) and e.get('t') == 'ES:HELLO WORLD' and isinstance(e.get('at'), (int, float)), e)

    put("{t:'GUARDADA', at: Date.now() - 6 * %d}" % DAY)
    check('usa la de 6 días', sw.evaluate(tr) == 'GUARDADA')
    put("{t:'VIEJA', at: Date.now() - 8 * %d}" % DAY)
    got = sw.evaluate(tr)
    check('no usa la de 8 días', got == 'ES:HELLO WORLD', got)
    put("'VIEJA'")
    got = sw.evaluate(tr)
    check('no usa la guardada sin fecha', got == 'ES:HELLO WORLD', got)

    r = sw.evaluate("""async () => {
      await chrome.storage.local.set({'c:sinfecha':'x', 'c:vieja':{t:'x', at: Date.now() - 8 * %d}, 'c:nueva':{t:'x', at: Date.now()}, cacheSweptAt: 0});
      await cacheSweep();
      const a = await chrome.storage.local.get(null);
      await chrome.storage.local.set({'c:vieja2':{t:'x', at: 0}});
      await cacheSweep();
      const b = await chrome.storage.local.get(null);
      return {sinfecha: 'c:sinfecha' in a, vieja: 'c:vieja' in a, nueva: 'c:nueva' in a, count: a.cacheCount,
              total: Object.keys(a).filter(k => k.startsWith('c:')).length, otraVez: 'c:vieja2' in b, settings: !!b.settings}
    }""" % DAY)
    check('barrido borra lo vencido y lo sin fecha', not r['sinfecha'] and not r['vieja'] and r['nueva'], r)
    check('barrido recuenta', r['count'] == r['total'], r)
    check('barrido una vez por día', r['otraVez'], r)
    check('barrido no toca la config', r['settings'], r)
    # Contador de Gemini: tres escrituras a la vez no pierden cuentas; un 429 anota el freno.
    u = sw.evaluate("""async () => {
      await chrome.storage.local.remove('usage');
      await Promise.all([1, 2, 3].map((n) => noteUsage((u) => { u.requests++; u.tokens += n * 10; })));
      await noteUsage((u) => { u.limitedAt = Date.now(); u.limitedUntil = Date.now() + 5000; });
      return (await chrome.storage.local.get('usage')).usage;
    }""")
    check('uso: tres a la vez', u['requests'] == 3 and u['tokens'] == 60, u)
    check('uso: día de Google y freno', u['day'] == sw.evaluate('aitPacificDay(Date.now())') and u['limitedUntil'] > u['limitedAt'] > 0, u)
    ctx.close()
finally:
  srv.terminate()
print('FALLAS:', fails)
sys.exit(1 if fails else 0)
