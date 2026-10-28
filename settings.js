/* Configuración compartida (background, content, popup, opciones). */
/* eslint-disable no-unused-vars */

// Textos de la interfaz en el idioma del navegador (_locales), o en inglés si se eligió "Interfaz en inglés"
// (aitMsgs, lo carga aitLoadUi). Sin chrome.i18n (pruebas en node) devuelve la clave.
const AIT_BROWSER_LANG = globalThis.chrome?.i18n?.getUILanguage?.() || 'en';
let AIT_UI_LANG = AIT_BROWSER_LANG;
let aitMsgs = null;
function aitT(key, ...subs) {
  subs = subs.map((v) => (typeof v === 'number' ? new Intl.NumberFormat(AIT_UI_LANG).format(v) : v));
  if (aitMsgs) return aitMsgs[key]?.message.replace(/\$(\d|\$)/g, (_, n) => (n === '$' ? '$' : String(subs[n - 1] ?? ''))) ?? key;
  return globalThis.chrome?.i18n?.getMessage(key, subs.map(String)) || key;
}

// El documento offscreen no tiene chrome.i18n: sus textos llegan como {"i18n":[clave, ...valores]} (también
// anidados en los valores) y se arman acá, en el idioma de la interfaz.
function aitOffscreenText(text) {
  return String(text).replace(/\{"i18n":.*\}/, (m) => {
    const [key, ...subs] = JSON.parse(m).i18n;
    return aitT(key, ...subs.map(aitOffscreenText));
  });
}

let aitEnCache = null;
function aitEnMessages() {
  return (aitEnCache ??= fetch(chrome.runtime.getURL('_locales/en/messages.json')).then((r) => r.json()));
}

// Se llama antes del primer texto. El content script no puede leer _locales (no es web_accessible): los pide al
// service worker. Si falla, quedan los del navegador.
async function aitLoadUi(english) {
  aitMsgs = english && !AIT_BROWSER_LANG.startsWith('en')
    ? await (location.protocol === 'chrome-extension:' ? aitEnMessages() : chrome.runtime.sendMessage({ type: 'uiStrings' })).catch(() => null)
    : null;
  AIT_UI_LANG = aitMsgs ? 'en' : AIT_BROWSER_LANG;
}

// Pone en el elemento el mensaje key, con los nodos dados en el lugar de $1, $2… (sin innerHTML).
function aitFill(el, key, ...nodes) {
  const msg = aitT(key, ...nodes.map((_, i) => `\u0001${i}\u0001`));
  el.replaceChildren(...msg.split(/\u0001(\d)\u0001/).map((part, i) => (i % 2 ? nodes[Number(part)] : part)));
}

// Páginas de la extensión: data-i18n pone el texto (sus elementos hijos son $1, $2…) y
// data-i18n-attr los atributos ("placeholder:clave aria-label:clave").
function aitLocalize(root = document) {
  document.documentElement.lang = AIT_UI_LANG;
  for (const el of root.querySelectorAll('[data-i18n]')) aitFill(el, el.dataset.i18n, ...el.children);
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split(/\s+/)) {
      const [attr, key] = pair.split(':');
      el.setAttribute(attr, aitT(key));
    }
  }
}

const AIT_PROVIDERS = {
  chrome: {
    get label() { return aitT('svcChromeLabel'); },
    get desc() { return aitT('svcChromeDesc'); },
    type: 'chrome',
    baseUrl: '',
    model: 'chrome-translator',
    modelHint: '',
    needsKey: false,
  },
  // El Traductor de Chrome hace todo; lo que vuelve con las etiquetas rotas lo corrige Gemini.
  hybrid: {
    get label() { return aitT('svcHybridLabel'); },
    get desc() { return aitT('svcHybridDesc'); },
    type: 'chrome',
    baseUrl: '',
    model: '',
    modelHint: '',
    needsKey: false,
  },
  gemini: {
    get label() { return aitT('svcGeminiLabel'); },
    get desc() { return aitT('svcGeminiDesc'); },
    type: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: '',
    get modelHint() { return aitT('hintKeyAuto'); },
    needsKey: true,
    // Pensado para la capa gratis: pocas peticiones, lotes grandes.
    tuning: { maxChars: 6000, concurrency: 1 },
  },
  anthropic: {
    label: 'Claude (Anthropic)',
    get desc() { return aitT('svcAnthropicDesc'); },
    type: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-haiku-5-5',
    get modelHint() { return aitT('hintKeyAuto'); },
    needsKey: true,
  },
  openai: {
    label: 'OpenAI (GPT)',
    get desc() { return aitT('svcOpenaiDesc'); },
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: '',
    get modelHint() { return aitT('hintKeyAuto'); },
    needsKey: true,
  },
  openrouter: {
    label: 'OpenRouter',
    get desc() { return aitT('svcOpenrouterDesc'); },
    type: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: '',
    get modelHint() { return aitT('hintKeyPick'); },
    needsKey: true,
  },
  lmstudio: {
    label: 'LM Studio',
    get desc() { return aitT('svcLmstudioDesc'); },
    type: 'openai',
    baseUrl: 'http://localhost:1234/v1',
    model: '',
    get modelHint() { return aitT('hintLmstudio'); },
    // La GPU atiende de a una consulta.
    tuning: { maxChars: 1500, concurrency: 1 },
    needsKey: false,
  },
  ollama: {
    label: 'Ollama',
    get desc() { return aitT('svcOllamaDesc'); },
    type: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    model: '',
    get modelHint() { return aitT('hintOllama'); },
    // La GPU atiende de a una consulta, y Ollama recorta sin avisar lo que pasa de su contexto (4096 tokens).
    tuning: { maxChars: 1500, concurrency: 1 },
    needsKey: false,
  },
  custom: {
    get label() { return aitT('svcCustomLabel'); },
    get desc() { return aitT('svcCustomDesc'); },
    type: 'openai',
    baseUrl: '',
    model: '',
    get modelHint() { return aitT('hintCustom'); },
    needsKey: false,
  },
};

// Idiomas de la lista: nombre en el propio idioma (es lo que recibe la IA) y código para la Translator API y Nano.
const AIT_LANGS = [
  ['Español', 'es'], ['Español (Latinoamérica)', 'es'], ['English', 'en'], ['Português (Brasil)', 'pt'],
  ['Português (Portugal)', 'pt'], ['Français', 'fr'], ['Deutsch', 'de'], ['Italiano', 'it'], ['Nederlands', 'nl'],
  ['Polski', 'pl'], ['Русский', 'ru'], ['Українська', 'uk'], ['Türkçe', 'tr'], ['العربية', 'ar'], ['עברית', 'he'],
  ['हिन्दी', 'hi'], ['বাংলা', 'bn'], ['Bahasa Indonesia', 'id'], ['Tiếng Việt', 'vi'], ['ไทย', 'th'],
  ['日本語', 'ja'], ['한국어', 'ko'], ['中文 (简体)', 'zh'], ['中文 (繁體)', 'zh-Hant'], ['Svenska', 'sv'],
  ['Dansk', 'da'], ['Norsk', 'no'], ['Suomi', 'fi'], ['Čeština', 'cs'], ['Ελληνικά', 'el'], ['Română', 'ro'],
  ['Magyar', 'hu'], ['Català', 'ca'],
];
const AIT_LANGUAGES = AIT_LANGS.map(([name]) => name);

// Idiomas que acepta Gemini Nano (Prompt API de Chrome).
const AIT_NANO_LANGS = ['en', 'es', 'ja', 'de', 'fr'];

// Códigos que se reconocen por su nombre escrito a mano, además de los de la lista.
const AIT_MORE_CODES = ['ms', 'fa', 'ur', 'sw', 'ta', 'te', 'mr', 'gu', 'kn', 'ml', 'pa', 'sk', 'sl', 'hr', 'sr', 'bg',
  'lt', 'lv', 'et', 'is', 'ga', 'fil', 'af', 'sq', 'az', 'be', 'eu', 'gl', 'ka', 'kk', 'km', 'lo', 'mn', 'my', 'ne',
  'si', 'uz', 'mt', 'cy'];

const aitNorm = (t) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
let aitLangIndex = null;

// Código del idioma, o '' si no se reconoce. Acepta un nombre de la lista, un nombre en español, en inglés, en el
// idioma del navegador o en el propio idioma ("Polaco", "Polish", "Polski"), o un código ("pl", "pt-BR").
function aitLangCode(name) {
  const n = aitNorm(name);
  if (!n) return '';
  if (!aitLangIndex) {
    aitLangIndex = new Map(AIT_LANGS.map(([l, c]) => [aitNorm(l), c]));
    for (const code of [...new Set([...AIT_LANGS.map(([, c]) => c), ...AIT_MORE_CODES])]) {
      for (const loc of ['es', 'en', AIT_BROWSER_LANG, code]) {
        try {
          const label = aitNorm(new Intl.DisplayNames([loc], { type: 'language' }).of(code));
          if (label && !aitLangIndex.has(label)) aitLangIndex.set(label, code);
        } catch { /* locale sin datos */ }
      }
    }
  }
  if (aitLangIndex.has(n)) return aitLangIndex.get(n);
  const raw = String(name).trim();
  const known = [...aitLangIndex.values()].includes(raw.split('-')[0].toLowerCase());
  return /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(raw) && known ? raw : '';
}

// Glosario propio, una regla por línea: "X = Y" traduce X siempre como Y; "X" sola (o "X =") no la traduce.
function aitGlossary(text) {
  return String(text || '').split('\n').map((line) => {
    const i = line.indexOf('=');
    const from = (i < 0 ? line : line.slice(0, i)).trim();
    const to = i < 0 ? '' : line.slice(i + 1).trim();
    return { from, to: to || null };
  }).filter((r) => r.from);
}

// Para el Traductor de Chrome, que no recibe instrucciones: cada término viaja como un átomo <x9000/>, <x9001/>… y
// `subs` guarda lo que vuelve en su lugar. Palabras enteras, sin importar mayúsculas, y la regla más larga primero.
function aitGlossMark(text, rules) {
  const subs = [];
  if (!rules.length) return { t: text, subs };
  const sorted = [...rules].sort((a, b) => b.from.length - a.from.length);
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${sorted.map((r) => r.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\p{L}\\p{N}_])`, 'giu');
  // Solo en el texto: las marcas <gN> y <xN/> de la página no se tocan.
  const t = text.split(/(<\/?g\d+>|<x\d+\/>)/).map((part, i) => (i % 2 ? part : part.replace(re, (hit) => {
    const r = sorted.find((x) => x.from.toLowerCase() === hit.toLowerCase());
    let to = r.to ?? hit;
    // "Deploy" al empezar la frase → "Despliegue".
    if (r.to && hit[0] !== hit[0].toLowerCase() && r.from[0] === r.from[0].toLowerCase()) to = to[0].toUpperCase() + to.slice(1);
    subs.push(to);
    return `<x${9000 + subs.length - 1}/>`;
  }))).join('');
  return { t, subs };
}

// Devuelve los términos en su lugar; null si el traductor perdió o repitió un marcador.
function aitGlossRestore(text, subs) {
  const seen = subs.map(() => 0);
  const out = text.replace(/<x(9\d{3})\/>/g, (tag, n) => {
    const i = n - 9000;
    if (i >= subs.length) return tag;
    seen[i]++;
    return subs[i];
  });
  return seen.every((c) => c === 1) ? out : null;
}

// Nombre de la lista que corresponde al idioma del navegador; English si no está.
function aitUiTarget(ui = AIT_BROWSER_LANG) {
  const lc = ui.toLowerCase();
  const special = { 'pt-pt': 'Português (Portugal)', 'zh-tw': '中文 (繁體)', 'zh-hk': '中文 (繁體)' };
  return special[lc] || AIT_LANGS.find(([, c]) => c === lc.split('-')[0])?.[0] || 'English';
}

// Página de donaciones (Ko-fi, PayPal…). Vacía, el enlace "Invítame un café" no se muestra.
const AIT_DONATE_URL = 'https://ko-fi.com/asagvi';

const AIT_DEFAULTS = {
  provider: 'chrome',
  targetLang: aitUiTarget(),
  style: '',
  contextFirst: true,
  alwaysSites: [],
  neverSites: [],
  glossary: '',
  skipSelectors: '',
  maxChars: 2500,
  concurrency: 3,
  showBadge: true,
  selectionButton: true,
  bilingual: false,
  keepRecent: false,
  useCache: true,
  uiEnglish: false,
  sessionKeys: false,
};

// Servicio al que se le pide la IA: con "Traductor de Chrome + Google Gemini", Gemini.
function aitApiId(settings) {
  return settings.provider === 'hybrid' ? 'gemini' : settings.provider;
}

// Key, dirección y modelo de un servicio: los que guardó o los de su preset.
function aitServiceFields(services, id) {
  const p = AIT_PROVIDERS[id] || AIT_PROVIDERS.custom;
  return { apiKey: '', baseUrl: p.baseUrl, model: p.model, ...services[id] };
}

// Cada servicio guarda lo suyo en services; apiKey, baseUrl y model son los del servicio en uso.
function aitResolveSettings(stored = {}) {
  const s = { ...AIT_DEFAULTS, ...stored };
  // Gemini Nano ya no se elige (demasiado lento): queda solo como respaldo del Traductor.
  if (s.provider === 'nano') s.provider = 'chrome';
  // Antes se elegía la IA que corrige al Traductor; ahora es siempre Gemini.
  delete s.fixProvider;
  const id = aitApiId(s);
  let { services } = stored;
  if (!services) {
    // Antes había un solo apiKey/baseUrl/model: era del servicio elegido.
    const old = Object.fromEntries(['apiKey', 'baseUrl', 'model'].filter((f) => stored[f] !== undefined).map((f) => [f, stored[f]]));
    services = aitIsLocal({ provider: id }) || !Object.keys(old).length ? {} : { [id]: old };
  }
  return { ...s, services, ...aitServiceFields(services, id) };
}

// Con sessionKeys las keys viven en storage.session, que Chrome borra al cerrarse: no llegan al disco.
async function aitGetSettings() {
  let [{ settings = {} }, { keys = {} }] = await Promise.all([
    chrome.storage.local.get('settings'), chrome.storage.session.get('keys')]);
  if (settings.sessionKeys) {
    const services = { ...settings.services };
    for (const [id, apiKey] of Object.entries(keys)) services[id] = { ...services[id], apiKey };
    settings = { ...settings, services };
  }
  return aitResolveSettings(settings);
}

async function aitSaveSettings(patch) {
  const current = await aitGetSettings();
  const next = aitResolveSettings({ ...current, ...patch });
  const { apiKey, baseUrl, model, ...stored } = next;
  const keys = {};
  if (next.sessionKeys) {
    stored.services = Object.fromEntries(Object.entries(next.services).map(([id, { apiKey: k, ...f }]) => {
      if (k) keys[id] = k;
      return [id, f];
    }));
  }
  await chrome.storage.session.set({ keys });
  await chrome.storage.local.set({ settings: stored });
  return next;
}

function aitProviderType(settings) {
  return (AIT_PROVIDERS[settings.provider] || AIT_PROVIDERS.custom).type;
}

// Solo Google Chrome trae Gemini Nano; Brave, Edge, Opera y Vivaldi exponen la API pero sin modelo,
// y ninguno trae el Traductor de Chrome.
function aitBrowserName() {
  if (navigator.brave) return 'Brave';
  const brands = (navigator.userAgentData?.brands || []).map((b) => b.brand);
  const hit = ['Microsoft Edge', 'Opera', 'Google Chrome'].find((b) => brands.includes(b));
  if (hit) return hit;
  return /Vivaldi/.test(navigator.userAgent) ? 'Vivaldi' : 'Chromium';
}

// Error que detiene toda la traducción de la página (falta configurar algo, key inválida, sin conexión…).
// Se marca con una propiedad y no por el texto, para que el mensaje se pueda traducir.
function aitFatal(msg) {
  return Object.assign(new Error(msg), { fatal: true });
}

// Ajustes con los que se llama a la IA: con "Traductor de Chrome + Google Gemini", los de Gemini.
function aitApiSettings(settings) {
  return settings.provider === 'hybrid' ? { ...settings, provider: aitApiId(settings) } : settings;
}

// Nombre del servicio con su modelo, como se muestra en el popup y en "Probar traducción".
function aitServiceName(settings) {
  const api = aitApiSettings(settings);
  const preset = AIT_PROVIDERS[api.provider] || AIT_PROVIDERS.custom;
  const name = aitIsLocal(api) || !api.model ? preset.label : `${preset.label} (${api.model})`;
  return settings.provider === 'hybrid' ? `${AIT_PROVIDERS.chrome.label} + ${name}` : name;
}

// LM Studio y Ollama corren en la máquina del usuario: cada consulta tarda segundos.
function aitLocalServer(settings) {
  return ['lmstudio', 'ollama'].includes(settings.provider);
}

// Proveedores que corren en el navegador: sin key y sin perfil de contexto.
function aitIsLocal(settings) {
  return aitProviderType(settings) === 'chrome';
}

// Modelos que no generan texto (imagen, audio, embeddings…): no sirven para traducir.
const AIT_NOT_TEXT_RE = /embed|image|imagen|tts|audio|whisper|transcribe|dall-e|moderation|realtime|live|veo|lyria|aqa|robotics|computer-use/i;

function aitTextModels(ids) {
  return ids.filter((id) => !AIT_NOT_TEXT_RE.test(id));
}

// Gratis en OpenRouter: precio 0 de entrada y de salida ("-1" es precio variable), o el sufijo ":free".
function aitIsFreeModel(m) {
  const p = m.pricing;
  return String(m.id).endsWith(':free') || (!!p && Number(p.prompt) === 0 && Number(p.completion) === 0 && p.prompt !== '' && p.completion !== '');
}

// Modelo recomendado para traducir, o '' si conviene que elija el usuario. ids en el orden del proveedor (más nuevo primero).
function aitPickModel(provider, ids) {
  const type = (AIT_PROVIDERS[provider] || AIT_PROVIDERS.custom).type;
  if (provider === 'openrouter') return '';
  if (type === 'gemini') {
    // La versión estable más nueva que calza con re; '' si no hay.
    const newest = (re) => ids.map((id) => [id, re.exec(id)]).filter(([, m]) => m)
      .sort((a, b) => parseFloat(b[1][1]) - parseFloat(a[1][1]))[0]?.[0] || '';
    // Flash-Lite: el que Google recomienda para alto volumen, y casi no piensa.
    return newest(/^gemini-([\d.]+)-flash-lite$/) || newest(/^gemini-([\d.]+)-flash$/)
      || ids.find((id) => /flash/.test(id) && !/lite/.test(id)) || ids[0] || '';
  }
  if (type === 'anthropic') return ids.find((id) => /haiku/.test(id)) || ids[0] || '';
  if (provider === 'openai') return ids.find((id) => /-mini$/.test(id)) || ids[0] || '';
  // El que recomienda el aviso de Opciones (#localSlow).
  if (aitLocalServer({ provider })) return ids.find((id) => /gemma-?4(?!\d).*\b12b/i.test(id)) || ids[0] || '';
  return ids[0] || '';
}

// Thinking más bajo que acepta el modelo (null = no mandar nada). Para traducir no hace falta y suma segundos a cada lote.
function aitGeminiThinking(model) {
  const m = String(model);
  if (/lite|^gemini-2\.5-pro/.test(m)) return null; // Flash-Lite ya viene en mínimo; 2.5 Pro no lo deja apagar
  if (/^gemini-2\.5-flash/.test(m)) return { thinkingBudget: 0 };
  return Number(/^gemini-(\d+)/.exec(m)?.[1]) >= 3 ? { thinkingLevel: 'low' } : null;
}

function aitHostMatches(list, hostname) {
  return (list || []).some((h) => hostname === h || hostname.endsWith('.' + h));
}

// "Recientes": la nueva primero, sin repetir texto + idioma (conserva la estrella), 20 sin estrella y los favoritos
// aparte. shortcut: tope total de 120 para no crecer sin fin; si alguien fija más, los favoritos viejos se pierden.
function aitAddRecent(history, entry, max = 20) {
  const same = (h) => h.o === entry.o && h.lang === entry.lang;
  let free = 0;
  return [{ ...entry, fav: Boolean(history.find(same)?.fav) }, ...history.filter((h) => !same(h))]
    .filter((h) => h.fav || free++ < max)
    .slice(0, 120);
}
