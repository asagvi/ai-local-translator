/* Ejecuta los prompts de Gemini Nano pedidos por el service worker. */

// Sin chrome.i18n en el offscreen: los textos viajan como clave y valores, y los arma aitOffscreenText() en el service worker.
aitT = (key, ...subs) => JSON.stringify({ i18n: [key, ...subs.map(String)] });

const sessions = new Map(); // clave (system + idiomas) -> Promise<session>
let chain = Promise.resolve(); // Nano procesa mejor un prompt a la vez

function baseSession(system, inLangs, outLang) {
  const key = JSON.stringify([system, inLangs, outLang]);
  if (!sessions.has(key)) {
    if (sessions.size >= 3) {
      const [oldKey, oldP] = sessions.entries().next().value;
      sessions.delete(oldKey);
      oldP.then((s) => s.destroy()).catch(() => {});
    }
    const p = aitNanoApi().create({
      ...aitNanoOptions(inLangs, outLang),
      initialPrompts: [{ role: 'system', content: system }],
    });
    p.catch(() => sessions.delete(key));
    sessions.set(key, p);
  }
  return sessions.get(key);
}

async function runPrompt(msg) {
  if (!aitNanoApi()) throw new Error(aitNanoUnavailableMsg('missing'));
  const opts = aitNanoOptions(msg.inLangs, msg.outLang);
  const avail = await aitNanoAvailability(opts);
  if (avail === 'unavailable') throw new Error(aitNanoUnavailableMsg(avail));
  if (avail === 'unsupported-language') throw Object.assign(new Error(''), { name: 'NotSupportedError' });
  if (avail === 'downloadable' || avail === 'downloading') {
    throw Object.assign(new Error(''), { name: 'NotAllowedError' });
  }
  const base = await baseSession(msg.system, msg.inLangs, msg.outLang);
  const session = await base.clone();
  try {
    const options = msg.schema ? { responseConstraint: msg.schema } : undefined;
    return await session.prompt(msg.user, options);
  } finally {
    session.destroy();
  }
}

/* ---------------- Traductor de Chrome (Translator API) ---------------- */

const translators = new Map(); // "src>dst" -> Promise<Translator>
let detector = null;

async function detectLang(text, fallback) {
  try {
    if (typeof LanguageDetector === 'undefined' || (await LanguageDetector.availability()) !== 'available') return fallback;
    detector ??= LanguageDetector.create();
    const [top] = await (await detector).detect(text);
    return top && top.detectedLanguage !== 'und' && top.confidence > 0.5 ? top.detectedLanguage.split('-')[0] : fallback;
  } catch {
    detector = null;
    return fallback;
  }
}

// Una etiqueta suelta sale mal sin contexto ("Settings" → "trastafo", "Save" → "Salvar"); con un marcador delante el
// Traductor la toma como texto de interfaz ("Configuración", "Guardar").
function isLabel(text) {
  return /^[^<\s]+(?:\s+[^<\s]+){0,2}$/.test(text.trim());
}

async function translateOne(tr, text) {
  const label = isLabel(text);
  // A veces devuelve las etiquetas en mayúsculas (<G0>).
  const out = (await tr.translate(label ? `<x0/>${text}` : text)).replace(/<\/?[GX]\d+\s*\/?>/g, (m) => m.toLowerCase());
  return label ? out.replace(/<x0\s*\/?>\s*/g, '') : out;
}

// texts null = el par de idiomas no está listo (availability dice por qué) o falló: el service worker usa Gemini Nano.
async function chromeTranslate({ texts, pageLang, outLang, srcLang }) {
  if (typeof Translator === 'undefined') return { texts: null, availability: 'missing' };
  // El lang del HTML suele estar mal; manda el texto real, salvo que el usuario haya elegido el idioma.
  const src = srcLang || await detectLang(texts.join('\n'), pageLang || 'en');
  if (src === outLang) return { texts };
  const key = `${src}>${outLang}`;
  try {
    if (!translators.has(key)) {
      const availability = await aitTranslatorAvailability(src, outLang);
      if (availability !== 'available') return { texts: null, availability, pair: key };
      const p = Translator.create({ sourceLanguage: src, targetLanguage: outLang });
      p.catch(() => translators.delete(key));
      translators.set(key, p);
    }
    const tr = await translators.get(key);
    return { texts: await Promise.all(texts.map((t) => translateOne(tr, t))) };
  } catch (e) {
    console.warn('[Traductor IA] Translator API:', e);
    return { texts: null };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;
  if (msg.type === 'chrome-translate') {
    chromeTranslate(msg).then((r) => sendResponse({ ok: true, ...r }));
    return true;
  }
  if (msg.type === 'chrome-status') {
    aitTranslatorAvailability(msg.src, msg.dst)
      .then((availability) => sendResponse({ ok: true, availability }))
      .catch(() => sendResponse({ ok: true, availability: 'missing' }));
    return true;
  }
  if (msg.type === 'nano-status') {
    aitNanoAvailability(aitNanoOptions(msg.inLangs, msg.outLang))
      .then((availability) => sendResponse({ ok: true, availability }))
      .catch((e) => sendResponse({ ok: false, error: aitNanoError(e) }));
    return true;
  }
  if (msg.type === 'nano-prompt') {
    const job = chain.then(() => runPrompt(msg));
    chain = job.catch(() => {});
    job
      .then((text) => sendResponse({ ok: true, text }))
      .catch((e) => sendResponse({ ok: false, error: aitNanoError(e) }));
    return true;
  }
  return false;
});
