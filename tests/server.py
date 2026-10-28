import json, re, sys, threading, os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
LOG = []
import os
RATE = [os.environ.get('RATE')=='1']
TAG = re.compile(r'(<\/?g\d+>|<x\d+\/>)')
def fake(t):
    # "traduce": texto fuera de etiquetas -> MAYÚSCULAS con prefijo, deja etiquetas
    parts = TAG.split(t)
    out = ''.join(p if TAG.fullmatch(p) else p.upper() for p in parts)
    # simula reordenamiento para la frase con "red car"
    if 'red <g0>car</g0>' in t: out = 'AUTO <g0>ROJO</g0> AQUÍ'
    if 'BREAK_TAGS' in t: out = out.replace('<g0>', '')  # IA rompe etiquetas
    if 'never shown' in t: return '<p>ES:' + out + '</p>'  # IA envuelve en la etiqueta del hint
    return 'ES:' + out
DIR = os.path.dirname(os.path.abspath(__file__))
PAGE = open(os.path.join(DIR, 'page.html'), encoding='utf-8').read()
class H(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def cors(self):
        self.send_header('Access-Control-Allow-Origin','*'); self.send_header('Access-Control-Allow-Headers','*')
    def do_OPTIONS(self):
        self.send_response(204); self.cors(); self.end_headers()
    def do_GET(self):
        if self.path.startswith('/v1/models'):
            b = json.dumps({"data":[{"id":"mock-embedding","created":3},{"id":"mock-old","created":1},{"id":"mock","created":2}]}).encode()
            self.send_response(200); self.cors(); self.send_header('content-type','application/json'); self.end_headers(); self.wfile.write(b); return
        name = os.path.basename(self.path.split('?')[0])
        if self.path.startswith('/log'):
            b = json.dumps(LOG).encode()
        elif name.endswith('.html') and os.path.isfile(os.path.join(DIR, name)):
            b = open(os.path.join(DIR, name), encoding='utf-8').read().encode()
        else:
            b = PAGE.encode()
        self.send_response(200); self.send_header('content-type','text/html; charset=utf-8' if not self.path.startswith('/log') else 'application/json'); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        n = int(self.headers['content-length']); body = json.loads(self.rfile.read(n))
        if ':generateContent' in self.path:
            # Formato de Gemini. El modelo "no-thinking" rechaza thinkingConfig, como un modelo que no acepta ese nivel.
            cfg = body.get('generationConfig', {}); LOG.append({'type':'gemini','path':self.path,'config':cfg})
            if 'no-thinking' in self.path and 'thinkingConfig' in cfg:
                b = json.dumps({"error":{"code":400,"message":"thinking_level is not supported by this model."}}).encode()
                self.send_response(400); self.cors(); self.end_headers(); self.wfile.write(b); return
            user = body['contents'][0]['parts'][0]['text']
            if 'You analyze a web page' in body['systemInstruction']['parts'][0]['text']:
                text = json.dumps({"pageType":"news","topic":"t","keepVerbatim":[],"glossary":{},"notes":""})
            else:
                text = json.dumps({it['id']: fake(it['t']) for it in json.loads(user)}, ensure_ascii=False)
            out = json.dumps({"candidates":[{"content":{"parts":[{"text":text}]},"finishReason":"STOP"}]}).encode()
            self.send_response(200); self.cors(); self.send_header('content-type','application/json'); self.end_headers(); self.wfile.write(out); return
        sysmsg = body['messages'][0]['content']; user = body['messages'][1]['content']
        if 'You analyze a web page' in sysmsg:
            LOG.append({'type':'profile','user':user})
            content = json.dumps({"pageType":"documentation","topic":"test","domain":"Magento","keepVerbatim":["Magento","bin/magento"],"glossary":{},"notes":""})
        elif 'bilingual dictionary' in sysmsg:
            LOG.append({'type':'lookup','user':user})
            content = json.dumps({"translation":"ES:PALABRA","pos":"sustantivo","meanings":["UNO","DOS"]})
        else:
            if RATE[0]:
                RATE[0]=False; LOG.append({'type':'429'})
                b=json.dumps({"error":{"code":429,"message":"quota","details":[{"retryDelay":"6s"}]}}).encode()
                self.send_response(429); self.cors(); self.end_headers(); self.wfile.write(b); return
            items = json.loads(user)
            LOG.append({'type':'translate','items':items})
            content = '```json\n' + json.dumps({it['id']: fake(it['t']) for it in items}, ensure_ascii=False) + '\n```'
        out = json.dumps({"choices":[{"message":{"content":content},"finish_reason":"stop"}]}).encode()
        self.send_response(200); self.cors(); self.send_header('content-type','application/json'); self.end_headers(); self.wfile.write(out)
ThreadingHTTPServer(('127.0.0.1', 8765), H).serve_forever()
