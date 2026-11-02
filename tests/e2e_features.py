import json, time, subprocess, sys, os
from playwright.sync_api import sync_playwright
from ext import launch
# Párrafo bajo el cursor (toque de Ctrl), Shadow DOM abierto, "solo el artículo" y comparar servicios en la tarjeta.
HERE = os.path.dirname(os.path.abspath(__file__))
EXT = os.path.dirname(HERE)
URL = 'http://127.0.0.1:8765/features.html'
srv = subprocess.Popen([sys.executable, os.path.join(HERE, 'server.py')])
time.sleep(1)
fails = ['no terminó']
TEXTS = """() => {
  const by = (id) => document.getElementById(id)?.textContent ?? null;
  const sh = (host, id) => document.getElementById(host)?.shadowRoot?.getElementById(id)?.textContent ?? null;
  return { nav: by('nav'), ah: by('ah'), ap1: by('ap1'), sp: by('sp'), h1p: by('h1p'), h2p: by('h2p'), slotted: by('card'),
    sh: sh('card', 'sh'), sp1: sh('card', 'sp1'), sp2: sh('card', 'sp2'), lp: sh('late', 'lp'), vp: sh('vlate', 'vp'), sel: by('sel') };
}"""

def settings(sw, **extra):
    s = {'provider': 'custom', 'baseUrl': 'http://127.0.0.1:8765/v1', 'model': 'mock', 'apiKey': '', 'targetLang': 'Español',
         'contextFirst': False, 'useCache': False, **extra}
    sw.evaluate('(s) => chrome.storage.local.set({settings: s})', s)

def send(sw, type):
    sw.evaluate("""async (t) => { const [tab] = await chrome.tabs.query({url: 'http://127.0.0.1:8765/*'}); await chrome.tabs.sendMessage(tab.id, {type: t}); }""", type)

def es(v): return bool(v) and v.startswith('ES:')

# La tarjeta está en un Shadow DOM closed: CDP con pierce para encontrar un elemento por clase, su texto y su lugar.
def card(page, cls, click=False):
    cdp = page.context.new_cdp_session(page)
    try:
        root = cdp.send('DOM.getDocument', {'depth': -1, 'pierce': True})['root']
        def find(n):
            attrs = n.get('attributes', [])
            if 'class' in attrs and cls in attrs[attrs.index('class') + 1].split():
                return n
            for c in n.get('children', []) + n.get('shadowRoots', []):
                r = find(c)
                if r: return r
        n = find(root)
        if not n: return None
        def text(n):
            return n.get('nodeValue', '') if n['nodeType'] == 3 else ''.join(text(c) for c in n.get('children', []))
        if click:
            q = cdp.send('DOM.getBoxModel', {'nodeId': n['nodeId']})['model']['content']
            page.mouse.click((q[0] + q[4]) / 2, (q[1] + q[5]) / 2)
        return text(n)
    finally:
        cdp.detach()

try:
  with sync_playwright() as p:
    ctx, sw = launch(p, EXT)
    fails = []
    def check(name, ok, got=None):
        print(('OK   ' if ok else 'FALLA'), name, '' if ok else got)
        if not ok: fails.append(name)
    errs = []
    page = ctx.new_page()
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)

    # 1. Toque de Ctrl sobre un párrafo: solo ese. Ctrl+C no cuenta.
    settings(sw)
    page.goto(URL)
    time.sleep(2.5)
    box = page.locator('#h2p').bounding_box()
    page.mouse.move(box['x'] + 10, box['y'] + box['height'] / 2)
    page.keyboard.press('Control+c')
    box = page.locator('#h1p').bounding_box()
    page.mouse.move(box['x'] + 10, box['y'] + box['height'] / 2)
    page.keyboard.press('Control')
    time.sleep(2)
    t = page.evaluate(TEXTS)
    check('toque de Ctrl traduce el párrafo', es(t['h1p']), t['h1p'])
    check('el resto queda igual (Ctrl+C no cuenta)', not es(t['h2p']) and not es(t['ap1']) and not es(t['sh']), t)
    # "Ver original" con párrafos sueltos vuelve a cero: otro toque funciona y "Traducir" es la página entera.
    send(sw, 'original')
    time.sleep(0.5)
    check('párrafo suelto: Ver original lo devuelve', not es(page.evaluate(TEXTS)['h1p']))
    box = page.locator('#h2p').bounding_box()
    page.mouse.move(box['x'] + 10, box['y'] + box['height'] / 2)
    page.keyboard.press('Control')
    time.sleep(2)
    check('párrafo suelto: otro toque después del original', es(page.evaluate(TEXTS)['h2p']))
    send(sw, 'translate')
    time.sleep(3)
    t = page.evaluate(TEXTS)
    check('párrafo suelto y después Traducir: la página entera', es(t['ap1']) and es(t['sh']), t)

    def tap(id, key='Control', click=False, field=False):
        if field: page.focus('#field')
        box = page.locator('#' + id).bounding_box()
        page.mouse.move(box['x'] + 10, box['y'] + box['height'] / 2)
        if click:
            page.keyboard.down(key); page.mouse.click(box['x'] + 10, box['y'] + box['height'] / 2); page.keyboard.up(key)
        else:
            page.keyboard.press(key)
        time.sleep(1.5)
        return page.evaluate(TEXTS)[id]
    # Ctrl+clic y la tecla con el foco en un campo no cuentan.
    page.goto(URL); time.sleep(1)
    check('Ctrl+clic no traduce', not es(tap('sp', click=True)))
    check('la tecla en un campo no traduce', not es(tap('sp', field=True)))
    # Otra tecla elegida, y apagado.
    settings(sw, hoverKey='Alt'); page.goto(URL); time.sleep(1)
    check('con Alt: Ctrl no traduce', not es(tap('h1p')))
    check('con Alt: Alt traduce', es(tap('h1p', 'Alt')))
    settings(sw, hoverKey=''); page.goto(URL); time.sleep(1)
    check('apagado: ni Ctrl ni Alt', not es(tap('h1p')) and not es(tap('h1p', 'Alt')))
    # En bilingüe, el párrafo conserva el original y suma la traducción.
    settings(sw, bilingual=True); page.goto(URL); time.sleep(1)
    v = tap('h1p')
    check('bilingüe: original y traducción', v.startswith('This paragraph') and 'ES:THIS PARAGRAPH' in v, v)
    settings(sw)

    # 2. Shadow DOM abierto: el componente, lo que llega después adentro y uno que se define tarde. Y vuelve igual.
    page.goto(URL)
    time.sleep(0.5)
    orig = page.evaluate(TEXTS)
    send(sw, 'translate')
    time.sleep(4)
    page.evaluate('addShadowText()')
    time.sleep(2)
    page.evaluate('defineVeryLate()')
    time.sleep(1)
    page.mouse.move(400, 300)
    page.mouse.wheel(0, 300)
    time.sleep(3)
    t = page.evaluate(TEXTS)
    check('shadow root: componente definido después de los barridos, al hacer scroll', es(t['vp']), t['vp'])
    check('shadow root: título y párrafo', es(t['sh']) and es(t['sp1']), t)
    check('shadow root: texto agregado después', es(t['sp2']), t['sp2'])
    check('shadow root: componente definido tarde', es(t['lp']), t['lp'])
    check('texto del slot (DOM de la página)', es(t['slotted']), t['slotted'])
    send(sw, 'original')
    time.sleep(0.5)
    back = page.evaluate(TEXTS)
    orig['sp2'] = 'New text added inside the shadow root later.'
    orig['lp'] = 'Late component text appears after a while.'
    orig['vp'] = 'Very late component text shows up after scrolling.'
    check('original idéntico (también en el shadow root)', back == orig, {k: back[k] for k in back if back[k] != orig[k]})

    # 3. Solo el artículo.
    settings(sw, articleOnly=True)
    page.goto(URL)
    time.sleep(1)
    send(sw, 'translate')
    time.sleep(3)
    t = page.evaluate(TEXTS)
    check('solo el artículo: el artículo', es(t['ah']) and es(t['ap1']), t)
    check('solo el artículo: nav, aside y el resto quedan', not any(es(t[k]) for k in ('nav', 'sp', 'h1p', 'sh')), t)
    # Cambiarlo con la página en el original no la traduce.
    send(sw, 'original')
    time.sleep(0.5)
    settings(sw, articleOnly=False)
    time.sleep(2)
    t = page.evaluate(TEXTS)
    check('solo el artículo: cambiarlo en el original no traduce', not es(t['ap1']) and not es(t['nav']), t)

    # 4. Comparar en la tarjeta: con un servicio de IA, contra el Traductor de Chrome (parcheado: no hay modelo acá).
    settings(sw)
    sw.evaluate("() => { callChromeTranslator = async (s, texts) => ({ texts: texts.map((t) => 'CT:' + t) }); }")
    page.goto(URL)
    time.sleep(1)
    page.evaluate("""() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('sel')); getSelection().removeAllRanges(); getSelection().addRange(r); }""")
    send(sw, 'selection')
    time.sleep(2)
    main = card(page, 'tarjeta__traduccion') or ''
    check('tarjeta: traducción principal', 'ES:' in main, main)
    label = card(page, 'tarjeta__comparar') or ''
    check('tarjeta: botón comparar con el Traductor', 'Chrome' in label and 'selCompare' not in label and len(label) > len('Chrome'), label)
    card(page, 'tarjeta__comparar', click=True)
    time.sleep(2)
    other = card(page, 'tarjeta__otra') or ''
    check('tarjeta: traducción del otro servicio', 'CT:' in other, other)
    # Un servicio que no es el que se ofrece para comparar se rechaza (no cae al servicio en uso).
    bad = sw.evaluate("async () => { try { await handleTranslate({ compare: 'gemini', items: [{ id: 0, h: 'p', t: 'Hello' }], page: {} }); return 'aceptado'; } catch (e) { return e.message; } }")
    check('comparar con un servicio no ofrecido: rechazado', bad != 'aceptado', bad)
    check('sin errores en la página', not errs, errs)
    ctx.close()
finally:
  srv.kill()
print('FALLAS:', fails)
sys.exit(1 if fails else 0)
