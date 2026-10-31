import json, time, tempfile, subprocess, sys, urllib.request
from playwright.sync_api import sync_playwright
from ext import launch, badge
import os
HERE = os.path.dirname(os.path.abspath(__file__))
EXT = os.path.dirname(HERE)
srv = subprocess.Popen([sys.executable, os.path.join(HERE, 'server.py')])
time.sleep(1)
fails = ['no terminó']
try:
  with sync_playwright() as p:
    ctx, sw = launch(p, EXT)
    sw.evaluate("""chrome.storage.local.set({settings:{provider:'custom',baseUrl:'http://127.0.0.1:8765/v1',model:'mock',apiKey:'',targetLang:'Español',contextFirst:true,useCache:false}})""")
    page = ctx.new_page()
    errs = []
    page.on('console', lambda m: errs.append(m.text) if m.type in ('error','warning') else None)
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto('http://127.0.0.1:8765/')
    time.sleep(1)
    def html(): return page.evaluate("""() => { const o={}; for (const id of ['h1','p1','p2','p3','pre1','gh','mono1','p4','li1','p5','p6','d1','r1']) { const e=document.getElementById(id); o[id]= e? e.innerHTML : null }; o.in1=document.getElementById('in1').placeholder; o.img1=document.getElementById('img1').alt; o.nav=document.querySelector('nav').innerHTML; return o }""")
    before = html()
    sw.evaluate("""(async()=>{const [t]=await chrome.tabs.query({}).then(ts=>ts.filter(t=>(t.url||'').startsWith('http://127')));await chrome.tabs.sendMessage(t.id,{type:'toggle'})})()""")
    time.sleep(4)
    # dynamic text change like React
    page.evaluate("document.getElementById('r1').firstChild.nodeValue='Data loaded successfully'")
    time.sleep(2.5)
    after = html()
    for k in before: print(f'{k}:\n  ANTES:   {before[k]}\n  DESPUÉS: {after[k]}')
    # toggle original
    sw.evaluate("""(async()=>{const [t]=await chrome.tabs.query({}).then(ts=>ts.filter(t=>(t.url||'').startsWith('http://127')));await chrome.tabs.sendMessage(t.id,{type:'toggle'})})()""")
    time.sleep(0.5)
    orig = html()
    diffs = [k for k in before if before[k]!=orig[k] and k not in ('d1','r1')]
    print('\nRESTAURADO IGUAL AL ORIGINAL:', not diffs, diffs)
    for k in diffs: print(k, '\n  ', before[k], '\n  ', orig[k])
    sw.evaluate("""(async()=>{const [t]=await chrome.tabs.query({}).then(ts=>ts.filter(t=>(t.url||'').startsWith('http://127')));await chrome.tabs.sendMessage(t.id,{type:'toggle'})})()""")
    time.sleep(0.5)
    again = html()
    print('RE-TRADUCIDO IGUAL:', again==after, [k for k in after if after[k]!=again[k]])
    print('BADGE:', badge(page))
    log = json.loads(urllib.request.urlopen('http://127.0.0.1:8765/log').read())
    print('\nPETICIONES:')
    for l in log:
        if l['type']=='profile': print(' profile; inline code:', [x for x in l['user'].split('\n') if 'Inline' in x or '|' in x][:2])
        else: print(' translate:', json.dumps(l['items'], ensure_ascii=False))
    print('\nCONSOLA:', errs)
    fails = [m for ok, m in [
        (after['p1'].startswith('ES:') and '<code>' in after['p1'], 'p1 sin traducir o sin el código'),
        (after['pre1'] == before['pre1'], 'pre1 cambió'),
        (after['p3'] == before['p3'], 'p3 (etiquetas rotas) no quedó en el original'),
        (after['d1'] and after['d1'].startswith('ES:'), 'contenido dinámico sin traducir'),
        (not diffs, 'el original no quedó idéntico'),
        (again == after, 'la re-traducción no es igual'),
        (not errs, 'errores en consola'),
    ] if not ok]
    ctx.close()
finally:
  srv.kill()
print('\nFALLAS:', fails or 'ninguna')
sys.exit(1 if fails else 0)
