/* Service worker: llamadas a la IA, caché, perfil de contexto, atajos y menú. */
importScripts('settings.js');

// Las keys viven en storage.local: solo las páginas de la extensión y el service worker lo leen, no los content scripts.
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
  .catch((e) => console.warn('[Traductor IA] setAccessLevel', e));

/* ------------------------------------------------------------------ */
/* Prompts                                                            */
/* ------------------------------------------------------------------ */

function profileSystemPrompt(target) {
  return `You analyze a web page BEFORE it is machine-translated into ${target}.
Your analysis is given to the translator so it understands the context and knows what must stay untouched.

Return ONLY a JSON object with these keys:
{
  "pageType": "documentation | code repository | Q&A / forum | blog / article | news | e-commerce | web app UI | social | other",
  "topic": "one short sentence about what the page is about",
  "domain": "field / technology stack (e.g. 'Magento 2 PHP development', 'cooking', 'finance')",
  "sourceLanguage": "main language of the page",
  "tone": "register to keep (formal, casual, technical, marketing...)",
  "keepVerbatim": ["terms that must NEVER be translated on this page: product, library, framework, API, class, function, command, config key, CLI flag, brand and people names, etc. NOT this page's own interface: its menus, buttons, links, footer and labels (Home, Help Center, Sign in...) are translated."],
  "glossary": { "source term": "preferred ${target} term" },
  "notes": "max 3 short instructions specific to this page (e.g. 'keep Magento admin menu paths in English', 'technical audience: keep standard English jargon like deploy, commit, cache when natural in ${target}')"
}
keepVerbatim is only for names and code. Ordinary words and phrases never go in it, even capitalized menu, link, button or footer labels (Home, Help Center, Privacy Policy, Sign in): the reader needs those in ${target}.
Limits: keepVerbatim max 60 items, glossary max 40 entries. Base everything on the evidence given; do not invent.`;
}

function translateSystemPrompt(s, profile, page) {
  const target = s.targetLang;
  let ctx = '';
  if (page) {
    ctx += `URL: ${page.url}\nTitle: ${page.title}\n`;
  }
  if (profile) {
    if (profile.pageType) ctx += `Page type: ${profile.pageType}\n`;
    if (profile.topic) ctx += `Topic: ${profile.topic}\n`;
    if (profile.domain) ctx += `Domain: ${profile.domain}\n`;
    if (profile.tone) ctx += `Tone: ${profile.tone}\n`;
    if (Array.isArray(profile.keepVerbatim) && profile.keepVerbatim.length) {
      ctx += `Keep verbatim (never translate): ${profile.keepVerbatim.join(' | ')}\n`;
    }
    if (profile.glossary && typeof profile.glossary === 'object' && Object.keys(profile.glossary).length) {
      ctx += `Glossary: ${Object.entries(profile.glossary).map(([a, b]) => `${a} → ${b}`).join(' | ')}\n`;
    }
    if (profile.notes) ctx += `Notes: ${profile.notes}\n`;
  }
  if (s.style) ctx += `User style preferences: ${s.style}\n`;
  // Con el Traductor de Chrome el glosario ya viaja como átomos (aitGlossMark).
  const rules = aitProviderType(s) === 'chrome' ? [] : aitGlossary(s.glossary);
  const glossary = rules.length
    ? `\nUSER GLOSSARY (set by the user; it overrides every rule above):\n${rules.map((r) => (r.to
      ? `- "${r.from}" → always "${r.to}" (inflect it as ${target} grammar requires)`
      : `- "${r.from}" → never translate, keep it as written`)).join('\n')}\n`
    : '';

  return `You are a professional website localization engine. Translate web page text segments into ${target}.

INPUT: a JSON array of segments {"id", "h", "t"}. "t" is the text. "h" is a hint about where it appears (p, h2, li, a, button, ui = navigation/menu/label, td = table cell, caption...). A hint containing "mono" means the text is shown in a monospace font: it is probably code, a command or terminal output, so return it unchanged unless it is clearly natural-language prose meant for the reader.

RULES
1. Placeholder tags: "<gN>…</gN>" wrap formatted or linked text; "<xN/>" stands for an element that must stay unchanged (inline code, image, line break, icon). Keep EVERY tag exactly as written, each one exactly once, properly nested. You may move a tag only when ${target} word order requires it. Never translate, rename, add or drop tags. Never add any other HTML tag: do not wrap the text in <p>, <div> or the hint's tag.
2. NEVER translate: source code, code identifiers (variables, functions, classes, methods, CSS selectors, HTML tags/attributes, config keys, env vars), terminal commands and their flags, file names and paths, URLs, emails, version numbers, keyboard shortcuts, error codes, regular expressions, product / brand / company / library / framework names, usernames, @handles, #hashtags. Keep them verbatim inside the translated sentence.
3. If a whole segment is code, a command, an identifier, a name, a number, or is already in ${target}, return it EXACTLY unchanged.
4. Translate the meaning naturally, as a native ${target} writer would, keeping the original tone and register. Hints "ui", "button", "a", "th" are interface labels: keep them short. Keep punctuation style, emoji, numbers and markdown symbols. Do not add explanations.
5. Use the page context below for consistent terminology. In technical pages keep common English jargon only when a ${target}-speaking developer would naturally keep it.
${glossary}
PAGE CONTEXT
${ctx || '(none)'}
OUTPUT: ONLY a JSON object mapping every segment id to its translation, e.g. {"0":"…","1":"…"}. No markdown fences, no commentary.`;
}

function lookupSystemPrompt(target) {
  return `You are a bilingual dictionary. The user selected one word on a web page and wants it in ${target}.
Use the sentence it comes from to pick the right sense.

Return ONLY a JSON object:
{"translation": "the ${target} translation that fits this sentence", "pos": "part of speech, written in ${target} (e.g. verb, noun)", "meanings": ["up to 3 other common ${target} translations, short"]}
If the word is a name, a brand, code or already in ${target}, return it unchanged as "translation", with "pos" "" and "meanings" [].`;
}

/* ------------------------------------------------------------------ */
/* Llamada al modelo                                                  */
/* ------------------------------------------------------------------ */

function httpError(status, raw, retryHeader) {
  if (status === 429) {
    const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(raw) || /retry in (\d+(?:\.\d+)?)\s*s/i.exec(raw);
    const secs = Math.ceil(Number(m?.[1] || retryHeader) || 0);
    return new Error(`RATE_LIMIT:${secs}`);
  }
  let msg = raw;
  try {
    const j = JSON.parse(raw);
    msg = j.error?.message || j.error || j.message || raw;
    if (typeof msg !== 'string') msg = JSON.stringify(msg);
  } catch { /* texto plano */ }
  msg = String(msg).slice(0, 300);
  // Google responde 400 a una key mal copiada.
  if (status === 401 || status === 403 || /API.?key.?(not valid|invalid)/i.test(msg)) return aitFatal(aitT('errKey', status, msg));
  if (status === 404) return aitFatal(aitT('err404', msg));
  return new Error(`Error ${status}: ${msg}`);
}

/* ---------------- Gemini Nano (en el dispositivo) ---------------- */

let offscreenReady = null;

async function ensureOffscreen() {
  if (chrome.offscreen.hasDocument && await chrome.offscreen.hasDocument()) return;
  if (!offscreenReady) {
    offscreenReady = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_PARSER'],
      justification: 'Ejecutar Gemini Nano, la IA integrada de Chrome, para traducir en el dispositivo.',
    }).catch((e) => {
      if (!/single offscreen|already/i.test(e.message)) throw e;
    }).finally(() => { offscreenReady = null; });
  }
  await offscreenReady;
}

function nanoLangs(s, pageLang) {
  const outLang = aitLangCode(s.targetLang);
  if (!AIT_NANO_LANGS.includes(outLang)) {
    throw aitFatal(aitT('errNanoTarget', s.targetLang));
  }
  const src = String(pageLang || '').toLowerCase().split('-')[0];
  const inLangs = ['en'];
  if (AIT_NANO_LANGS.includes(src) && src !== 'en') inLangs.push(src);
  return { inLangs, outLang };
}

async function callNano(s, system, user, opts) {
  const { inLangs, outLang } = nanoLangs(s, opts.pageLang);
  await ensureOffscreen();
  const r = await chrome.runtime.sendMessage({
    target: 'offscreen', type: 'nano-prompt', system, user, schema: opts.schema, inLangs, outLang,
  });
  if (!r) throw aitFatal(aitT('errNanoNoReply'));
  // Todo error de Nano frena la página, salvo la ventana llena: el content parte el lote.
  if (!r.ok) throw r.error === 'TRUNCATED' ? new Error(r.error) : aitFatal(aitOffscreenText(r.error));
  return r.text;
}

// Detector de idioma de las extensiones (chrome.i18n): respaldo de LanguageDetector, que Brave no trae. Sin un resultado fiable, fallback.
async function detectText(text, fallback) {
  try {
    const r = await chrome.i18n.detectLanguage(String(text).slice(0, 2000));
    const top = r?.isReliable && r.languages?.[0]?.language;
    if (top && top !== 'und') return top.toLowerCase().split('-')[0];
  } catch { /* sin detector */ }
  return fallback;
}

// Translator API en el documento offscreen. texts null = usar Gemini Nano; availability dice por qué.
async function callChromeTranslator(s, texts, pageLang, srcLang) {
  await ensureOffscreen();
  const lang = String(pageLang || '').toLowerCase().split('-')[0];
  const r = await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'chrome-translate',
    texts,
    // El offscreen prueba LanguageDetector primero; esto es lo que usa si no está.
    pageLang: srcLang ? lang : await detectText(texts.join('\n'), lang),
    outLang: aitLangCode(s.targetLang),
    srcLang,
  });
  return r || {};
}

// Si el navegador trae el Traductor para el idioma de destino ('missing' = no existe la API). Se pregunta como en Opciones.
async function translatorAvailability(s) {
  try {
    await ensureOffscreen();
    const dst = aitLangCode(s.targetLang) || 'en';
    const r = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'chrome-status', src: dst === 'en' ? 'es' : 'en', dst });
    return r?.availability || 'missing';
  } catch {
    return 'missing';
  }
}

/* ---------------- Proveedores remotos ---------------- */

function providerBase(s) {
  const preset = AIT_PROVIDERS[s.provider] || AIT_PROVIDERS.custom;
  // Los servicios en la nube tienen dirección fija (Opciones no muestra el campo): una guardada de otro servicio no cuenta.
  const fixed = preset.needsKey && preset.baseUrl;
  let base = (fixed || s.baseUrl || preset.baseUrl || '').replace(/\/+$/, '');
  if (!base) throw aitFatal(aitT('errNoBase'));
  // LM Studio y Ollama sirven la API compatible con OpenAI en /v1; sin ruta, LM Studio responde 200 con un error.
  if (['lmstudio', 'ollama'].includes(s.provider) && /^https?:\/\/[^/]+$/i.test(base)) base += '/v1';
  if (preset.needsKey && !s.apiKey) throw aitFatal(aitT('errNoKey'));
  return base;
}

function authHeaders(type, s) {
  const headers = { 'content-type': 'application/json' };
  if (type === 'anthropic') {
    headers['x-api-key'] = s.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  } else if (type === 'gemini') {
    headers['x-goog-api-key'] = s.apiKey;
  } else if (s.apiKey) {
    headers.authorization = `Bearer ${s.apiKey}`;
  }
  return headers;
}

async function fetchJSON(url, init, timeoutMs = 120000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  let raw;
  try {
    // Una redirección a otro dominio se llevaría x-api-key y x-goog-api-key (fetch solo quita Authorization).
    const withKey = ['authorization', 'x-api-key', 'x-goog-api-key'].some((h) => init?.headers?.[h]);
    res = await fetch(url, { ...init, signal: ctrl.signal, redirect: withKey ? 'error' : 'follow' });
    raw = await res.text();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(aitT('errTimeout'));
    throw aitFatal(aitT('errConnect', new URL(url).host, e.message));
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw httpError(res.status, raw, res.headers.get('retry-after'));
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error(aitT('errUnreadable')); }
  // LM Studio responde 200 con {"error": "..."} a una ruta que no existe.
  if (typeof data?.error === 'string' && Object.keys(data).length === 1) throw new Error(`Error: ${data.error}`);
  return data;
}

const noThinking = new Set(); // modelos de Gemini que rechazaron thinkingConfig

async function callLLM(s, system, user, maxTokens = 8192, opts = {}) {
  const type = aitProviderType(s);
  // El Traductor de Chrome usa Gemini Nano como respaldo.
  if (type === 'chrome') return callNano(s, system, user, opts);
  const base = providerBase(s);
  if (!s.model) throw aitFatal(aitT('errNoModel'));

  const headers = authHeaders(type, s);
  let url;
  let body;
  if (type === 'anthropic') {
    url = `${base}/v1/messages`;
    body = { model: s.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] };
  } else if (type === 'gemini') {
    url = `${base}/models/${s.model}:generateContent`;
    body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { responseMimeType: 'application/json' },
    };
    const thinking = aitGeminiThinking(s.model);
    if (thinking && !noThinking.has(s.model)) body.generationConfig.thinkingConfig = thinking;
  } else {
    url = `${base}/chat/completions`;
    body = {
      model: s.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    };
    // Modelos como gemma4 razonan por defecto en Ollama: ~10 veces más tokens por lote sin mejorar la traducción.
    if (s.provider === 'ollama' && !noThinking.has(s.model)) body.reasoning_effort = 'none';
  }

  const post = () => fetchJSON(url, { method: 'POST', headers, body: JSON.stringify(body) });
  let data;
  try {
    data = await post();
  } catch (e) {
    // Un modelo puede no aceptar ese nivel de thinking (Gemini) o el campo de razonamiento (Ollama): se repite sin él.
    if (body.generationConfig?.thinkingConfig && /thinking/i.test(e.message)) delete body.generationConfig.thinkingConfig;
    else if (body.reasoning_effort && /think|reason/i.test(e.message)) delete body.reasoning_effort;
    else throw e;
    noThinking.add(s.model);
    data = await post();
  }

  let text = '';
  if (type === 'anthropic') {
    text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (data.stop_reason === 'max_tokens') throw new Error('TRUNCATED');
  } else if (type === 'gemini') {
    const c = data.candidates?.[0];
    text = (c?.content?.parts || []).map((p) => p.text || '').join('');
    if (c?.finishReason === 'MAX_TOKENS') throw new Error('TRUNCATED');
  } else {
    const c = data.choices?.[0];
    text = c?.message?.content || '';
    if (Array.isArray(text)) text = text.map((p) => p.text || '').join('');
    if (c?.finish_reason === 'length') throw new Error('TRUNCATED');
  }
  if (!text) throw new Error(aitT('errEmpty'));
  return text;
}

function parseJSON(text) {
  let t = String(text)
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try { return JSON.parse(t); } catch { /* intento siguiente */ }
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return JSON.parse(t.slice(a, b + 1)); } catch { /* sigue */ }
  }
  throw new Error(aitT('errNoJson'));
}

/* ------------------------------------------------------------------ */
/* Caché persistente                                                  */
/* ------------------------------------------------------------------ */

const CACHE_LIMIT = 40000;

function hash(str) {
  // cyrb53
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function modelId(s) {
  return aitProviderType(s) === 'chrome' ? 'chrome-translator' : s.model;
}

// Con el idioma de origen elegido a mano, otra clave: lo guardado con el idioma detectado puede estar mal. Lo mismo con
// el glosario en el prompt de la IA; con el Traductor de Chrome no hace falta: se guarda con los marcadores.
function cacheKey(s, text, src = '') {
  const gloss = aitProviderType(s) !== 'chrome' && s.glossary?.trim() ? `${s.glossary.trim()}\u0001` : '';
  return 'c:' + hash(`${s.targetLang}\u0001${modelId(s)}\u0001${src ? `${src}\u0001` : ''}${gloss}${text}`);
}

async function cacheStore(entries) {
  const keys = Object.keys(entries);
  if (!keys.length) return;
  const { cacheCount = 0 } = await chrome.storage.local.get('cacheCount');
  let count = cacheCount + keys.length;
  if (count > CACHE_LIMIT) {
    await clearCache();
    count = keys.length;
  }
  await chrome.storage.local.set({ ...entries, cacheCount: count });
}

// Las últimas traducciones de la tarjeta de la selección, para el popup. Viven en storage.local (solo contextos de
// confianza): ninguna página las lee.
async function remember(msg) {
  if (!(await aitGetSettings()).keepRecent) return { ok: false };
  const o = String(msg.original || '').trim().slice(0, 5000);
  const t = String(msg.translation || '').trim().slice(0, 10000);
  if (!o || !t) return { ok: false };
  const lang = String(msg.lang || '').slice(0, 60);
  const { history = [] } = await chrome.storage.local.get('history');
  await chrome.storage.local.set({ history: aitAddRecent(history, { o, t, lang, at: Date.now() }) });
  return { ok: true };
}

async function clearCache() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith('c:'));
  if (keys.length) await chrome.storage.local.remove(keys);
  await chrome.storage.local.set({ cacheCount: 0 });
  return keys.length;
}

/* ------------------------------------------------------------------ */
/* Handlers                                                           */
/* ------------------------------------------------------------------ */

// Esquema de salida (lo usa Gemini Nano para garantizar JSON válido).
const PROFILE_SCHEMA = {
  type: 'object',
  properties: {
    pageType: { type: 'string' },
    topic: { type: 'string' },
    domain: { type: 'string' },
    sourceLanguage: { type: 'string' },
    tone: { type: 'string' },
    keepVerbatim: { type: 'array', items: { type: 'string' }, maxItems: 60 },
    glossary: {
      type: 'array',
      maxItems: 40,
      items: {
        type: 'object',
        properties: { source: { type: 'string' }, target: { type: 'string' } },
        required: ['source', 'target'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['pageType', 'topic', 'domain', 'tone', 'keepVerbatim', 'glossary', 'notes'],
};

async function handleProfile(msg) {
  const s = await aitGetSettings();
  const key = `p:${s.targetLang}:${modelId(s)}:${msg.data.url}`;
  try {
    const cached = await chrome.storage.session.get(key);
    if (cached[key]) return { ok: true, profile: cached[key] };
  } catch { /* session storage no disponible */ }

  const d = msg.data;
  const user = [
    `URL: ${d.url}`,
    `Title: ${d.title}`,
    `<html lang>: ${d.lang || '(none)'}`,
    `Meta description: ${d.description || '(none)'}`,
    `Stats: ${JSON.stringify(d.stats)}`,
    `Headings:\n${(d.headings || []).join('\n')}`,
    `Inline code / monospace snippets found inside prose:\n${(d.inlineCode || []).join(' | ') || '(none)'}`,
    `Text sample:\n${d.sample}`,
  ].join('\n\n');

  let text;
  try {
    text = await callLLM(s, profileSystemPrompt(s.targetLang), user, 2048, {
      schema: PROFILE_SCHEMA,
      pageLang: d.lang,
    });
  } catch (e) {
    if (e.message === 'TRUNCATED') return { ok: true, profile: null };
    throw e;
  }
  const p = parseJSON(text);
  const profile = {
    pageType: String(p.pageType || '').slice(0, 80),
    topic: String(p.topic || '').slice(0, 300),
    domain: String(p.domain || '').slice(0, 150),
    sourceLanguage: String(p.sourceLanguage || '').slice(0, 40),
    tone: String(p.tone || '').slice(0, 100),
    keepVerbatim: (Array.isArray(p.keepVerbatim) ? p.keepVerbatim : [])
      .filter((x) => typeof x === 'string' && x.trim())
      .slice(0, 60)
      .map((x) => x.slice(0, 80)),
    glossary: Object.fromEntries(
      (Array.isArray(p.glossary)
        ? p.glossary.map((g) => [g?.source, g?.target])
        : Object.entries(p.glossary && typeof p.glossary === 'object' ? p.glossary : {}))
        .filter(([a, b]) => typeof a === 'string' && typeof b === 'string' && a.trim())
        .slice(0, 40)
    ),
    notes: String(p.notes || '').slice(0, 500),
  };
  // Un término con traducción en el glosario no puede quedar también como intocable.
  const glossed = new Set(Object.keys(profile.glossary).map((k) => k.toLowerCase()));
  profile.keepVerbatim = profile.keepVerbatim.filter((x) => !glossed.has(x.toLowerCase()));
  try { await chrome.storage.session.set({ [key]: profile }); } catch { /* ignore */ }
  return { ok: true, profile };
}

// Las correcciones de "Traductor de Chrome + Google Gemini" van de a una y, si la API pide una pausa (capa gratis), esperan y
// se repiten una vez.
let fixChain = Promise.resolve();
function fixInTurn(call) {
  const job = fixChain.then(async () => {
    try {
      return await call();
    } catch (e) {
      const secs = /^RATE_LIMIT:(\d+)/.exec(e.message)?.[1];
      if (secs === undefined) throw e;
      await new Promise((r) => setTimeout(r, Math.min(60, Math.max(5, Number(secs) || 15)) * 1000));
      return call();
    }
  });
  fixChain = job.catch(() => {});
  return job;
}

// La tarjeta de la selección puede pedir otro idioma: solo uno de la lista.
function withTarget(s, lang) {
  return AIT_LANGUAGES.includes(lang) ? { ...s, targetLang: lang } : s;
}

async function handleTranslate(msg) {
  const s = withTarget(await aitGetSettings(), msg.targetLang);
  // Idioma de origen elegido a mano en el popup o la tarjeta (solo de la lista); si no, se detecta.
  const src = AIT_LANGUAGES.includes(msg.sourceLang) ? aitLangCode(msg.sourceLang) : '';
  const type = aitProviderType(s);
  // El Traductor de Chrome no recibe instrucciones: los términos del glosario viajan como átomos y vuelven al final.
  const gloss = type === 'chrome' ? aitGlossary(s.glossary) : [];
  const subs = {};
  const items = (msg.items || []).map((it) => {
    const m = aitGlossMark(it.t, gloss);
    subs[it.id] = m.subs;
    return m.subs.length ? { ...it, t: m.t } : it;
  });
  const results = {};
  // Sin un término (el traductor perdió el marcador), el fragmento vuelve sin traducción y el content lo reintenta.
  const done = () => {
    for (const [id, list] of Object.entries(subs)) {
      if (!list.length || typeof results[id] !== 'string') continue;
      const back = aitGlossRestore(results[id], list);
      if (back === null) delete results[id];
      else results[id] = back;
    }
    return { ok: true, results };
  };
  let pending = items;

  if (s.useCache && !msg.noCache) {
    const keys = items.map((it) => cacheKey(s, it.t, src));
    const got = await chrome.storage.local.get(keys);
    pending = [];
    items.forEach((it, i) => {
      // Con el Traductor, igual al original suele ser un idioma mal detectado: se vuelve a pedir (es local y gratis).
      if (typeof got[keys[i]] === 'string' && !(type === 'chrome' && got[keys[i]] === it.t)) results[it.id] = got[keys[i]];
      else pending.push(it);
    });
  }

  const local = aitIsLocal(s);
  const hybrid = s.provider === 'hybrid';
  // Los reintentos (etiquetas rotas) van directo a Gemini Nano, o a la IA que corrige.
  let trAvailability = '';
  let trPair = '';
  if (pending.length && type === 'chrome' && !msg.retry) {
    const { texts, availability, pair } = await callChromeTranslator(s, pending.map((it) => it.t), msg.page?.lang, src);
    trAvailability = availability || '';
    trPair = pair || '';
    if (texts) {
      pending.forEach((it, i) => { results[it.id] = texts[i]; });
      if (s.useCache) await cacheStore(Object.fromEntries(pending.filter((it, i) => texts[i] !== it.t).map((it) => [cacheKey(s, it.t, src), results[it.id]])));
      pending = [];
    }
  }

  if (pending.length) {
    // En local, sin URL ni perfil: el prompt de sistema queda igual y Nano reutiliza la sesión entre páginas.
    const system = translateSystemPrompt(s, local ? null : msg.profile, local && !hybrid ? null : msg.page);
    const payload = JSON.stringify(pending.map((it) => ({ id: String(it.id), h: it.h, t: it.t })));
    const ids = pending.map((it) => String(it.id));
    const schema = {
      type: 'object',
      properties: Object.fromEntries(ids.map((id) => [id, { type: 'string' }])),
      required: ids,
      additionalProperties: false,
    };
    let text;
    try {
      const call = () => callLLM(aitApiSettings(s), system, payload, 8192, { schema, pageLang: src || msg.page?.lang });
      text = hybrid && msg.retry ? await fixInTurn(call) : await call();
    } catch (e) {
      // El aviso de abajo puede tapar el error del respaldo: queda en la consola.
      if (type === 'chrome') console.warn('[Traductor IA] Traductor', trPair || '(reintento)', trAvailability || '-', '→ respaldo falló:', e.message);
      // Si el respaldo falla, el segmento queda en el original sin frenar la cola. Con una IA que corrige, una key
      // mal puesta se avisa y un lote demasiado largo lo parte el content.
      if (type === 'chrome' && msg.retry && !msg.test && !(hybrid && (e.fatal || e.message === 'TRUNCATED'))) return done();
      // Nano es solo el respaldo: si el Traductor no tenía el idioma, el aviso habla del Traductor.
      if (!hybrid && e.fatal && ['downloadable', 'downloading', 'unavailable', 'missing'].includes(trAvailability)) {
        const err = aitFatal(aitT(trAvailability === 'unavailable' ? 'errTrLang' : trAvailability === 'missing' ? 'errTrOld' : 'errTrDownload'));
        // La tarjeta de la selección ofrece bajar el par desde ahí.
        if (trAvailability === 'downloadable' || trAvailability === 'downloading') err.download = trPair;
        throw err;
      }
      throw e;
    }
    let obj = parseJSON(text);
    if (obj && typeof obj.translations === 'object') obj = obj.translations;
    const map = {};
    if (Array.isArray(obj)) {
      obj.forEach((o) => { if (o && o.id != null) map[String(o.id)] = o.t ?? o.text ?? o.translation; });
    } else if (obj && typeof obj === 'object') {
      Object.assign(map, obj);
    }
    const toCache = {};
    for (const it of pending) {
      const v = map[String(it.id)];
      if (typeof v === 'string') {
        results[it.id] = v;
        if (s.useCache) toCache[cacheKey(s, it.t, src)] = v;
      }
    }
    await cacheStore(toCache);
  }
  return done();
}

// Una palabra seleccionada: traducción, tipo de palabra y otros significados. Solo con un servicio de IA.
async function handleLookup(msg) {
  const s = withTarget(await aitGetSettings(), msg.targetLang);
  if (aitProviderType(s) === 'chrome' && s.provider !== 'hybrid') return { ok: false, error: 'Sin servicio de IA' };
  const word = String(msg.word || '').slice(0, 60);
  const user = `Word: ${word}\nSentence: ${String(msg.context || '').slice(0, 400)}`;
  const p = parseJSON(await callLLM(aitApiSettings(s), lookupSystemPrompt(s.targetLang), user, 1024));
  const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const translation = str(p.translation, 200);
  if (!translation) throw new Error(aitT('errEmpty'));
  const meanings = (Array.isArray(p.meanings) ? p.meanings : []).map((m) => str(m, 60))
    .filter((m) => m && m.toLowerCase() !== translation.toLowerCase()).slice(0, 3);
  return { ok: true, lookup: { translation, pos: str(p.pos, 40), meanings } };
}

// Modelos de texto que acepta la key, el recomendado aparte. Opciones manda el formulario sin guardar.
async function handleModels(msg) {
  const stored = await aitGetSettings();
  const { provider, baseUrl, apiKey } = msg.settings || {};
  if (!AIT_PROVIDERS[provider]) throw new Error('Servicio desconocido');
  // Lo que falte en el formulario sale de ese mismo servicio, nunca del que está en uso.
  const s = { ...stored, provider, ...aitServiceFields(stored.services, provider) };
  if (typeof baseUrl === 'string') s.baseUrl = baseUrl;
  if (typeof apiKey === 'string') s.apiKey = apiKey;
  const type = aitProviderType(s);
  const headers = authHeaders(type, s);
  const base = providerBase(s);
  let ids;
  let free = [];
  let translation = [];
  if (type === 'gemini') {
    const data = await fetchJSON(`${base}/models?pageSize=1000`, { headers }, 20000);
    ids = (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => String(m.name).replace(/^models\//, ''));
  } else if (type === 'anthropic') {
    const data = await fetchJSON(`${base}/v1/models?limit=1000`, { headers }, 20000);
    ids = (data.data || []).map((m) => m.id);
  } else {
    // La lista de OpenRouter es pública: sin esto, cualquier key daba "La key funciona".
    if (s.provider === 'openrouter') {
      await fetchJSON(`${base}/key`, { headers }, 20000);
      // Los que OpenRouter clasifica para traducir; si falla, el filtro no aparece.
      translation = await fetchJSON(`${base}/models?category=translation`, { headers }, 20000)
        .then((d) => (d.data || []).map((m) => m.id)).catch(() => []);
    }
    const data = await fetchJSON(`${base}/models`, { headers }, 20000);
    const list = data.data || data.models || [];
    ids = list.sort((a, b) => (b.created || 0) - (a.created || 0)).map((m) => m.id || m.name);
    free = list.filter(aitIsFreeModel).map((m) => m.id);
  }
  const models = aitTextModels(ids.filter((id) => typeof id === 'string' && id));
  return {
    ok: true,
    models,
    free: models.filter((id) => free.includes(id)),
    translation: models.filter((id) => translation.includes(id)),
    recommended: aitPickModel(s.provider, models),
  };
}

async function handleTest() {
  const s = await aitGetSettings();
  const r = await handleTranslate({
    noCache: true,
    // Con "Traductor de Chrome + Google Gemini" se prueba Gemini, que corrige: el Traductor ya lo comprueba su estado.
    retry: s.provider === 'hybrid',
    test: true,
    items: [
      { id: 0, h: 'p', t: 'Tap <x0/> to add the <g0>blue jacket</g0> to your cart.' },
      { id: 1, h: 'button', t: 'Sign in' },
    ],
    page: { url: 'https://example.com/shop', title: 'Test' },
  });
  const model = aitIsLocal(aitApiSettings(s)) ? aitT('onDevice', AIT_PROVIDERS[s.provider].label) : aitServiceName(s);
  return { ok: true, sample: r.results, model };
}

/* ------------------------------------------------------------------ */
/* Pestañas, atajo y menú contextual                                  */
/* ------------------------------------------------------------------ */

async function sendToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // La pestaña se abrió antes de instalar la extensión: inyectar y reintentar.
    await chrome.scripting.executeScript({ target: { tabId }, files: ['settings.js', 'content.js'] });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function toggleActiveTab(tab) {
  if (!tab?.id || !/^(https?|file):/.test(tab.url || '')) return;
  try { await sendToTab(tab.id, { type: 'toggle' }); } catch (e) { console.warn('[Traductor IA]', e); }
}

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (command === 'toggle-translate') toggleActiveTab(tab);
  // Sin selección en la página, el content script no abre nada.
  else if (command === 'translate-selection' && tab?.id != null) chrome.tabs.sendMessage(tab.id, { type: 'selection', text: '' }).catch(() => {});
});

// Lo que necesita el content script, sin keys ni direcciones: corre en el proceso de cada página.
function contentSettings(s) {
  const fields = ['provider', 'contextFirst', 'maxChars', 'concurrency', 'skipSelectors', 'showBadge', 'targetLang', 'alwaysSites', 'neverSites', 'uiEnglish', 'selectionButton', 'bilingual'];
  return Object.fromEntries(fields.map((f) => [f, s[f]]));
}

// El content script ya no ve storage.onChanged: se le avisa desde acá.
chrome.storage.onChanged.addListener(async (changes, area) => {
  // Con sessionKeys, cambiar solo la key no toca settings: igual hay que reintentar las pestañas con error.
  if (!(area === 'local' && changes.settings) && !(area === 'session' && changes.keys)) return;
  const settings = contentSettings(await aitGetSettings());
  for (const tab of await chrome.tabs.query({ url: ['http://*/*', 'https://*/*', 'file:///*'] })) {
    chrome.tabs.sendMessage(tab.id, { type: 'settings', settings }).catch(() => { /* sin content script */ });
  }
});

// Apagar "Recientes" borra la lista.
chrome.storage.onChanged.addListener((changes, area) => {
  const { oldValue, newValue } = changes.settings || {};
  if (area === 'local' && oldValue?.keepRecent && !newValue?.keepRecent) chrome.storage.local.remove('history');
});

let uiReady = aitGetSettings().then((s) => aitLoadUi(s.uiEnglish));
chrome.storage.onChanged.addListener((changes, area) => {
  const { oldValue, newValue } = changes.settings || {};
  if (area !== 'local' || !changes.settings || Boolean(oldValue?.uiEnglish) === Boolean(newValue?.uiEnglish)) return;
  uiReady = aitLoadUi(newValue?.uiEnglish)
    .then(() => Promise.all([
      chrome.contextMenus.update('ait-toggle', { title: aitT('menuToggle') }),
      chrome.contextMenus.update('ait-selection', { title: aitT('menuSelection') }),
    ]))
    .catch((e) => console.warn('[Traductor IA]', e));
});

chrome.runtime.onInstalled.addListener(async (details) => {
  await uiReady;
  chrome.contextMenus.create({
    id: 'ait-toggle',
    title: aitT('menuToggle'),
    contexts: ['page'],
  });
  chrome.contextMenus.create({
    id: 'ait-selection',
    title: aitT('menuSelection'),
    contexts: ['selection'],
  });
  if (details.reason !== 'install') return;
  // Sin Traductor de Chrome (Edge, Opera, Chromium…; Brave sí lo trae) se arranca con Gemini y Opciones pide la key.
  if (['missing', 'unavailable'].includes(await translatorAvailability(await aitGetSettings()))) {
    await aitSaveSettings({ provider: 'gemini', ...AIT_PROVIDERS.gemini.tuning });
  }
  chrome.runtime.openOptionsPage();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'ait-toggle') toggleActiveTab(tab);
  if (info.menuItemId === 'ait-selection' && tab?.id && /^(https?|file):/.test(tab.url || '')) {
    sendToTab(tab.id, { type: 'selection', text: info.selectionText || '' }).catch((e) => console.warn('[Traductor IA]', e));
  }
});

/* ------------------------------------------------------------------ */
/* Mensajes                                                           */
/* ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const run = async () => {
    await uiReady;
    // Solo Opciones prueba keys y borra la caché; un content script nunca.
    if (['test', 'models', 'clearCache'].includes(msg?.type) && sender.url?.split(/[?#]/)[0] !== chrome.runtime.getURL('options.html')) {
      return { ok: false, error: 'Mensaje no permitido' };
    }
    switch (msg?.type) {
      case 'uiStrings': return aitEnMessages();
      case 'contentSettings': return contentSettings(await aitGetSettings());
      case 'translate': return handleTranslate(msg);
      case 'profile': return handleProfile(msg);
      case 'lookup': return handleLookup(msg);
      case 'detect': {
        // Idioma del texto seleccionado, para la cabecera de la tarjeta: el lang de la página no dice el de la selección.
        await ensureOffscreen();
        const r = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'detect', text: String(msg.text || '').slice(0, 2000) });
        return { ok: true, lang: r?.lang || await detectText(msg.text || '', '') };
      }
      case 'test': return handleTest();
      case 'models': return handleModels(msg);
      case 'clearCache': return { ok: true, removed: await clearCache() };
      case 'download': {
        // El Traductor solo baja un idioma con un clic en una página de la extensión: la tarjeta abre esta ventana.
        const pair = String(msg.pair || '');
        if (!/^[a-z]{2,3}(-[a-z]+)?>[a-z]{2,3}(-[a-z]+)?$/i.test(pair) || sender.tab?.id == null) return { ok: false, error: 'Mensaje no permitido' };
        await chrome.windows.create({ url: `descargar.html?${new URLSearchParams({ pair, tab: sender.tab.id })}`, type: 'popup', width: 420, height: 280 });
        return { ok: true };
      }
      case 'remember': return sender.tab ? remember(msg) : { ok: false, error: 'Mensaje no permitido' };
      case 'ping': return { ok: true };
      case 'state': {
        const tabId = sender.tab?.id;
        if (tabId != null) {
          const text = msg.mode === 'translated' ? 'IA' : '';
          chrome.action.setBadgeText({ tabId, text });
          chrome.action.setBadgeBackgroundColor({ tabId, color: '#2563eb' });
        }
        return { ok: true };
      }
      default: return { ok: false, error: 'Mensaje desconocido' };
    }
  };
  run()
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: e?.message || String(e), fatal: Boolean(e?.fatal), download: e?.download }));
  return true;
});
