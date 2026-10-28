/* Traductor IA Contextual — content script.
 *
 * Flujo:
 *  1. Escanea el DOM y arma "segmentos" (frases completas), marcando como intocables
 *     el código, comandos, editores, elementos translate="no", etc.
 *  2. Pide a la IA un perfil de la página (tipo, dominio, términos que NO se traducen).
 *  3. Traduce por lotes lo que está visible (IntersectionObserver), con ese contexto.
 *  4. Aplica la traducción en el mismo nodo de texto cuando se puede (amigable con React/Vue)
 *     y permite volver al original en cualquier momento.
 */
(() => {
  if (window.__aitLoaded) return;
  window.__aitLoaded = true;

  const BADGE_ID = '__ait_badge__';

  // Subárboles que nunca se recorren. Si aparecen dentro de una frase se conservan tal cual.
  const SKIP_TAGS = new Set([
    'script', 'style', 'noscript', 'template', 'iframe', 'canvas', 'svg', 'math', 'textarea',
    'input', 'select', 'option', 'optgroup', 'object', 'embed', 'video', 'audio', 'head',
    'title', 'meta', 'link', 'datalist', 'progress', 'meter',
  ]);
  // Etiquetas de código: protegidas siempre.
  const CODE_TAGS = new Set(['code', 'pre', 'kbd', 'samp', 'var', 'tt', 'xmp', 'listing', 'plaintext']);
  // Elementos reemplazados (no tienen texto propio): se conservan como marcador <xN/>.
  const REPLACED_TAGS = new Set([
    'img', 'picture', 'br', 'wbr', 'input', 'select', 'textarea', 'svg', 'math', 'canvas',
    'video', 'audio', 'iframe', 'object', 'embed', 'progress', 'meter',
  ]);
  // Para elementos ocultos (display:none) no hay estilo calculado útil: usamos la etiqueta.
  const INLINE_TAGS = new Set([
    'a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data', 'dfn', 'em', 'i', 'kbd', 'label',
    'mark', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var',
    'font', 'big', 'img', 'br', 'wbr', 'del', 'ins', 'tt', 'ruby', 'rt', 'rp',
  ]);
  // Clases típicas de resaltadores y editores de código (GitHub, Prism, highlight.js, CodeMirror, Monaco...).
  const CODE_CLASS_RE = /(?:^|\s)(?:hljs|prism-|codemirror|cm-editor|cm-content|cm-line|monaco-editor|view-lines|ace_|blob-code|react-code|react-file-line|code-?block|codehilite|sourcecode|highlight-source|gist-|katex|mathjax|mjx-|shiki|line-numbers|diff-(?:line|code)|terminal-output|xterm)/i;
  const MONO_RE = /mono|consol|menlo|monaco|courier|fira code|hack\b|inconsolata|lucida console|sfmono/i;
  const TAG_RE = /<(\/?)g(\d+)\s*>|<x(\d+)\s*\/?>|<\/x\d+\s*>/g;
  const LETTER_RE = /\p{L}/u;
  const ATTRS = ['placeholder', 'title', 'alt', 'aria-label'];
  /* ---------------------------------------------------------------- */
  /* Estado                                                           */
  /* ---------------------------------------------------------------- */

  let settings = null;
  let mode = 'off'; // 'off' | 'translated' | 'original'
  let segments = [];
  let queue = [];
  let inflight = 0;
  let fallbacks = 0; // reintentos del Traductor de Chrome con Gemini Nano o la IA que corrige: van por fuera de la cola
  let flushTimer = null;
  let fatalError = '';
  let analyzing = false;
  // Del escaneo al primer aviso del IntersectionObserver no hay nada en cola: aún no terminó.
  let starting = false;
  let profile = null;
  let profilePromise = null;
  let profileKey = '';
  let userSkip = '';
  let bodyMono = false;
  let keepAlive = null;
  let lastSoftError = '';
  let pausedUntil = 0;
  let pauseTicker = null;

  let dispCache = new WeakMap();
  let protCache = new WeakMap();
  let blockDescCache = new WeakMap();
  let monoCache = new WeakMap();

  let known = new WeakMap(); // nodo de texto -> valor esperado (ya procesado)
  let segOf = new WeakMap(); // nodo de texto -> segmento dueño
  let attrKnown = new WeakMap(); // elemento -> {attr: valor esperado}
  const pageMemo = new Map(); // texto fuente -> traducción validada
  const hostSegs = new Map(); // elemento observado -> segmentos pendientes

  /* ---------------------------------------------------------------- */
  /* Clasificación de elementos                                       */
  /* ---------------------------------------------------------------- */

  function resetCaches() {
    dispCache = new WeakMap();
    protCache = new WeakMap();
    blockDescCache = new WeakMap();
    monoCache = new WeakMap();
  }

  function display(el) {
    let d = dispCache.get(el);
    if (d === undefined) {
      try { d = getComputedStyle(el).display || ''; } catch { d = ''; }
      dispCache.set(el, d);
    }
    return d;
  }

  function isInlineEl(el) {
    const d = display(el);
    if (!d || d === 'none') return INLINE_TAGS.has(el.localName);
    return d === 'inline' || d === 'inline-block' || d === 'contents';
  }

  function hasDirectText(el) {
    for (const c of el.childNodes) {
      if (c.nodeType === 3 && c.nodeValue.trim()) return true;
    }
    return false;
  }

  function isMono(el) {
    if (bodyMono) return false;
    let v = monoCache.get(el);
    if (v === undefined) {
      let ff = '';
      try { ff = getComputedStyle(el).fontFamily || ''; } catch { /* ignore */ }
      v = MONO_RE.test(ff.split(',')[0] || '');
      monoCache.set(el, v);
    }
    return v;
  }

  function isProtected(el) {
    let v = protCache.get(el);
    if (v !== undefined) return v;
    v = false;
    const tag = el.localName;
    if (CODE_TAGS.has(tag)) v = true;
    else if (el.id === BADGE_ID) v = true;
    else if (el.getAttribute('translate') === 'no') v = true;
    else if (el.isContentEditable) v = true;
    else {
      const cls = el.getAttribute('class');
      if (cls && (/(?:^|\s)notranslate(?:\s|$)/.test(cls) || CODE_CLASS_RE.test(cls))) v = true;
      else if (userSkip) {
        try { v = el.matches(userSkip); } catch { v = false; }
      }
    }
    protCache.set(el, v);
    return v;
  }

  function skipSubtree(el) {
    return SKIP_TAGS.has(el.localName) || isProtected(el);
  }

  // Elemento que dentro de una frase se conserva intacto como <xN/>.
  function isAtom(el, hostMono) {
    const tag = el.localName;
    if (SKIP_TAGS.has(tag) || REPLACED_TAGS.has(tag) || isProtected(el)) return true;
    const text = el.textContent || '';
    if (!LETTER_RE.test(text)) return true; // iconos, separadores, números sueltos
    // Código escrito en un span o un enlace (<code>, README.md, getElementById): el Traductor lo traduciría.
    if (!el.firstElementChild && text.length <= 60 && looksLikeCode(text)) return true;
    // Fragmento monoespaciado dentro de prosa normal: casi siempre es código.
    if (!hostMono && hasDirectText(el) && isMono(el)) return true;
    return false;
  }

  function hasBlockDesc(el) {
    let v = blockDescCache.get(el);
    if (v !== undefined) return v;
    v = false;
    for (const c of el.children) {
      if (isAtom(c, true)) {
        if (!isInlineEl(c)) { v = true; break; }
        continue;
      }
      if (!isInlineEl(c) || hasBlockDesc(c)) { v = true; break; }
    }
    blockDescCache.set(el, v);
    return v;
  }

  function looksLikeCode(text) {
    const t = text.trim();
    if (!t) return true;
    if (/^(https?:\/\/|www\.)\S+$/i.test(t)) return true;
    if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(t)) return true;
    if (!/\s/.test(t)) {
      if (/^[~.]?\/?[\w.@-]+(\/[\w.@-]+)+\/?$/.test(t)) return true; // rutas
      if (/^[\w.-]+\.(js|mjs|cjs|ts|tsx|jsx|php|phtml|py|rb|go|rs|java|kt|cs|cpp|c|h|json|ya?ml|xml|html?|css|scss|less|md|sh|sql|lock|toml|ini|env|vue|svelte|txt|csv|log)$/i.test(t)) return true;
      if (/^[a-z]+[A-Z]\w*$/.test(t)) return true; // camelCase
      if (/^[A-Za-z][A-Za-z0-9]*_[\w]+$/.test(t)) return true; // snake_case
      if (/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+(\(\))?$/.test(t)) return true; // obj.prop
      if (/^[\w$:\\]+(::|->)[\w$]+(\(\))?$/.test(t)) return true; // Clase::metodo
      if (/^[\w$]+\(\)$/.test(t)) return true; // fn()
      if (/^--?[a-z][\w-]*(=\S*)?$/.test(t)) return true; // --flag
    }
    if (/^[$>#]\s+\S/.test(t)) return true; // prompt de shell
    if (/^<[/!]?[\w-][^<>]*>$/.test(t)) return true; // etiqueta HTML escrita como texto: <code>, </div>, <!DOCTYPE>
    const sym = (t.match(/[{}()[\];=<>$|&*`\\]/g) || []).length;
    if (t.length >= 8 && sym / t.length > 0.12 && /[{};=]/.test(t)) return true;
    return false;
  }

  function hintFor(host, mono) {
    let h = host.localName;
    if (host.closest('nav,menu,[role=menu],[role=menubar],[role=navigation],[role=tablist],[role=toolbar]')) h = 'ui';
    else if (host.closest('button,[role=button]')) h = 'button';
    else if (['span', 'div', 'section', 'article', 'main', 'aside'].includes(h)) {
      h = host.closest('header,footer') ? 'ui' : h === 'span' ? 'span' : 'div';
    }
    return mono ? `${h} mono` : h;
  }

  /* ---------------------------------------------------------------- */
  /* Recolección de segmentos                                         */
  /* ---------------------------------------------------------------- */

  function buildItems(nodes, ctx) {
    const items = [];
    let s = '';
    for (const n of Array.from(nodes)) {
      if (ctx.only && !ctx.only(n)) continue;
      if (n.nodeType === 3) {
        items.push({ k: 't', node: n });
        ctx.texts.push(n);
        s += ctx.clip ? ctx.clip(n) : n.nodeValue;
      } else if (n.nodeType === 1) {
        if (n.id === BADGE_ID) continue;
        if (isAtom(n, ctx.hostMono)) {
          const id = ctx.atoms.length;
          ctx.atoms.push(n);
          items.push({ k: 'x', id, node: n });
          const tc = n.textContent || '';
          s += `${/^\s/.test(tc) ? ' ' : ''}<x${id}/>${/\s$/.test(tc) ? ' ' : ''}`;
        } else {
          const id = ctx.groups.length;
          ctx.groups.push(n);
          const sub = buildItems(n.childNodes, ctx);
          items.push({ k: 'g', id, node: n, children: sub.items });
          s += `<g${id}>${sub.s}</g${id}>`;
        }
      }
    }
    return { items, s };
  }

  // Los espacios de borde van fuera de las marcas: con "<g0>Complete HTML </g0>Reference" o "HTML <x0/>Tag", el
  // Traductor de Chrome pega la palabra siguiente y desordena la frase.
  function spacesOutside(s) {
    return s.replace(/\s+/g, ' ')
      .replace(/ ((?:<\/g\d+>)+)/g, '$1 ')
      .replace(/((?:<g\d+>)+) /g, ' $1')
      .replace(/ {2,}/g, ' ');
  }

  function makeSegment(host, run, out) {
    const hostMono = hasDirectText(host) && isMono(host);
    let ctx = { texts: [], atoms: [], groups: [], hostMono };
    let { items, s } = buildItems(run, ctx);
    if (!ctx.texts.length) return;
    if (ctx.texts.every((n) => known.has(n) && known.get(n) === n.nodeValue)) return; // ya procesado

    // La página cambió un texto que ya habíamos traducido (React, Vue...): deshacemos con cuidado
    // lo nuestro (sin pisar lo que cambió la página) y volvemos a capturar la frase.
    const olds = new Set();
    for (const n of ctx.texts) {
      const o = segOf.get(n);
      if (o && o.applied && !o.stale) olds.add(o);
    }
    if (olds.size) {
      olds.forEach(supersede);
      run = run.filter((n) => n.parentNode === host);
      ctx = { texts: [], atoms: [], groups: [], hostMono };
      ({ items, s } = buildItems(run, ctx));
      if (!ctx.texts.length) return;
    }

    const collapsed = spacesOutside(s);
    const src = collapsed.trim();
    const plain = src.replace(TAG_RE, ' ').trim();
    if (!LETTER_RE.test(plain)) return;
    if (!ctx.groups.length && looksLikeCode(plain)) return;
    // Varias líneas monoespaciadas sin estructura: muy probablemente código.
    if (hostMono && looksLikeCode(plain)) return;

    const seg = {
      kind: 'text',
      host,
      run: run.slice(),
      items,
      ctx,
      src,
      lead: /^\s/.test(collapsed),
      trail: /\s$/.test(collapsed),
      hint: hintFor(host, hostMono),
      captured: ctx.texts.map((n) => n.nodeValue),
      state: 'new',
      attempts: 0,
    };
    for (const n of ctx.texts) {
      const old = segOf.get(n);
      if (old && old !== seg) old.stale = true;
      segOf.set(n, seg);
      known.set(n, n.nodeValue);
    }
    out.push(seg);
  }

  function collect(el, out) {
    if (el.nodeType !== 1) return;
    if (el !== document.body && el !== document.documentElement && skipSubtree(el)) return;
    let run = [];
    const flush = () => {
      if (run.length) makeSegment(el, run, out);
      run = [];
    };
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 3) {
        run.push(child);
        continue;
      }
      if (child.nodeType !== 1) continue;
      if (child.id === BADGE_ID) { flush(); continue; }
      const tag = child.localName;
      if (SKIP_TAGS.has(tag) || REPLACED_TAGS.has(tag) || isProtected(child)) {
        // Código, imágenes, inputs...: si están en línea viajan dentro de la frase como <xN/>;
        // si son bloque cortan la frase y se ignoran.
        if (isInlineEl(child)) run.push(child);
        else flush();
        continue;
      }
      if (tag !== 'button' && isInlineEl(child) && !hasBlockDesc(child)) {
        run.push(child);
      } else {
        flush();
        collect(child, out);
      }
    }
    flush();
  }

  function inSkipped(el) {
    if (isProtected(el)) return true;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      if (skipSubtree(a)) return true;
    }
    return false;
  }

  function collectAttrs(root, out) {
    const list = [];
    if (root.matches && root.matches('[placeholder],[title],[alt],[aria-label]')) list.push(root);
    if (root.querySelectorAll) list.push(...root.querySelectorAll('[placeholder],[title],[alt],[aria-label]'));
    for (const el of list) {
      if (el.id === BADGE_ID || el.closest(`#${BADGE_ID}`) || inSkipped(el)) continue;
      const exp = attrKnown.get(el) || {};
      for (const attr of ATTRS) {
        const v = el.getAttribute(attr);
        if (!v || exp[attr] === v) continue;
        const t = v.trim().replace(/\s+/g, ' ');
        if (!LETTER_RE.test(t) || looksLikeCode(t) || t.length > 500) continue;
        exp[attr] = v;
        attrKnown.set(el, exp);
        out.push({ kind: 'attr', el, host: el, attr, orig: v, src: t, hint: 'ui', state: 'new', attempts: 0 });
      }
    }
  }

  function observeTarget(el) {
    let t = el;
    while (t && t !== document.body && display(t) === 'contents') t = t.parentElement;
    return t || el;
  }

  function registerSegments(list) {
    for (const seg of list) {
      segments.push(seg);
      const target = observeTarget(seg.host);
      if (!hostSegs.has(target)) {
        hostSegs.set(target, []);
        io.observe(target);
      }
      hostSegs.get(target).push(seg);
      seg.observed = true;
    }
  }

  function scan(root) {
    const out = [];
    collect(root, out);
    collectAttrs(root, out);
    registerSegments(out);
    return out;
  }

  /* ---------------------------------------------------------------- */
  /* Perfil de contexto                                               */
  /* ---------------------------------------------------------------- */

  function gatherPageInfo() {
    const text = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
    const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
      .map(text).filter(Boolean).slice(0, 25).map((h) => h.slice(0, 120));
    const inlineCode = [...new Set(
      Array.from(document.querySelectorAll('code,kbd,tt,samp'))
        .filter((el) => !el.closest('pre'))
        .map(text)
        .filter((t) => t && t.length <= 60)
    )].slice(0, 40);
    let sample = '';
    for (const seg of segments) {
      if (seg.kind !== 'text') continue;
      const p = seg.src.replace(TAG_RE, '').trim();
      if (p.length < 3) continue;
      sample += `- ${p.slice(0, 240)}\n`;
      if (sample.length > 2800) break;
    }
    return {
      url: location.href.split('#')[0],
      title: document.title,
      lang: document.documentElement.lang || '',
      description: document.querySelector('meta[name="description"]')?.content?.slice(0, 300) || '',
      headings,
      inlineCode,
      stats: {
        codeBlocks: document.querySelectorAll('pre').length,
        inlineCode: document.querySelectorAll('code').length,
        editors: document.querySelectorAll('.monaco-editor,.cm-editor,.CodeMirror,.ace_editor').length,
        forms: document.querySelectorAll('form').length,
        segments: segments.length,
      },
      sample,
    };
  }

  function ensureProfile() {
    // En local el perfil cuesta segundos y Nano lo arma mal: marca frases comunes como intocables.
    if (!settings.contextFirst || aitIsLocal(settings)) return Promise.resolve(null);
    const key = location.href.split('#')[0];
    if (profilePromise && profileKey === key) return profilePromise;
    profileKey = key;
    analyzing = true;
    updateBadge();
    // Con LM Studio u Ollama el perfil tarda de 8 s a más de 30 s; el límite es el de fetchJSON().
    const timeout = new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: 'timeout' }), aitLocalServer(settings) ? 120000 : 30000));
    profilePromise = Promise.race([
      chrome.runtime.sendMessage({ type: 'profile', data: gatherPageInfo() }),
      timeout,
    ])
      .then((r) => {
        if (!r?.ok) {
          if (r?.fatal) fatalError = r.error;
          return null;
        }
        profile = r.profile;
        return profile;
      })
      .catch(() => null)
      .finally(() => {
        analyzing = false;
        updateBadge();
      });
    return profilePromise;
  }

  /* ---------------------------------------------------------------- */
  /* Cola y lotes                                                     */
  /* ---------------------------------------------------------------- */

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const segs = hostSegs.get(e.target);
      hostSegs.delete(e.target);
      io.unobserve(e.target);
      if (segs) segs.forEach((s) => { s.observed = false; enqueue(s); });
    }
    if (starting) { starting = false; updateBadge(); }
  }, { rootMargin: '800px 0px 800px 0px' });

  function enqueue(seg) {
    if (seg.state !== 'new' || seg.stale) return;
    seg.state = 'queued';
    queue.push(seg);
    scheduleFlush();
  }

  function scheduleFlush(delay = 120) {
    if (!flushTimer) flushTimer = setTimeout(flushQueue, delay);
  }

  function flushQueue() {
    flushTimer = null;
    if (mode !== 'translated' || fatalError) { updateBadge(); return; }
    if (Date.now() < pausedUntil) { scheduleFlush(pausedUntil - Date.now() + 50); return; }
    const type = aitProviderType(settings);
    // Gemini Nano: ventana de contexto pequeña y un solo prompt a la vez. El Traductor de Chrome es rápido: lotes grandes.
    const limit = type === 'chrome' ? 4000 : Math.max(500, Number(settings.maxChars) || 2500);
    const conc = aitIsLocal(settings) ? 1 : Math.max(1, Number(settings.concurrency) || 3);
    while (inflight < conc && queue.length) {
      const batch = [];
      let chars = 0;
      while (queue.length && batch.length < 60) {
        const seg = queue[0];
        if (seg.stale) { queue.shift(); continue; }
        const memo = pageMemo.get(seg.src);
        if (memo !== undefined) {
          queue.shift();
          if (!finishSeg(seg, memo)) seg.state = 'error';
          continue;
        }
        if (batch.length && chars + seg.src.length > limit) break;
        queue.shift();
        batch.push(seg);
        chars += seg.src.length;
      }
      if (batch.length) sendBatch(batch, false);
    }
    updateBadge();
  }

  function tickPause() {
    if (pauseTicker) return;
    pauseTicker = setInterval(() => {
      updateBadge();
      if (Date.now() >= pausedUntil) { clearInterval(pauseTicker); pauseTicker = null; }
    }, 1000);
  }

  function startKeepAlive() {
    if (keepAlive) return;
    // Mantiene vivo el service worker mientras hay peticiones largas en curso.
    keepAlive = setInterval(() => {
      if (inflight + fallbacks > 0) chrome.runtime.sendMessage({ type: 'ping' }).catch(() => {});
      else { clearInterval(keepAlive); keepAlive = null; }
    }, 20000);
  }

  async function sendBatch(batch, noCache) {
    // Nano tarda segundos por reintento: si ocupara el turno, frenaría al Traductor de Chrome.
    const fallback = noCache && aitProviderType(settings) === 'chrome';
    if (fallback) fallbacks++;
    else inflight++;
    startKeepAlive();
    batch.forEach((s) => { s.state = 'sending'; });
    updateBadge();

    const groups = new Map();
    for (const s of batch) {
      if (!groups.has(s.src)) groups.set(s.src, []);
      groups.get(s.src).push(s);
    }
    const items = [...groups.keys()].map((src, i) => ({ id: i, h: groups.get(src)[0].hint, t: src }));

    try {
      await ensureProfile();
      if (fatalError) throw aitFatal(fatalError);
      const res = await chrome.runtime.sendMessage({
        type: 'translate',
        items,
        profile,
        page: { url: location.href.split('#')[0], title: document.title, lang: document.documentElement.lang || '' },
        sourceLang: srcLang,
        noCache,
        retry: noCache,
      });
      if (!res?.ok) throw Object.assign(new Error(res?.error || aitT('errNoReply')), { fatal: res?.fatal });
      const retry = [];
      for (const it of items) {
        const tr = res.results[it.id];
        for (const s of groups.get(it.t)) {
          if (typeof tr === 'string' && finishSeg(s, tr)) continue;
          retry.push(s);
        }
      }
      const again = [];
      for (const s of retry) {
        s.attempts++;
        if (s.attempts <= 1) {
          s.state = 'queued';
          again.push(s);
        } else {
          s.state = 'error';
        }
      }
      // Reintento sin caché (la IA rompió las etiquetas o se saltó el segmento): de a uno, salvo con una IA que
      // corrige al Traductor, que los recibe juntos para no gastar una consulta por frase.
      if (settings.provider === 'hybrid' && again.length) setTimeout(() => sendBatch(again, true), 0);
      else for (const s of again) setTimeout(() => sendBatch([s], true), 0);
    } catch (e) {
      const msg = e?.message || String(e);
      if (msg === 'TRUNCATED' && batch.length > 1) {
        const half = Math.ceil(batch.length / 2);
        batch.forEach((s) => { s.state = 'queued'; });
        setTimeout(() => {
          sendBatch(batch.slice(0, half), noCache);
          sendBatch(batch.slice(half), noCache);
        }, 0);
      } else if (msg.startsWith('RATE_LIMIT')) {
        // Límite de la capa gratis: esperar lo que pide la API y seguir, sin gastar reintentos.
        const secs = Math.max(5, Number(msg.split(':')[1]) || 15);
        pausedUntil = Date.now() + secs * 1000;
        batch.forEach((s) => { s.state = 'queued'; });
        queue.unshift(...batch);
        clearTimeout(flushTimer);
        flushTimer = null;
        scheduleFlush(secs * 1000 + 50);
        tickPause();
      } else if (e?.fatal) {
        fatalError = msg;
        batch.forEach((s) => { s.state = 'new'; });
        queue.forEach((s) => { s.state = 'new'; });
        queue = [];
      } else {
        const wait = /429/.test(msg) ? 8000 : 1500;
        for (const s of batch) {
          s.attempts++;
          if (s.attempts <= 2) { s.state = 'queued'; queue.unshift(s); } else s.state = 'error';
        }
        if (!/429/.test(msg)) console.warn('[Traductor IA]', msg);
        clearTimeout(flushTimer);
        flushTimer = null;
        scheduleFlush(wait);
        lastSoftError = msg;
      }
    } finally {
      if (fallback) fallbacks--;
      else inflight--;
      scheduleFlush();
      updateBadge();
    }
  }

  /* ---------------------------------------------------------------- */
  /* Aplicar y revertir                                               */
  /* ---------------------------------------------------------------- */

  function parseTagged(str, nG, nX) {
    const root = { children: [] };
    const stack = [root];
    const seenG = new Set();
    const seenX = new Set();
    const top = () => stack[stack.length - 1];
    let last = 0;
    let m;
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(str))) {
      if (m.index > last) top().children.push(str.slice(last, m.index));
      last = TAG_RE.lastIndex;
      if (m[3] !== undefined) {
        const id = +m[3];
        if (id >= nX || seenX.has(id)) return null;
        seenX.add(id);
        top().children.push({ x: id });
      } else if (m[2] !== undefined && m[1] === '') {
        const id = +m[2];
        if (id >= nG || seenG.has(id)) return null;
        seenG.add(id);
        const node = { g: id, children: [] };
        top().children.push(node);
        stack.push(node);
      } else if (m[2] !== undefined) {
        const id = +m[2];
        if (stack.length < 2 || top().g !== id) return null;
        stack.pop();
      }
      // </xN> sobrante: se ignora.
    }
    if (last < str.length) top().children.push(str.slice(last));
    if (stack.length !== 1 || seenG.size !== nG || seenX.size !== nX) return null;
    return root;
  }

  // La IA a veces envuelve la frase en la etiqueta del hint (<p>…</p>): se quita si el original no la tenía.
  function stripWrapperTag(translation, src) {
    const m = /^\s*<([a-z][a-z0-9]*)>([\s\S]*)<\/\1>\s*$/i.exec(translation);
    if (!m || /^[gx]\d+$/i.test(m[1]) || src.toLowerCase().includes(`<${m[1].toLowerCase()}>`)) return translation;
    return m[2];
  }

  function finishSeg(seg, translation) {
    if (seg.stale) return true;
    translation = stripWrapperTag(translation, seg.src);
    if (seg.kind === 'attr') {
      seg.translation = translation.trim() || seg.src;
    } else {
      const parsed = parseTagged(translation, seg.ctx.groups.length, seg.ctx.atoms.length);
      if (!parsed) return false;
      seg.translation = translation;
      seg.parsed = parsed;
    }
    pageMemo.set(seg.src, translation);
    seg.state = 'done';
    if (mode === 'translated') applySeg(seg);
    updateBadge();
    return true;
  }

  function elemSeqItems(items) {
    return items.filter((i) => i.k !== 't').map((i) => i.k + i.id).join(',');
  }
  function elemSeqParsed(children) {
    return children.filter((c) => typeof c !== 'string').map((c) => (c.x !== undefined ? `x${c.x}` : `g${c.g}`)).join(',');
  }
  function sameShape(items, children) {
    if (elemSeqItems(items) !== elemSeqParsed(children)) return false;
    const pg = children.filter((c) => typeof c !== 'string');
    const og = items.filter((i) => i.k !== 't');
    for (let i = 0; i < og.length; i++) {
      if (og[i].k === 'g' && !sameShape(og[i].children, pg[i].children)) return false;
    }
    return true;
  }

  function isStale(seg) {
    if (seg.stale) return true;
    if (seg.kind === 'attr') return !seg.el.isConnected || seg.el.getAttribute(seg.attr) !== seg.orig;
    const t = seg.ctx.texts;
    for (let i = 0; i < t.length; i++) {
      if (!t[i].isConnected || t[i].nodeValue !== seg.captured[i]) return true;
    }
    return !seg.run.every((n) => n.isConnected);
  }

  function edgeSpaces(seg, text, first, lastGap) {
    let t = text;
    if (first && seg.lead && !/^\s/.test(t)) t = ` ${t}`;
    if (lastGap && seg.trail && !/\s$/.test(t)) t = `${t} `;
    return t;
  }

  function applyInPlace(seg, items, children, undo, isRoot) {
    const elems = items.filter((i) => i.k !== 't');
    const gapsO = [[]];
    for (const it of items) {
      if (it.k === 't') gapsO[gapsO.length - 1].push(it.node);
      else gapsO.push([]);
    }
    const gapsP = [''];
    for (const c of children) {
      if (typeof c === 'string') gapsP[gapsP.length - 1] += c;
      else gapsP.push('');
    }
    for (let k = 0; k <= elems.length; k++) {
      let txt = gapsP[k] || '';
      if (isRoot) txt = edgeSpaces(seg, txt, k === 0, k === elems.length);
      const nodes = gapsO[k];
      if (nodes.length) {
        nodes.forEach((n, i) => {
          undo.texts.push([n, n.nodeValue]);
          n.nodeValue = i === 0 ? txt : '';
          known.set(n, n.nodeValue);
        });
      } else if (txt) {
        const tn = document.createTextNode(txt);
        known.set(tn, txt);
        if (k < elems.length) elems[k].node.parentNode.insertBefore(tn, elems[k].node);
        else elems[k - 1].node.parentNode.insertBefore(tn, elems[k - 1].node.nextSibling);
        undo.created.push(tn);
      }
    }
    const pg = children.filter((c) => typeof c !== 'string');
    elems.forEach((e, i) => {
      if (e.k === 'g') applyInPlace(seg, e.children, pg[i].children, undo, false);
    });
  }

  function applyRebuild(seg, undo) {
    const first = seg.run[0];
    const parent = first.parentNode;
    const anchor = document.createTextNode('');
    known.set(anchor, '');
    parent.insertBefore(anchor, first);
    const rb = {
      anchor,
      parent,
      run: seg.run.slice(),
      groupChildren: seg.ctx.groups.map((g) => Array.from(g.childNodes)),
      newTop: [],
    };
    undo.rebuild = rb;

    const build = (children) => {
      const frag = document.createDocumentFragment();
      for (const c of children) {
        if (typeof c === 'string') {
          if (!c) continue;
          const tn = document.createTextNode(c);
          known.set(tn, c);
          frag.appendChild(tn);
        } else if (c.x !== undefined) {
          frag.appendChild(seg.ctx.atoms[c.x]);
        } else {
          const el = seg.ctx.groups[c.g];
          const inner = build(c.children);
          el.replaceChildren(inner);
          frag.appendChild(el);
        }
      }
      return frag;
    };

    const rootChildren = seg.parsed.children.slice();
    if (seg.lead) {
      if (typeof rootChildren[0] === 'string') rootChildren[0] = edgeSpaces(seg, rootChildren[0], true, false);
      else rootChildren.unshift(' ');
    }
    if (seg.trail) {
      const li = rootChildren.length - 1;
      if (typeof rootChildren[li] === 'string') rootChildren[li] = edgeSpaces(seg, rootChildren[li], false, true);
      else rootChildren.push(' ');
    }
    const frag = build(rootChildren);
    rb.newTop = Array.from(frag.childNodes);
    for (const n of seg.run) if (n.parentNode === parent) parent.removeChild(n);
    parent.insertBefore(frag, anchor.nextSibling);
  }

  // Modo bilingüe: solo párrafos, títulos e ítems de lista (hintFor ya deja como 'ui' lo de menús y navegación);
  // un párrafo o ítem corto es una etiqueta y se traduce como siempre.
  function isBilingual(seg) {
    if (!settings.bilingual || seg.kind !== 'text') return false;
    if (/^h[1-6]$/.test(seg.hint)) return true;
    return (seg.hint === 'p' || seg.hint === 'li') && seg.src.replace(TAG_RE, ' ').trim().split(/\s+/).length >= 3;
  }

  // La traducción en un bloque aparte, debajo del original: como applyRebuild(), pero con copias de los enlaces,
  // negritas y átomos, así el original queda intacto.
  function bilingualBlock(seg) {
    const build = (children) => {
      const frag = document.createDocumentFragment();
      for (const c of children) {
        if (typeof c === 'string') frag.append(c);
        else if (c.x !== undefined) frag.append(seg.ctx.atoms[c.x].cloneNode(true));
        else {
          const el = seg.ctx.groups[c.g].cloneNode(false);
          el.append(build(c.children));
          frag.append(el);
        }
      }
      return frag;
    };
    const box = document.createElement('span');
    box.setAttribute('translate', 'no');
    box.className = 'notranslate ait-bilingue';
    // Para que el lector de pantalla lo lea con la voz del idioma de destino.
    const lang = aitLangCode(settings.targetLang);
    if (lang) box.lang = lang;
    // Pegada al original y con el riel verde de "traducido": se lee como parte del mismo bloque, en fondo claro u oscuro.
    box.style.cssText = 'display:block;margin-top:.25em;padding-left:.7em;border-left:3px solid #1f9d7f;font-size:.92em;';
    box.append(build(seg.parsed.children));
    box.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    return box;
  }

  function applySeg(seg) {
    if (seg.applied || !seg.translation) return;
    if (isStale(seg)) { seg.stale = true; return; }
    if (seg.kind === 'attr') {
      seg.el.setAttribute(seg.attr, seg.translation);
      const exp = attrKnown.get(seg.el) || {};
      exp[seg.attr] = seg.translation;
      attrKnown.set(seg.el, exp);
      seg.applied = true;
      return;
    }
    seg.applied = true;
    if (seg.translation.trim() === seg.src) { seg.undo = null; return; } // sin cambios: no tocar el DOM
    const undo = { texts: [], created: [], rebuild: null };
    try {
      if (isBilingual(seg)) {
        const box = bilingualBlock(seg);
        const last = seg.run[seg.run.length - 1];
        last.parentNode.insertBefore(box, last.nextSibling);
        undo.created.push(box);
      } else if (sameShape(seg.items, seg.parsed.children)) applyInPlace(seg, seg.items, seg.parsed.children, undo, true);
      else applyRebuild(seg, undo);
    } catch (e) {
      console.warn('[Traductor IA] no se pudo aplicar un segmento', e);
    }
    seg.undo = undo;
  }

  // Retira un segmento reemplazado: restaura solo los nodos que siguen teniendo nuestro texto.
  function supersede(seg) {
    seg.stale = true;
    const u = seg.undo;
    seg.undo = null;
    if (!u || u.rebuild) return;
    for (const [n, v] of u.texts) {
      if (known.get(n) === n.nodeValue) { n.nodeValue = v; known.set(n, v); }
    }
    for (const n of u.created) {
      if (n.nodeType === 1 || known.get(n) === n.nodeValue) n.remove();
    }
  }

  function undoSeg(seg) {
    if (!seg.applied || seg.stale) return;
    seg.applied = false;
    if (seg.kind === 'attr') {
      if (seg.el.isConnected) {
        seg.el.setAttribute(seg.attr, seg.orig);
        const exp = attrKnown.get(seg.el) || {};
        exp[seg.attr] = seg.orig;
        attrKnown.set(seg.el, exp);
      }
      return;
    }
    const u = seg.undo;
    if (!u) return;
    try {
      for (let i = u.texts.length - 1; i >= 0; i--) {
        const [n, v] = u.texts[i];
        n.nodeValue = v;
        known.set(n, v);
      }
      u.created.forEach((n) => n.remove());
      if (u.rebuild) {
        const rb = u.rebuild;
        rb.newTop.forEach((n) => { if (n.parentNode === rb.parent) n.remove(); });
        seg.ctx.groups.forEach((g, i) => g.replaceChildren(...rb.groupChildren[i]));
        const frag = document.createDocumentFragment();
        rb.run.forEach((n) => frag.appendChild(n));
        rb.parent.insertBefore(frag, rb.anchor.nextSibling);
        rb.anchor.remove();
      }
    } catch (e) {
      console.warn('[Traductor IA] no se pudo restaurar un segmento', e);
    }
    seg.undo = null;
  }

  /* ---------------------------------------------------------------- */
  /* Contenido dinámico                                               */
  /* ---------------------------------------------------------------- */

  let pendingRoots = new Set();
  let rescanTimer = null;

  const mo = new MutationObserver((records) => {
    if (mode !== 'translated') return;
    for (const r of records) {
      if (r.type === 'characterData') {
        const n = r.target;
        if (known.get(n) === n.nodeValue) continue;
        if (n.parentElement) pendingRoots.add(n.parentElement);
      } else if (r.type === 'childList') {
        for (const n of r.addedNodes) {
          if (n.nodeType === 3) {
            if (known.get(n) === n.nodeValue) continue;
            if (n.parentElement) pendingRoots.add(n.parentElement);
          } else if (n.nodeType === 1 && n.id !== BADGE_ID) {
            pendingRoots.add(n);
          }
        }
      }
    }
    if (pendingRoots.size && !rescanTimer) rescanTimer = setTimeout(processRescan, 500);
  });

  function processRescan() {
    rescanTimer = null;
    if (mode !== 'translated') { pendingRoots.clear(); return; }
    // Profile nuevo si cambió la URL (SPA).
    if (settings.contextFirst && profileKey !== location.href.split('#')[0]) {
      profilePromise = null;
    }
    resetCaches();
    const hosts = new Set();
    for (let el of pendingRoots) {
      if (!el.isConnected) continue;
      while (el.parentElement && el !== document.body && isInlineEl(el)) el = el.parentElement;
      hosts.add(el);
    }
    pendingRoots = new Set();
    const list = [...hosts].filter((h) => ![...hosts].some((o) => o !== h && o.contains(h)));
    for (const h of list) {
      if (h !== document.body && inSkipped(h)) continue;
      scan(h);
    }
  }

  function startObserving() {
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  /* ---------------------------------------------------------------- */
  /* Modos                                                            */
  /* ---------------------------------------------------------------- */

  function loadUserSkip() {
    const host = location.hostname;
    const sels = [];
    for (const raw of (settings.skipSelectors || '').split('\n')) {
      let line = raw.trim();
      if (!line || line.startsWith('//')) continue;
      if (line.startsWith('@')) {
        const sp = line.indexOf(' ');
        if (sp < 0) continue;
        const dom = line.slice(1, sp);
        if (!(host === dom || host.endsWith('.' + dom))) continue;
        line = line.slice(sp + 1).trim();
      }
      try { document.querySelector(line); sels.push(line); } catch { /* selector inválido */ }
    }
    userSkip = sels.join(',');
  }

  function translatePage() {
    if (!document.body) return;
    if (mode === 'translated') return;
    if (mode === 'original') { showTranslated(); return; }
    mode = 'translated';
    fatalError = '';
    lastSoftError = '';
    loadUserSkip();
    resetCaches();
    try { bodyMono = MONO_RE.test((getComputedStyle(document.body).fontFamily || '').split(',')[0]); } catch { bodyMono = false; }
    ensureBadge();
    scan(document.body);
    starting = hostSegs.size > 0;
    ensureProfile();
    startObserving();
    notifyState();
    updateBadge();
  }

  function showOriginal() {
    if (mode !== 'translated') return;
    mode = 'original';
    mo.disconnect();
    for (let i = segments.length - 1; i >= 0; i--) undoSeg(segments[i]);
    notifyState();
    updateBadge();
  }

  function showTranslated() {
    if (mode !== 'original') return;
    mode = 'translated';
    for (const seg of segments) if (seg.translation && !seg.stale) applySeg(seg);
    resetCaches();
    scan(document.body);
    startObserving();
    scheduleFlush();
    notifyState();
    updateBadge();
  }

  function stopAll() {
    if (mode === 'translated') showOriginal();
    mo.disconnect();
    io.disconnect();
    hostSegs.clear();
    segments = [];
    queue = [];
    pageMemo.clear();
    // Lo ya procesado se olvida: si no, al volver a traducir (otro idioma) el escaneo saltaba todo.
    known = new WeakMap();
    segOf = new WeakMap();
    attrKnown = new WeakMap();
    mode = 'off';
    profile = null;
    profilePromise = null;
    profileKey = '';
    fatalError = '';
    starting = false;
    removeBadge();
    notifyState();
  }

  function toggle() {
    if (mode === 'off') translatePage();
    else if (mode === 'translated') showOriginal();
    else showTranslated();
  }

  function notifyState() {
    chrome.runtime.sendMessage({ type: 'state', mode }).catch(() => {});
  }

  function stats() {
    let done = 0;
    let pending = 0;
    let errors = 0;
    for (const s of segments) {
      if (s.stale) continue;
      if (s.state === 'done') done++;
      else if (s.state === 'queued' || s.state === 'sending') pending++;
      else if (s.state === 'error') errors++;
    }
    return { done, pending, errors };
  }

  /* ---------------------------------------------------------------- */
  /* Indicador flotante                                               */
  /* ---------------------------------------------------------------- */

  let badgeHost = null;
  let badgeEls = null;
  let badgeHidden = false;

  function ensureBadge() {
    if (!settings.showBadge || badgeHidden || badgeHost) return;
    badgeHost = document.createElement('div');
    badgeHost.id = BADGE_ID;
    badgeHost.setAttribute('translate', 'no');
    badgeHost.className = 'notranslate';
    const root = badgeHost.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .pill { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; display: flex; align-items: center; gap: 10px;
          font: 500 13px/1.25 system-ui, -apple-system, "Segoe UI", sans-serif; color: #e6e9f1; background: #1b2238;
          border: 1px solid #39425c; border-radius: 999px; padding: 6px 6px 6px 14px; box-shadow: 0 8px 24px rgba(10, 14, 30, .3);
          opacity: 1; max-width: min(480px, calc(100vw - 32px)); }
        .pill.idle { opacity: .5; }
        .pill:hover, .pill:focus-within { opacity: 1; }
        .dot { width: 9px; height: 9px; border-radius: 50%; background: #3fc6a3; flex: none; }
        .dot.busy { background: #3fc6a3; }
        .dot.err { background: #ff8a80; }
        .dot.orig { background: #a0a8bc; }
        .msg { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
        button { all: unset; cursor: pointer; padding: 5px 12px; border-radius: 999px; background: #2b3349; color: #e6e9f1; font: inherit; font-weight: 600; flex: none; }
        button:hover { background: #3a4460; }
        button:focus-visible { outline: 2px solid #8db4ff; outline-offset: 1px; }
        .x { padding: 5px 9px; }
        .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
        @media (prefers-reduced-motion: no-preference) {
          .pill { transition: opacity .3s; }
          .dot.busy { animation: p 1s infinite alternate; }
        }
        @keyframes p { to { opacity: .3; } }
      </style>
      <div class="pill"><span class="dot"></span><span class="msg"></span><button class="tg" type="button"></button><button class="x" type="button">✕</button></div>
      <span class="sr" role="status"></span>`;
    badgeEls = {
      pill: root.querySelector('.pill'),
      dot: root.querySelector('.dot'),
      msg: root.querySelector('.msg'),
      tg: root.querySelector('.tg'),
      x: root.querySelector('.x'),
      live: root.querySelector('.sr'),
    };
    badgeEls.x.setAttribute('aria-label', aitT('badgeHide'));
    badgeEls.x.title = aitT('hide');
    badgeEls.tg.addEventListener('click', toggle);
    badgeEls.x.addEventListener('click', () => { badgeHidden = true; removeBadge(); });
    document.documentElement.appendChild(badgeHost);
  }

  function removeBadge() {
    badgeHost?.remove();
    badgeHost = null;
    badgeEls = null;
  }

  let idleTimer = null;
  function updateBadge() {
    if (!badgeEls && mode !== 'off') ensureBadge();
    if (!badgeEls) return;
    const { done, pending, errors } = stats();
    const b = badgeEls;
    b.dot.className = 'dot';
    b.pill.classList.remove('idle');
    clearTimeout(idleTimer);
    if (mode === 'original') {
      b.dot.classList.add('orig');
      b.msg.textContent = aitT('viewingOriginal');
      b.tg.textContent = aitT('translate');
    } else if (fatalError) {
      b.dot.classList.add('err');
      b.msg.textContent = fatalError;
      b.msg.title = fatalError;
      b.tg.textContent = aitT('showOriginal');
    } else if (Date.now() < pausedUntil) {
      b.dot.classList.add('busy');
      b.msg.textContent = aitT('badgeRateLimit', Math.ceil((pausedUntil - Date.now()) / 1000), done, done + pending);
      b.tg.textContent = aitT('showOriginal');
    } else if (analyzing || starting) {
      b.dot.classList.add('busy');
      b.msg.textContent = aitT('analyzing');
      b.tg.textContent = aitT('showOriginal');
    } else if (pending > 0) {
      b.dot.classList.add('busy');
      b.msg.textContent = aitT('progress', done, done + pending);
      b.tg.textContent = aitT('showOriginal');
    } else {
      b.msg.textContent = errors ? aitT('badgeDoneErrors', settings.targetLang, errors) : aitT('badgeDone', settings.targetLang);
      b.msg.title = lastSoftError || '';
      b.tg.textContent = aitT('showOriginal');
      idleTimer = setTimeout(() => b.pill.classList.add('idle'), 2500);
    }
    // Al lector de pantalla solo le llega el resultado (terminó, falló, original): el avance sería ruido.
    const say = b.dot.classList.contains('busy') ? '' : b.msg.textContent;
    if (b.live.textContent !== say) b.live.textContent = say;
  }

  /* ---------------------------------------------------------------- */
  /* Traducir la selección                                            */
  /* ---------------------------------------------------------------- */

  // shortcut: tope fijo; una selección más larga se traduce con la página entera.
  const SEL_MAX = 5000;
  const MARCA = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#0b7a63"/><path d="M5.5 17.5 10 6l4.5 11.5M7.2 13.6h5.6" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><rect x="14.5" y="14.5" width="14" height="14" rx="4" fill="#cdbfff"/><path d="M21.5 16.3v1.3M17.2 18.6h8.6M18.8 19c.7 3.3 2.8 5.6 6 6.9M24.2 19c-.7 3.3-2.8 5.6-6 6.9" fill="none" stroke="#3d2b8f" stroke-width="1.7" stroke-linecap="round"/><path d="M19 6.5c3.4 0 6 2.4 6.3 5.6" fill="none" stroke="#cdbfff" stroke-width="2" stroke-linecap="round"/><path d="m23.2 11 2.1 2.2 2.2-2.1" fill="none" stroke="#cdbfff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  let selHost = null;
  let selEls = null;
  let selPicked = null;
  let selLast = null;
  let selLang = '';
  // Idioma de origen elegido a mano (popup para la página, tarjeta para la selección), hasta recargar; '' = detectar.
  let srcLang = '';
  let selSrc = '';
  // En un campo, el destino es el idioma de la página (`lang` del pick) y el selector de la tarjeta cambia ese.
  const selTarget = () => selLast?.lang || selLang || settings.targetLang;
  let selSeq = 0;
  // Lo que esperaba un idioma del Traductor: se vuelve a traducir cuando la ventana de descarga avisa.
  let selDownload = null;

  function ensureSel() {
    if (selEls) return selEls;
    selHost = document.createElement('div');
    selHost.setAttribute('translate', 'no');
    selHost.className = 'notranslate';
    const root = selHost.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .boton { position: fixed; z-index: 2147483647; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 8px;
          background: none; cursor: pointer; box-shadow: 0 4px 12px rgba(10, 14, 30, .35); }
        .boton:hover { box-shadow: 0 4px 16px rgba(10, 14, 30, .6), 0 0 0 2px #cdbfff; }
        .boton svg { display: block; width: 100%; height: 100%; }
        .boton:focus-visible, button:focus-visible { outline: 2px solid #8db4ff; outline-offset: 2px; }
        .tarjeta { position: fixed; inset: auto; margin: 0; box-sizing: border-box; width: min(480px, calc(100vw - 16px));
          color-scheme: dark; padding: 0; border: 1px solid #39425c; border-radius: 14px; background: #1b2238; color: #e6e9f1;
          font: 400 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; box-shadow: 0 16px 40px rgba(10, 14, 30, .45);
          touch-action: manipulation; }
        .tarjeta:focus-visible { outline: 2px solid #5d6a92; outline-offset: -1px; }
        .tarjeta__arriba { display: flex; align-items: center; gap: 10px; padding: 12px 12px 0 18px; font-size: 13px; color: #a0a8bc; }
        .tarjeta__marca { flex: none; width: 22px; height: 22px; }
        .tarjeta__marca svg { display: block; width: 100%; height: 100%; }
        .tarjeta__lenguas { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; }
        .tarjeta__par { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .tarjeta__par[hidden], .tarjeta__idioma[hidden] { display: none; }
        .tarjeta__cuerpo { padding: 12px 18px 16px; }
        .tarjeta__original { margin: 0; padding-left: 10px; border-left: 2px solid #39425c; color: #a0a8bc; font-size: 14px;
          overflow-wrap: anywhere; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; }
        .tarjeta__original[hidden] { display: none; }
        .tarjeta__tipo { margin: 2px 0 0; font-size: 13px; font-style: italic; color: #a0a8bc; }
        .tarjeta__traduccion { margin: 12px 0 0; font-size: 17px; font-weight: 500; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere;
          max-height: 55vh; overflow-y: auto; overscroll-behavior: contain; }
        .tarjeta__traduccion > * { margin: 0; }
        .tarjeta__traduccion > * + * { margin-top: 10px; }
        .tarjeta__traduccion pre { padding: 10px 12px; border-left: 2px solid #8f7ae0; border-radius: 0 8px 8px 0; background: rgba(205, 191, 255, .08);
          color: #cdbfff; white-space: pre-wrap; font: 400 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
        .tarjeta__traduccion code { padding: 1px 5px; border-radius: 5px; background: rgba(205, 191, 255, .14); color: #cdbfff;
          font: 400 .85em ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
        .tarjeta__traduccion--palabra { font-size: 22px; font-weight: 600; line-height: 1.3; }
        .tarjeta__traduccion--espera { font-size: 15px; font-weight: 400; color: #a0a8bc; }
        .tarjeta__traduccion--error { font-size: 14px; font-weight: 400; color: #ff8a80; }
        .tarjeta__significados { margin: 6px 0 0; font-size: 14px; color: #c9cfdd; }
        .tarjeta__acciones { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 8px 12px; border-top: 1px solid #2e3650; }
        .tarjeta__acciones[hidden] { display: none; }
        .tarjeta__accion { all: unset; flex: none; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; padding: 6px 10px; border-radius: 8px;
          color: #c9cfdd; font-size: 13px; font-weight: 600; }
        .tarjeta__accion svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
        .tarjeta__accion:hover { background: #2b3349; color: #fff; }
        .tarjeta__accion[hidden] { display: none; }
        .tarjeta__bajar { margin-top: 12px; }
        .tarjeta__ir { padding: 7px 14px; background: #0b7a63; color: #fff; }
        .tarjeta__ir:hover { background: #0e8f74; }
        .tarjeta__cerrar { all: unset; flex: none; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; cursor: pointer;
          font-size: 14px; color: #a0a8bc; }
        .tarjeta__cerrar:hover { background: #2b3349; color: #fff; }
        .tarjeta__aviso { flex: 1 1 auto; text-align: end; padding-right: 6px; font-size: 12px; color: #3fc6a3; }
        .tarjeta__editar { display: grid; justify-items: end; gap: 8px; margin: 0; }
        .tarjeta__editar[hidden] { display: none; }
        .tarjeta__texto { box-sizing: border-box; width: 100%; max-height: 30vh; padding: 8px 10px; border: 1px solid #39425c;
          border-radius: 8px; background: #11172a; color: #e6e9f1; font: 400 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; resize: vertical; }
        .tarjeta__texto:focus-visible { outline: 2px solid #8db4ff; outline-offset: 1px; }
        .tarjeta__idioma { min-width: 0; max-width: 180px; padding: 3px 6px; border: 1px solid #39425c; border-radius: 6px; background: #232b44;
          color: #e6e9f1; font: 600 13px system-ui, -apple-system, "Segoe UI", sans-serif; cursor: pointer; }
        .tarjeta__idioma:hover { background: #2b3349; }
        .tarjeta__idioma:focus-visible { outline: 2px solid #8db4ff; outline-offset: 2px; }
      </style>
      <button class="boton" type="button" hidden>${MARCA}</button>
      <div class="tarjeta" popover role="dialog" tabindex="-1">
        <div class="tarjeta__arriba">
          <span class="tarjeta__marca">${MARCA}</span>
          <span class="tarjeta__lenguas"><span class="tarjeta__par"></span><select class="tarjeta__idioma tarjeta__origen" hidden></select> → <select class="tarjeta__idioma tarjeta__destino"></select></span>
          <button class="tarjeta__cerrar" type="button">✕</button>
        </div>
        <div class="tarjeta__cuerpo">
          <p class="tarjeta__original"></p>
          <form class="tarjeta__editar" hidden>
            <textarea class="tarjeta__texto" rows="3"></textarea>
            <button class="tarjeta__accion tarjeta__ir" type="submit"></button>
          </form>
          <div class="tarjeta__traduccion" aria-live="polite"></div>
          <p class="tarjeta__tipo" hidden></p>
          <p class="tarjeta__significados" hidden></p>
          <button class="tarjeta__accion tarjeta__ir tarjeta__bajar" type="button" hidden></button>
        </div>
        <div class="tarjeta__acciones" hidden>
          <button class="tarjeta__accion tarjeta__ir tarjeta__cambiar" type="button" hidden></button>
          <button class="tarjeta__accion tarjeta__copiar" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg><span></span></button>
          <button class="tarjeta__accion tarjeta__oir" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg><span></span></button>
          <button class="tarjeta__accion tarjeta__edita" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg><span></span></button>
          <span class="tarjeta__aviso" role="status"></span>
        </div>
      </div>`;
    const q = (c) => root.querySelector(c);
    selEls = {
      boton: q('.boton'), tarjeta: q('.tarjeta'), par: q('.tarjeta__par'), cerrar: q('.tarjeta__cerrar'),
      original: q('.tarjeta__original'), tipo: q('.tarjeta__tipo'), traduccion: q('.tarjeta__traduccion'),
      significados: q('.tarjeta__significados'), acciones: q('.tarjeta__acciones'), copiar: q('.tarjeta__copiar'),
      oir: q('.tarjeta__oir'), aviso: q('.tarjeta__aviso'), idioma: q('.tarjeta__destino'), origen: q('.tarjeta__origen'),
      editar: q('.tarjeta__editar'), texto: q('.tarjeta__texto'), ir: q('.tarjeta__editar .tarjeta__ir'), edita: q('.tarjeta__edita'),
      bajar: q('.tarjeta__bajar'), cambiar: q('.tarjeta__cambiar'),
    };
    const e = selEls;
    e.boton.setAttribute('aria-label', aitT('menuSelection'));
    e.boton.title = aitT('menuSelection');
    e.tarjeta.setAttribute('aria-label', aitT('translation'));
    e.cerrar.setAttribute('aria-label', aitT('selClose'));
    e.idioma.setAttribute('aria-label', aitT('translateTo'));
    e.origen.setAttribute('aria-label', aitT('translateFrom'));
    e.origen.addEventListener('change', () => {
      selSrc = e.origen.value;
      if (selLast) translateSelection(selLast);
    });
    // Solo para la tarjeta: la página y los ajustes siguen con su idioma.
    e.idioma.addEventListener('change', () => {
      if (selLast?.lang) selLast.lang = e.idioma.value;
      else selLang = e.idioma.value;
      if (selLast) translateSelection(selLast);
    });
    e.copiar.lastChild.textContent = aitT('selCopy');
    e.oir.lastChild.textContent = aitT('selListen');
    e.edita.lastChild.textContent = aitT('selEdit');
    e.ir.textContent = aitT('translate');
    e.bajar.textContent = aitT('download');
    e.bajar.addEventListener('click', () => {
      if (selDownload) chrome.runtime.sendMessage({ type: 'download', pair: selDownload.pair });
    });
    e.texto.setAttribute('aria-label', aitT('selEditLabel'));
    // Traducción a medida: el usuario cambia el texto y se traduce entero, sin la estructura de la página.
    e.edita.addEventListener('click', () => {
      e.texto.value = selLast?.text || '';
      e.original.hidden = true;
      e.editar.hidden = false;
      e.texto.focus();
    });
    e.editar.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const text = e.texto.value.trim();
      if (text && selLast) translateSelection({ ...selLast, text, range: null });
    });
    e.texto.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) e.editar.requestSubmit();
    });
    // Sin esto, el clic en el botón borra la selección antes de leerla.
    e.boton.addEventListener('mousedown', (ev) => ev.preventDefault());
    e.boton.addEventListener('click', () => { if (selPicked) translateSelection(selPicked); });
    e.cerrar.addEventListener('click', () => e.tarjeta.hidePopover());
    e.tarjeta.addEventListener('toggle', (ev) => {
      if (ev.newState !== 'closed') return;
      speechSynthesis.cancel();
      // Desde un campo, el foco vuelve a él, salvo que el usuario haya hecho clic en otro control.
      if (selLast?.field && [selHost, document.body].includes(document.activeElement)) selLast.el.focus();
    });
    e.cambiar.textContent = aitT('selReplace');
    e.cambiar.addEventListener('click', () => replaceInField(selLast, e.traduccion.innerText));
    e.copiar.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(e.traduccion.innerText);
        e.aviso.textContent = aitT('selCopied');
      } catch {
        e.aviso.textContent = aitT('selCopyFail');
      }
    });
    e.oir.addEventListener('click', () => {
      speechSynthesis.cancel();
      // El código no se lee en voz alta.
      const u = new SpeechSynthesisUtterance([...e.traduccion.children].filter((c) => c.localName !== 'pre').map((c) => c.textContent).join('\n'));
      u.lang = aitLangCode(selTarget());
      // Sin voz o sin audio, Chrome avisa con un error en vez de sonar: se muestra.
      u.onerror = (ev) => {
        if (ev.error === 'interrupted' || ev.error === 'canceled') return;
        e.aviso.textContent = aitT('selListenFail', ev.error);
        if (ev.error === 'synthesis-failed') {
          e.oir.hidden = true;
          e.tarjeta.focus({ preventScroll: true });
        }
      };
      speechSynthesis.speak(u);
    });
    // La lista de voces llega después de la primera consulta.
    speechSynthesis.addEventListener('voiceschanged', () => { if (!e.acciones.hidden) e.oir.hidden = !canSpeak(); });
    speechSynthesis.getVoices();
    document.documentElement.appendChild(selHost);
    return selEls;
  }

  // Sin voz para el idioma de destino no se ofrece escuchar: Brave en Linux no trae ninguna.
  function canSpeak() {
    const lang = aitLangCode(selTarget()).split('-')[0].toLowerCase();
    return speechSynthesis.getVoices().some((v) => v.lang.toLowerCase().startsWith(lang));
  }

  // Lo seleccionado y dónde está. Sin `editable`, nada dentro de un campo: ahí se selecciona para escribir.
  function pickSelection(editable) {
    const sel = getSelection();
    const text = sel?.toString().trim();
    if (!text || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el) return null;
    if (!editable && (el.isContentEditable || document.activeElement?.matches?.('input, textarea'))) return null;
    const rects = range.getClientRects();
    return { text, el, range: range.cloneRange(), rect: rects[rects.length - 1] || range.getBoundingClientRect() };
  }

  // Lo seleccionado en un campo donde se escribe: se traduce al idioma de la página y se puede reemplazar.
  function pickField() {
    const lang = document.documentElement.lang;
    const target = lang ? aitUiTarget(lang) : '';
    let f = document.activeElement;
    while (f?.shadowRoot?.activeElement) f = f.shadowRoot.activeElement;
    // Nunca una contraseña: solo textarea y campos de texto o búsqueda.
    if ((f?.localName === 'textarea' || (f?.localName === 'input' && ['text', 'search'].includes(f.type))) && !f.readOnly && !f.disabled) {
      const raw = f.value.slice(f.selectionStart, f.selectionEnd);
      const text = raw.trim();
      if (!text) return null;
      const start = f.selectionStart + raw.indexOf(text);
      return { text, el: f, rect: f.getBoundingClientRect(), lang: target, field: { start, end: start + text.length, orig: text } };
    }
    const pick = pickSelection(true);
    if (!pick?.el.isContentEditable) return null;
    return { ...pick, range: null, lang: target, field: { range: pick.range, orig: pick.range.toString() } };
  }

  // Cambia lo seleccionado por la traducción como si se escribiera: Ctrl+Z lo deshace y React ve el cambio.
  function replaceInField(pick, text) {
    const f = pick?.field;
    if (!f) return;
    const el = pick.el;
    if ((f.range ? f.range.toString() : el.value.slice(f.start, f.end)) !== f.orig) {
      selEls.aviso.textContent = aitT('selReplaceStale');
      return;
    }
    selEls.tarjeta.hidePopover();
    el.focus();
    if (f.range) getSelection().setBaseAndExtent(f.range.startContainer, f.range.startOffset, f.range.endContainer, f.range.endOffset);
    else el.setSelectionRange(f.start, f.end);
    if (document.execCommand('insertText', false, text)) return;
    if (f.range) {
      f.range.deleteContents();
      f.range.insertNode(document.createTextNode(text));
    } else el.setRangeText(text, f.start, f.end, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Una sola palabra, sin la puntuación de los bordes: con IA lleva tipo y significados.
  function oneWord(text) {
    const w = text.replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, '');
    return w.length <= 30 && !/\s/.test(w) && LETTER_RE.test(w) ? w : '';
  }

  // La frase de donde sale la palabra: la IA elige el significado que corresponde.
  function sentenceAround(el, word) {
    const block = el.closest('p, li, td, th, dd, dt, h1, h2, h3, h4, h5, h6, blockquote, figcaption') || el;
    const all = block.textContent.replace(/\s+/g, ' ');
    const i = Math.max(0, all.indexOf(word));
    return all.slice(Math.max(0, i - 150), i + word.length + 150).trim();
  }

  // La selección por bloques, con el recorrido de collect(): un ítem por título, párrafo o ítem de lista; el código en
  // bloque queda aparte y tal cual, y el de línea viaja como átomo. Dentro de código o sin bloques, null.
  function selectionBlocks(range) {
    let root = range.commonAncestorContainer;
    if (root.nodeType !== 1) root = root.parentElement;
    if (!root || inSkipped(root)) return null;
    const blocks = [];
    const only = (n) => range.intersectsNode(n);
    const clip = (n) => {
      let v = n.nodeValue;
      if (n === range.endContainer) v = v.slice(0, range.endOffset);
      if (n === range.startContainer) v = v.slice(range.startOffset);
      return v;
    };
    const addRun = (host, run) => {
      const hostMono = hasDirectText(host) && isMono(host);
      const ctx = { texts: [], atoms: [], groups: [], hostMono, only, clip };
      const src = spacesOutside(buildItems(run, ctx).s).trim();
      const plain = src.replace(TAG_RE, ' ').trim();
      if (!plain && !ctx.atoms.length) return;
      // Lo mismo que makeSegment() no manda a traducir (números, una URL, una línea de código) se muestra tal cual.
      const keep = !LETTER_RE.test(plain) || ((!ctx.groups.length || hostMono) && looksLikeCode(plain));
      blocks.push({ src, atoms: ctx.atoms, groups: ctx.groups.length, hint: hintFor(host, hostMono), keep });
    };
    const walk = (el) => {
      let run = [];
      const flush = () => {
        if (run.length) addRun(el, run);
        run = [];
      };
      for (const child of Array.from(el.childNodes)) {
        if (!only(child)) continue;
        if (child.nodeType === 3) { run.push(child); continue; }
        if (child.nodeType !== 1 || child.id === BADGE_ID || child === selHost) continue;
        const tag = child.localName;
        // Nuestra traducción bilingüe es prosa, aunque lleve translate="no" para que el escaneo no la retraduzca.
        if (child.classList.contains('ait-bilingue')) { flush(); walk(child); continue; }
        if (SKIP_TAGS.has(tag) || REPLACED_TAGS.has(tag) || isProtected(child)) {
          if (isInlineEl(child)) { run.push(child); continue; }
          flush();
          if (isProtected(child)) {
            const r = document.createRange();
            r.selectNodeContents(child);
            if (range.compareBoundaryPoints(Range.START_TO_START, r) > 0) r.setStart(range.startContainer, range.startOffset);
            if (range.compareBoundaryPoints(Range.END_TO_END, r) < 0) r.setEnd(range.endContainer, range.endOffset);
            const code = r.toString().replace(/^\n+|\s+$/g, '');
            if (code) blocks.push({ code });
          }
          continue;
        }
        if (tag !== 'button' && isInlineEl(child) && !hasBlockDesc(child)) run.push(child);
        else { flush(); walk(child); }
      }
      flush();
    };
    walk(root);
    return blocks.length ? blocks : null;
  }

  // Texto con marcas → nodos: un átomo vuelve como <code> con su texto original; un grupo, como su texto.
  function renderTagged(parent, str, atoms) {
    let last = 0;
    let m;
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(str))) {
      parent.append(str.slice(last, m.index));
      last = TAG_RE.lastIndex;
      const atom = m[3] !== undefined ? atoms[+m[3]] : null;
      const text = atom?.textContent.trim();
      if (text) {
        const c = document.createElement('code');
        c.textContent = text;
        parent.append(c);
      } else if (atom?.localName === 'br') parent.append('\n');
    }
    parent.append(str.slice(last));
  }

  // Debajo de la selección; arriba si no entra.
  function placeNear(box, rect) {
    const top = rect.bottom + 8 + box.offsetHeight > innerHeight - 8 ? rect.top - box.offsetHeight - 8 : rect.bottom + 8;
    box.style.top = `${Math.max(8, top)}px`;
    box.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - box.offsetWidth - 8))}px`;
  }

  function hideSelButton() {
    if (selEls) selEls.boton.hidden = true;
  }

  async function translateSelection(pick) {
    const e = ensureSel();
    const seq = ++selSeq;
    hideSelButton();
    const lang = document.documentElement.lang || '';
    let from = aitT('pageLang');
    try { from = new Intl.DisplayNames([AIT_UI_LANG], { type: 'language' }).of(lang) || from; } catch { /* sin lang */ }
    // En un campo, el origen es lo que escribe el usuario, no el idioma de la página.
    const auto = aitT('srcAuto');
    if (pick.field) from = auto;
    selLast = pick;
    // Elegir el origen solo sirve con el Traductor de Chrome: la IA lo reconoce sola.
    const pickSrc = aitProviderType(settings) === 'chrome';
    e.par.hidden = pickSrc;
    e.par.textContent = from;
    e.origen.hidden = !pickSrc;
    if (pickSrc) {
      e.origen.replaceChildren(new Option(pick.field ? from : `${from} (${auto})`, ''), ...AIT_LANGUAGES.map((l) => new Option(l)));
      e.origen.value = selSrc;
    }
    e.idioma.replaceChildren(...[...new Set([selTarget(), ...AIT_LANGUAGES])].map((l) => new Option(l)));
    e.idioma.value = selTarget();
    e.original.textContent = pick.text;
    e.original.hidden = false;
    e.editar.hidden = true;
    e.tipo.hidden = true;
    e.significados.hidden = true;
    e.acciones.hidden = true;
    e.cambiar.hidden = !pick.field;
    e.bajar.hidden = true;
    selDownload = null;
    e.aviso.textContent = '';
    e.traduccion.className = 'tarjeta__traduccion tarjeta__traduccion--espera';
    e.traduccion.textContent = aitT('selTranslating');
    if (!e.tarjeta.matches(':popover-open')) e.tarjeta.showPopover();
    placeNear(e.tarjeta, pick.rect);
    e.tarjeta.focus({ preventScroll: true });

    const word = oneWord(pick.text);
    const ai = aitProviderType(settings) !== 'chrome' || settings.provider === 'hybrid';
    const page = { url: location.href.split('#')[0], title: document.title, lang };
    let lookup = null;
    let blocks = null;
    try {
      if (pick.text.length > SEL_MAX) throw new Error(aitT('selTooLong', SEL_MAX));
      if (word && ai) {
        const res = await chrome.runtime.sendMessage({ type: 'lookup', word, context: sentenceAround(pick.el, word), targetLang: selTarget() });
        if (res?.ok) lookup = res.lookup;
        else if (res?.fatal || /^RATE_LIMIT/.test(res?.error)) throw new Error(res.error);
      }
      if (lookup) blocks = [{ tr: lookup.translation, atoms: [] }];
      else {
        blocks = (!word && pick.range && selectionBlocks(pick.range)) || [{ src: pick.text, atoms: [], groups: 0, hint: 'p' }];
        const todo = blocks.filter((b) => b.src && !b.keep);
        const send = async (list, retry) => {
          const res = await chrome.runtime.sendMessage({
            type: 'translate',
            items: list.map((b, id) => ({ id, h: b.hint, t: b.src })),
            profile,
            page,
            targetLang: selTarget(),
            sourceLang: selSrc,
            noCache: retry,
            retry,
          });
          if (!res?.ok) throw Object.assign(new Error(res?.error || aitT('errNoReply')), { download: res?.download });
          list.forEach((b, i) => { if (typeof res.results[i] === 'string') b.tr = stripWrapperTag(res.results[i], b.src); });
        };
        if (todo.length) {
          await send(todo, false);
          // Etiquetas rotas: un reintento sin caché, como en la página. Si falla, queda lo que hay.
          const broken = todo.filter((b) => b.tr === undefined || !parseTagged(b.tr, b.groups, b.atoms.length));
          if (broken.length) await send(broken, true).catch(() => {});
          if (todo.every((b) => b.tr === undefined)) throw new Error(aitT('errEmpty'));
        }
      }
    } catch (err) {
      if (seq !== selSeq) return;
      const msg = err?.message || String(err);
      const secs = /^RATE_LIMIT:(\d+)/.exec(msg)?.[1];
      e.traduccion.className = 'tarjeta__traduccion tarjeta__traduccion--error';
      e.traduccion.textContent = secs !== undefined ? aitT('selRateLimit', Math.max(5, Number(secs) || 15)) : msg;
      if (err?.download) {
        const code = err.download.split('>')[1];
        let name = code;
        try { name = new Intl.DisplayNames([AIT_UI_LANG], { type: 'language' }).of(code) || code; } catch { /* código raro */ }
        e.traduccion.className = 'tarjeta__traduccion tarjeta__traduccion--espera';
        e.traduccion.textContent = aitT('popupNeedLang', name);
        e.bajar.hidden = false;
        selDownload = { pair: err.download, pick };
      }
      placeNear(e.tarjeta, pick.rect);
      return;
    }
    if (seq !== selSeq) return;
    e.traduccion.className = lookup ? 'tarjeta__traduccion tarjeta__traduccion--palabra' : 'tarjeta__traduccion';
    e.traduccion.replaceChildren(...blocks.map((b) => {
      const el = document.createElement(b.code ? 'pre' : 'p');
      if (b.code) el.textContent = b.code;
      else renderTagged(el, b.tr ?? b.src, b.atoms);
      return el;
    }));
    e.tipo.textContent = lookup?.pos || '';
    e.tipo.hidden = !lookup?.pos;
    e.significados.textContent = (lookup?.meanings || []).join(', ');
    e.significados.hidden = !lookup?.meanings?.length;
    e.oir.hidden = !canSpeak();
    e.acciones.hidden = false;
    if (blocks.some((b) => b.tr !== undefined)) {
      chrome.runtime.sendMessage({ type: 'remember', original: pick.text, translation: e.traduccion.innerText, lang: selTarget() }).catch(() => {});
    }
    placeNear(e.tarjeta, pick.rect);
  }

  // Desde el menú del clic derecho o Alt+S: también dentro de un campo, y con el texto que manda Chrome si no hay selección acá.
  function openSelection(text) {
    const pick = pickField() || pickSelection(true)
      || { text: text.trim(), el: document.body, rect: document.activeElement?.getBoundingClientRect() || new DOMRect(16, 16, 0, 0) };
    if (pick.text) translateSelection(pick);
  }

  document.addEventListener('mouseup', (ev) => {
    if (ev.button !== 0 || ev.target === selHost || !settings?.selectionButton) return;
    // La selección termina de armarse después del mouseup.
    setTimeout(() => {
      selPicked = pickSelection(false);
      if (!selPicked) return hideSelButton();
      const b = ensureSel().boton;
      b.hidden = false;
      b.style.top = `${Math.min(innerHeight - 38, selPicked.rect.bottom + 6)}px`;
      b.style.left = `${Math.max(8, Math.min(innerWidth - 38, selPicked.rect.right - 15))}px`;
    }, 0);
  });
  document.addEventListener('selectionchange', () => { if (selEls && getSelection().isCollapsed) hideSelButton(); });
  addEventListener('scroll', hideSelButton, { passive: true, capture: true });

  /* ---------------------------------------------------------------- */
  /* Mensajes e inicio                                                */
  /* ---------------------------------------------------------------- */

  // El idioma de la interfaz se toma al cargar la página.
  let ready = null;
  const init = () => (ready ??= chrome.runtime.sendMessage({ type: 'contentSettings' }).then(async (s) => {
    settings = { ...AIT_DEFAULTS, ...s };
    await aitLoadUi(s.uiEnglish);
  }));

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'settings') {
      settingsChanged(msg.settings);
      return false;
    }
    (async () => {
      await init();
      switch (msg?.type) {
        case 'toggle': badgeHidden = false; toggle(); break;
        case 'translate': badgeHidden = false; translatePage(); break;
        case 'original': showOriginal(); break;
        case 'restart': stopAll(); badgeHidden = false; translatePage(); break;
        case 'stop': stopAll(); break;
        case 'source':
          srcLang = AIT_LANGUAGES.includes(msg.lang) ? msg.lang : '';
          if (mode !== 'off') { stopAll(); badgeHidden = false; translatePage(); }
          break;
        case 'selection': openSelection(msg.text || ''); break;
        case 'downloaded': if (selDownload) translateSelection(selDownload.pick); break;
        default: break;
      }
      const s = stats();
      sendResponse({
        ok: true,
        mode,
        ...s,
        error: fatalError,
        analyzing: analyzing || starting,
        profile,
        lang: document.documentElement.lang || '',
        src: srcLang,
      });
    })();
    return true;
  });

  function settingsChanged(next) {
    const bilingual = settings?.bilingual;
    settings = { ...AIT_DEFAULTS, ...next };
    // Bilingüe prendido o apagado desde el popup: lo ya traducido se vuelve a aplicar del otro modo, sin pedir nada.
    if (mode === 'translated' && Boolean(bilingual) !== Boolean(settings.bilingual)) {
      for (let i = segments.length - 1; i >= 0; i--) undoSeg(segments[i]);
      for (const seg of segments) if (seg.translation && !seg.stale) applySeg(seg);
    }
    if (fatalError && mode === 'translated') {
      // Puede que el usuario haya corregido la API key: reintentar.
      fatalError = '';
      profilePromise = null;
      segments.forEach((s) => { if (s.state === 'new' && !s.observed && !s.stale) enqueue(s); });
      scheduleFlush();
      updateBadge();
    }
  }

  function pageLangMatchesTarget() {
    const page = (document.documentElement.lang || '').toLowerCase().split('-')[0];
    if (!page) return false;
    return aitLangCode(settings.targetLang).split('-')[0] === page;
  }

  (async () => {
    await init();
    const host = location.hostname;
    if (aitHostMatches(settings.alwaysSites, host) && !aitHostMatches(settings.neverSites, host) && !pageLangMatchesTarget()) {
      translatePage();
    }
  })();
})();
