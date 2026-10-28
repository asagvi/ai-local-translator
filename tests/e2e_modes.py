import json, time, tempfile, subprocess, sys, os, urllib.request
from playwright.sync_api import sync_playwright
import shutil
mode = sys.argv[1] if len(sys.argv) > 1 else 'nano'  # nano | rate
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
if mode == 'nano':
    # Copia de la extensión con un LanguageModel falso (headless no tiene GPU para el Nano real).
    EXT = os.path.join(tempfile.mkdtemp(), 'ext_nano')
    shutil.copytree(ROOT, EXT, ignore=shutil.ignore_patterns('tests'))
    fake = open(os.path.join(HERE, 'fake.js')).read()
    nano = open(os.path.join(EXT, 'nano.js')).read()
    open(os.path.join(EXT, 'nano.js'), 'w').write(fake + nano)
else:
    EXT = ROOT
env = dict(os.environ, RATE='1' if mode=='rate' else '0')
srv = subprocess.Popen([sys.executable, os.path.join(HERE, 'server.py')], env=env); time.sleep(1)
try:
  with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(tempfile.mkdtemp(), channel='chromium', headless=True,
        args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
    sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
    eid = sw.url.split('/')[2]
    if mode=='nano':
        sw.evaluate("chrome.storage.local.set({settings:{provider:'nano',targetLang:'Español',useCache:false}})")
    else:
        sw.evaluate("chrome.storage.local.set({settings:{provider:'custom',baseUrl:'http://127.0.0.1:8765/v1',model:'mock',targetLang:'Español',useCache:false,concurrency:1,maxChars:6000}})")
    opt = ctx.new_page(); opt.goto(f'chrome-extension://{eid}/options.html'); time.sleep(0.8)
    print('LanguageModel real en options:', opt.evaluate("typeof LanguageModel"), '| estado:', opt.evaluate("document.getElementById('localStatus').textContent"), '| panel nano visible:', opt.evaluate("!document.getElementById('localPanel').hidden"))
    page = ctx.new_page(); errs=[]
    page.on('console', lambda m: errs.append(m.text) if m.type in ('error','warning') else None)
    page.goto('http://127.0.0.1:8765/'); time.sleep(1)
    sw.evaluate("""(async()=>{const [t]=(await chrome.tabs.query({})).filter(t=>(t.url||'').startsWith('http://127'));await chrome.tabs.sendMessage(t.id,{type:'toggle'})})()""")
    badge = lambda: page.evaluate("document.getElementById('__ait_badge__')?.shadowRoot.querySelector('.msg').textContent")
    for i in range(6):
        time.sleep(1.5); print(' badge t+%.1fs:'%((i+1)*1.5), badge())
    time.sleep(3)
    print('p1:', page.evaluate("document.getElementById('p1').innerHTML"))
    print('pre1 intacto:', 'public function' in page.evaluate("document.getElementById('pre1').innerHTML"))
    print('badge final:', badge())
    if mode!='nano':
        log = json.loads(urllib.request.urlopen('http://127.0.0.1:8765/log').read()); print('server log types:', [l['type'] for l in log])
    if mode=='nano':
        r = opt.evaluate("chrome.runtime.sendMessage({type:'test'})"); print('test conexión:', r)
    print('consola:', errs)
    ctx.close()
finally: srv.kill()
