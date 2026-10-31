const $ = (id) => document.getElementById(id);
const FIELDS = ['baseUrl', 'apiKey', 'model', 'targetLang', 'style', 'glossary', 'skipSelectors', 'maxChars', 'concurrency'];
const CHECKS = ['contextFirst', 'showBadge', 'bilingual', 'selectionButton', 'keepRecent', 'useCache', 'uiEnglish', 'sessionKeys'];
const MAIN = ['chrome', 'hybrid', 'gemini'];
const OTHER_LANG = '__otro';

const provider = () => $('form').elements.provider.value;
// Servicio al que se le pide la IA: con "Traductor de Chrome + Google Gemini", Gemini.
const apiId = () => aitApiId({ provider: provider() });

function setStatus(el, text, kind = '') {
  el.textContent = text;
  el.classList.remove('estado--ok', 'estado--error', 'estado--aviso');
  if (kind) el.classList.add(`estado--${kind}`);
}

// Lo que distingue a cada servicio de un vistazo: costo, velocidad y dónde corre.
const RASGOS = {
  chrome: [['tagFree', 'bueno'], ['tagVeryFast', 'bueno'], ['tagOnDevice']],
  hybrid: [['tagVeryFast', 'bueno']],
  gemini: [['tagFreeLimited', 'bueno'], ['tagFast'], ['tagCloud'], ['tagNeedsKey', 'ojo']],
  anthropic: [['tagPaid', 'ojo'], ['tagCloud']],
  openai: [['tagPaid', 'ojo'], ['tagCloud']],
  openrouter: [['tagSomeFree', 'bueno'], ['tagCloud']],
  lmstudio: [['tagFree', 'bueno'], ['tagOnDevice']],
  ollama: [['tagFree', 'bueno'], ['tagOnDevice']],
};

function serviceItem(id, p) {
  const li = document.createElement('li');
  li.className = 'servicio';
  const label = document.createElement('label');
  label.className = 'servicio__opcion';
  const radio = Object.assign(document.createElement('input'), { type: 'radio', name: 'provider', value: id, className: 'servicio__radio' });
  const name = Object.assign(document.createElement('span'), { className: 'servicio__nombre', id: `sv-${id}`, textContent: p.label });
  if (id === 'chrome') name.append(Object.assign(document.createElement('span'), { className: 'servicio__recomendado', textContent: aitT('recommended') }));
  const desc = Object.assign(document.createElement('span'), { className: 'servicio__desc', id: `sv-${id}-d`, textContent: p.desc });
  // <span> y no <ul>: un <label> solo admite contenido en línea.
  const rasgos = Object.assign(document.createElement('span'), { className: 'servicio__rasgos', id: `sv-${id}-r` });
  for (const [key, tono] of RASGOS[id] || []) {
    if (rasgos.children.length) rasgos.append(Object.assign(document.createElement('span'), { className: 'visualmente-oculto', textContent: ', ' }));
    rasgos.append(Object.assign(document.createElement('span'), { className: tono ? `rasgo rasgo--${tono}` : 'rasgo', textContent: aitT(key) }));
  }
  radio.setAttribute('aria-labelledby', name.id);
  radio.setAttribute('aria-describedby', `${desc.id} ${rasgos.id}`);
  label.append(radio, name, desc);
  if (rasgos.children.length) label.append(rasgos);
  li.append(label);
  return li;
}

// Lo que este navegador no trae no se puede elegir, y se dice dónde sí está. Si ya estaba elegido, queda con el aviso.
async function markMissing() {
  const missing = {};
  if (typeof Translator === 'undefined') missing.chrome = missing.hybrid = aitT('svcNoTranslator');
  const nano = await aitNanoAvailability(aitNanoOptions(['en'], 'en')).catch(() => 'missing');
  // Sin Nano, las frases rotas no se reintentan: quedan en el original. Se recomienda Chrome + Gemini, pero sigue elegido el Traductor.
  if (['missing', 'unavailable'].includes(nano)) {
    // En Google Chrome, unavailable es el equipo (memoria gráfica, disco), no el navegador.
    const browser = aitBrowserName();
    const hw = browser === 'Google Chrome';
    $('chromeInfo').textContent = aitT(hw ? 'chromeInfoNoNanoHw' : 'chromeInfoNoNano', AIT_PROVIDERS.hybrid.label);
    if (!missing.hybrid) {
      $('sv-hybrid').append($('sv-chrome').querySelector('.servicio__recomendado'));
      const why = Object.assign(document.createElement('span'), { className: 'servicio__nota ayuda', id: 'sv-hybrid-why', textContent: hw ? aitT('hybridWhyHw') : aitT('hybridWhy', browser) });
      const radio = $('form').querySelector('.servicio__radio[value="hybrid"]');
      radio.closest('.servicio__opcion').append(why);
      radio.setAttribute('aria-describedby', `${radio.getAttribute('aria-describedby')} ${why.id}`);
    }
  }
  for (const [id, text] of Object.entries(missing)) {
    const radio = $('form').querySelector(`.servicio__radio[value="${id}"]`);
    const note = Object.assign(document.createElement('span'), { className: 'servicio__nodisp estado estado--aviso', id: `sv-${id}-n`, textContent: text });
    radio.closest('.servicio__opcion').append(note);
    radio.setAttribute('aria-describedby', `${radio.getAttribute('aria-describedby')} ${note.id}`);
    radio.disabled = !radio.checked;
  }
}

// Con "Otro idioma", dice si se reconoció lo escrito y cómo comprobarlo.
function langStatus() {
  const el = $('langStatus');
  const name = $('targetLang').value.trim();
  if ($('langPick').value !== OTHER_LANG || !name) return setStatus(el, '');
  const id = provider();
  if (!aitIsLocal({ provider: id })) return setStatus(el, aitT('langAi', name));
  const code = aitLangCode(name);
  if (!code) return setStatus(el, aitT('langUnknown', name), 'error');
  const label = new Intl.DisplayNames([AIT_UI_LANG], { type: 'language' }).of(code);
  setStatus(el, aitT('langOk', label, AIT_PROVIDERS[id].label), 'ok');
}

function applyPresetHints() {
  const id = provider();
  const p = AIT_PROVIDERS[id] || AIT_PROVIDERS.custom;
  const local = aitIsLocal({ provider: id });
  const hybrid = id === 'hybrid';
  const api = apiId();
  const ap = AIT_PROVIDERS[api] || AIT_PROVIDERS.custom;
  // El panel de configuración va debajo del servicio elegido.
  $('form').querySelector(`.servicio__radio[value="${id}"]`).closest('.servicio').append($('setup'));
  if (!MAIN.includes(id)) $('more').open = true;

  $('localPanel').hidden = !local;
  $('chromeInfo').hidden = p.type !== 'chrome' || hybrid;
  $('hybridInfo').hidden = !hybrid;
  $('geminiGuide').hidden = api !== 'gemini';
  $('geminiGuide').open = !$('apiKey').value;
  $('apiFields').hidden = local && !hybrid;
  // Los servicios en la nube tienen dirección fija; solo se pide en los servidores propios.
  $('baseRow').hidden = Boolean(ap.baseUrl) && ap.needsKey;
  $('keyRow').hidden = !ap.needsKey && api !== 'custom';
  $('apiKey').placeholder = aitT(ap.needsKey ? 'keyPh' : 'optional');
  const serverHints = {
    lmstudio: aitT('serverLmstudio'),
  };
  $('baseHint').textContent = serverHints[api] || '';
  // Lo que cuida la plata es el tope de la key, no cómo se guarda: si se filtra, el daño queda acotado.
  const keyLimits = {
    gemini: aitT('keyLimitGemini'),
    openrouter: aitT('keyLimitOpenrouter'),
    openai: aitT('keyLimitOpenai'),
    anthropic: aitT('keyLimitAnthropic'),
  };
  $('keyLimit').textContent = keyLimits[api] || '';
  $('keyLimit').hidden = !keyLimits[api];
  $('ollamaGuide').hidden = api !== 'ollama';
  $('ollamaGuide').open = !$('model').value;
  $('localSlow').hidden = !aitLocalServer({ provider: api });

  $('contextFirst').disabled = local;
  $('contextHint').textContent = local ? `${aitT('contextHint')} ${aitT('notUsedWith', p.label)}` : aitT('contextHint');

  $('test').hidden = true;
  setStatus($('testStatus'), '');
  if (local) localCheck(false);
  langStatus();
  loadModels();
}

// Pide al proveedor los modelos de la cuenta: el usuario no tiene por qué saber cómo se llaman.
let modelsReq = 0;
async function loadModels() {
  const id = apiId();
  const p = AIT_PROVIDERS[id] || AIT_PROVIDERS.custom;
  const pick = $('modelPick');
  const hint = $('modelHint');
  const showInput = (text, kind = '') => {
    pick.hidden = true;
    $('model').hidden = false;
    $('modelLabel').htmlFor = 'model';
    setStatus(hint, text, kind);
  };
  const req = ++modelsReq;
  // Sin key no hay modelos que mostrar: el campo vacío solo confunde.
  $('modelRow').hidden = p.needsKey && !$('apiKey').value.trim();
  if (aitIsLocal({ provider: id }) || (p.needsKey && !$('apiKey').value.trim()) || !($('baseUrl').value.trim() || p.baseUrl)) {
    showInput(p.modelHint ? aitT('modelHintFmt', p.modelHint) : '');
    return;
  }
  setStatus(hint, aitT('modelsLoading'));
  const r = await chrome.runtime.sendMessage({
    type: 'models',
    settings: { provider: id, baseUrl: $('baseUrl').value.trim(), apiKey: $('apiKey').value.trim() },
  }).catch((e) => ({ ok: false, error: e.message }));
  if (req !== modelsReq) return;
  if (!r?.ok) return showInput(aitT('modelsError', r?.error || aitT('noReply')), 'error');
  if (!r.models.length) return showInput(aitT('modelsNone'), 'error');

  const current = $('model').value.trim();
  const chosen = r.models.includes(current) ? current : r.recommended;
  fillModels(r.models, r.recommended, r.free || [], r.translation || []);
  showModel(chosen);
  pick.hidden = false;
  $('model').hidden = true;
  $('modelLabel').htmlFor = 'modelBtn';
  const head = aitT(p.needsKey ? 'keyWorks' : 'connected');
  // Si se elige otro a mano, "Elegimos X" deja de ser cierto.
  picker.okText = aitT('modelsOk', head, r.models.length);
  setStatus(hint, chosen === r.recommended && chosen
    ? aitT('modelsOkPicked', head, r.models.length, chosen)
    : aitT('modelsOk', head, r.models.length), 'ok');
  refreshDirty();
}

// Selector de modelo. La lista se arma una vez por carga; buscar solo oculta filas.
const picker = { recommended: '', free: new Set(), translation: new Set(), active: null, okText: '' };
const modelRows = () => [...$('modelList').children];
const visibleRows = () => modelRows().filter((li) => !li.hidden);
const focusTarget = () => ($('modelSearch').hidden ? $('modelList') : $('modelSearch'));

// Partes del nombre que coinciden con alguna palabra buscada: [[texto, coincide], …].
function markParts(text, words) {
  const low = text.toLowerCase();
  const on = new Array(text.length).fill(false);
  for (const w of words) for (let i = low.indexOf(w); i >= 0; i = low.indexOf(w, i + 1)) on.fill(true, i, i + w.length);
  const parts = [];
  for (let i = 0; i < text.length; i++) {
    if (parts.length && parts.at(-1)[1] === on[i]) parts.at(-1)[0] += text[i];
    else parts.push([text[i], on[i]]);
  }
  return parts.length ? parts : [[text, false]];
}

function modelName(value, words = []) {
  const name = Object.assign(document.createElement('span'), { className: 'selector__nombre' });
  const id = document.createElement('span');
  for (const [part, on] of markParts(value, words)) id.append(on ? Object.assign(document.createElement('mark'), { textContent: part }) : part);
  name.append(id);
  if (value === picker.recommended) name.append(Object.assign(document.createElement('span'), { className: 'servicio__recomendado', textContent: aitT('recommended') }));
  if (picker.free.has(value)) name.append(Object.assign(document.createElement('span'), { className: 'rasgo rasgo--bueno', textContent: aitT('tagFree') }));
  if (picker.translation.has(value)) name.append(Object.assign(document.createElement('span'), { className: 'rasgo', textContent: aitT('modelsForTranslation') }));
  return name;
}

function fillModels(models, recommended, free, translation) {
  picker.recommended = recommended;
  picker.free = new Set(free);
  picker.translation = new Set(translation);
  picker.active = null;
  $('modelList').replaceChildren(...models.map((m, i) => {
    const li = Object.assign(document.createElement('li'), { className: 'selector__opcion', id: `mo-${i}` });
    li.setAttribute('role', 'option');
    li.dataset.value = m;
    li.append(Object.assign(document.createElement('span'), { className: 'selector__check', textContent: '✓' }), modelName(m));
    li.firstChild.setAttribute('aria-hidden', 'true');
    return li;
  }));
  // Con pocos modelos el buscador sobra; OpenRouter trae cientos.
  $('modelSearch').hidden = models.length <= 10;
  $('modelCount').hidden = $('modelSearch').hidden;
  // Solo OpenRouter dice qué modelos son gratis (precio 0) y cuáles sirven para traducir.
  for (const b of document.querySelectorAll('.selector__filtro')) {
    b.hidden = $('modelSearch').hidden || !picker[b.dataset.filtro].size;
    if (b.hidden) b.setAttribute('aria-pressed', 'false');
  }
  // La lista se recarga al salir de la key o la dirección, a veces con el selector ya abierto: sigue abierto.
  if (!$('modelPanel').hidden) filterModels();
}

function showModel(value) {
  $('model').value = value;
  $('modelValue').replaceChildren(value ? modelName(value) : aitT('chooseModel'));
  for (const li of modelRows()) li.setAttribute('aria-selected', String(li.dataset.value === value));
}

function setActive(li, scroll = true) {
  picker.active?.classList.remove('selector__opcion--activa');
  picker.active = li;
  $('modelSearch').removeAttribute('aria-activedescendant');
  $('modelList').removeAttribute('aria-activedescendant');
  if (!li) return;
  li.classList.add('selector__opcion--activa');
  focusTarget().setAttribute('aria-activedescendant', li.id);
  if (scroll) li.scrollIntoView({ block: 'nearest' });
}

// Deja los modelos que tienen todas las palabras buscadas y resalta dónde coinciden.
function filterModels() {
  const query = $('modelSearch').value.trim();
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const filtros = [...document.querySelectorAll('.selector__filtro[aria-pressed="true"]')].map((b) => picker[b.dataset.filtro]);
  const rows = modelRows();
  let shown = 0;
  for (const li of rows) {
    const value = li.dataset.value;
    li.hidden = filtros.some((set) => !set.has(value)) || !words.every((w) => value.toLowerCase().includes(w));
    if (li.hidden) continue;
    shown++;
    li.lastChild.replaceWith(modelName(value, words));
  }
  $('modelEmpty').hidden = shown > 0;
  if (!shown) {
    $('modelEmpty').replaceChildren(...(query
      ? [aitT('modelsNoMatch', query), document.createElement('br'), aitT('modelsTryPart')]
      : [aitT('modelsNoFilterMatch')]));
  }
  setStatus($('modelCount'), aitT('modelsCount', shown, rows.length));
  setActive(visibleRows()[0] || null);
}

function togglePicker(open) {
  $('modelPanel').hidden = !open;
  $('modelBtn').setAttribute('aria-expanded', String(open));
  if (!open) return;
  $('modelSearch').value = '';
  filterModels();
  const selected = modelRows().find((li) => li.dataset.value === $('model').value);
  if (selected) setActive(selected);
  focusTarget().focus();
}

function chooseModel(li) {
  showModel(li.dataset.value);
  setStatus($('modelHint'), picker.okText, 'ok');
  togglePicker(false);
  $('modelBtn').focus();
  refreshDirty();
}

// Key, dirección y modelo de cada servicio, incluidos los cambios sin guardar.
let draft = {};
function serviceDraft(id = apiId()) {
  const out = { ...draft };
  if (!aitIsLocal({ provider: id })) {
    const cur = { apiKey: $('apiKey').value.trim(), baseUrl: $('baseUrl').value.trim(), model: $('model').value.trim() };
    // Sin esto, pasar por un servicio sin tocarlo dejaría el formulario "sin guardar".
    if (JSON.stringify(cur) === JSON.stringify(aitServiceFields({}, id))) delete out[id];
    else out[id] = cur;
  }
  return Object.fromEntries(Object.entries(out).sort());
}

function showService(id) {
  const f = aitServiceFields(draft, id);
  $('apiKey').value = f.apiKey;
  $('baseUrl').value = f.baseUrl;
  showModel(f.model);
}

function readForm() {
  const lines = (t) => t.split('\n').map((s) => s.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
  return {
    provider: provider(),
    services: serviceDraft(),
    targetLang: $('targetLang').value.trim() || AIT_DEFAULTS.targetLang,
    style: $('style').value.trim(),
    glossary: $('glossary').value,
    skipSelectors: $('skipSelectors').value,
    maxChars: Math.min(12000, Math.max(500, Number($('maxChars').value) || 2500)),
    concurrency: Math.min(8, Math.max(1, Number($('concurrency').value) || 3)),
    contextFirst: $('contextFirst').checked,
    showBadge: $('showBadge').checked,
    bilingual: $('bilingual').checked,
    selectionButton: $('selectionButton').checked,
    keepRecent: $('keepRecent').checked,
    useCache: $('useCache').checked,
    uiEnglish: $('uiEnglish').checked,
    sessionKeys: $('sessionKeys').checked,
    alwaysSites: lines($('alwaysSites').value),
    neverSites: lines($('neverSites').value),
  };
}

let saved = '';
const isDirty = () => JSON.stringify(readForm()) !== saved;
function refreshDirty() {
  if (isDirty()) setStatus($('msg'), aitT('unsaved'), 'aviso');
  else if (!$('msg').classList.contains('estado--ok')) setStatus($('msg'), aitT('allSaved'));
}
async function save() {
  const form = readForm();
  const langChanged = form.uiEnglish !== JSON.parse(saved).uiEnglish;
  await aitSaveSettings(form);
  draft = form.services;
  saved = JSON.stringify(form);
  if (langChanged) location.reload();
  else setStatus($('msg'), aitT('savedMsg'), 'ok');
}

// Proveedores que corren en Chrome: cómo comprobarlos y descargarlos desde Opciones.
const LOCAL = {
  chrome: {
    get name() { return AIT_PROVIDERS.chrome.label; },
    opts: (out) => ({ sourceLanguage: out === 'en' ? 'es' : 'en', targetLanguage: out }),
    availability: (opts) => aitTranslatorAvailability(opts.sourceLanguage, opts.targetLanguage),
    download: aitDownloadTranslator,
    unavailable: aitTranslatorUnavailableMsg,
    error: (e) => `${AIT_PROVIDERS.chrome.label}: ${(e && e.message) || e}`,
    get downloadable() { return aitT('dlChrome'); },
  },
};

// Respaldo del Traductor: arregla las frases que rompe. No se elige como servicio, solo se descarga.
const NANO = {
  name: 'Gemini Nano',
  opts: (out) => aitNanoOptions(['en'], out),
  download: (opts, onProgress) => aitNanoApi().create({ ...opts, monitor: aitMonitor(onProgress) }).then((s) => s.destroy()),
  error: aitNanoError,
};

async function localCheck(download) {
  const kind = LOCAL[aitProviderType({ provider: provider() })];
  if (!kind) return;
  if (!download) nanoCheck(false);
  const status = $('localStatus');
  const btn = $('localBtn');
  const out = aitLangCode($('targetLang').value);
  // Sin un idioma reconocido no hay nada que descargar ni comprobar hasta que cambie "Traducir a".
  btn.hidden = !out;
  if (!out) {
    setStatus(status, aitT('localNeedLang', kind.name), 'error');
    return;
  }
  const opts = kind.opts(out);
  let a;
  try {
    a = await kind.availability(opts);
  } catch (e) {
    setStatus(status, kind.error(e), 'error');
    return;
  }
  const texts = {
    missing: kind.unavailable('missing'),
    unavailable: kind.unavailable('unavailable'),
    'unsupported-language': aitT('localNoLang', kind.name),
    downloadable: kind.downloadable,
    downloading: aitT('downloading'),
    available: aitT('localReady', kind.name, $('targetLang').value),
  };
  setStatus(status, texts[a] || aitT('stateFmt', a),
    a === 'available' ? 'ok' : ['missing', 'unavailable', 'unsupported-language'].includes(a) ? 'error' : 'aviso');
  btn.textContent = aitT(a === 'downloadable' ? 'download' : a === 'downloading' ? 'seeProgress' : 'checkAgain');
  btn.classList.toggle('boton--principal', a === 'downloadable');
  btn.hidden = a === 'available';

  if (!download || !(a === 'downloadable' || a === 'downloading')) return;
  if (await localDownload(kind, 'local', opts)) localCheck(false);
}

// create() necesita el clic del usuario para iniciar la descarga. Usa #<el>Status, #<el>Btn y #<el>Progress.
async function localDownload(kind, el, opts) {
  const status = $(`${el}Status`);
  const btn = $(`${el}Btn`);
  const bar = $(`${el}Progress`);
  bar.hidden = false;
  btn.disabled = true;
  try {
    await kind.download(opts, (pct) => {
      bar.value = pct;
      setStatus(status, aitT('downloadingPct', kind.name, pct));
    }, () => setStatus(status, aitT('installing', kind.name)));
    return true;
  } catch (e) {
    setStatus(status, kind.error(e), 'error');
    return false;
  } finally {
    btn.disabled = false;
    bar.hidden = true;
  }
}

// Con el Traductor, Nano solo aparece si falta descargarlo y sirve para el idioma de destino.
async function nanoCheck(download) {
  const out = aitLangCode($('targetLang').value);
  const opts = NANO.opts(out);
  const a = provider() === 'chrome' && AIT_NANO_LANGS.includes(out)
    ? await aitNanoAvailability(opts).catch(() => 'missing') : 'missing';
  $('nanoRow').hidden = !['downloadable', 'downloading'].includes(a);
  if ($('nanoRow').hidden) return;
  setStatus($('nanoStatus'), aitT(a === 'downloading' ? 'nanoDownloading' : 'nanoDl'), 'aviso');
  $('nanoBtn').textContent = aitT(a === 'downloading' ? 'seeProgress' : 'downloadNano');
  $('nanoBtn').hidden = false;
  if (download && await localDownload(NANO, 'nano', opts)) {
    setStatus($('nanoStatus'), aitT('nanoReady'), 'ok');
    $('nanoBtn').hidden = true;
  }
}

// Muestra una frase de prueba con sus marcas: <x0/> es un ícono que no se traduce, <g0> un enlace.
const SAMPLE = 'Tap <x0/> to add the <g0>blue jacket</g0> to your cart.';
function tagged(text) {
  const p = document.createElement('p');
  p.className = 'prueba__linea';
  for (const part of String(text).split(/(<x0\s*\/>|<g0>[\s\S]*?<\/g0>)/i)) {
    if (/^<x0/i.test(part)) p.append(Object.assign(document.createElement('span'), { className: 'intacto', textContent: '🛒' }));
    else if (/^<g0>/i.test(part)) p.append(Object.assign(document.createElement('span'), { className: 'prueba__enlace', textContent: part.replace(/<\/?g0>/gi, '') }));
    else if (part) p.append(part);
  }
  return p;
}
function labelled(title, line) {
  line.prepend(Object.assign(document.createElement('span'), { className: 'prueba__etiqueta', textContent: title }));
  return line;
}

// Tema: es una preferencia de este navegador, se aplica y se guarda al elegirlo.
function setupTheme() {
  let current = 'auto';
  try { current = localStorage.getItem('ait-theme') || 'auto'; } catch { /* sin almacenamiento */ }
  for (const r of document.querySelectorAll('.tema__radio')) {
    r.checked = r.value === current;
    r.addEventListener('change', () => {
      if (r.value === 'auto') delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = r.value;
      try { localStorage.setItem('ait-theme', r.value); } catch { /* sin almacenamiento */ }
    });
  }
}

(async () => {
  const s = await aitGetSettings();
  await aitLoadUi(s.uiEnglish);
  aitLocalize();
  for (const a of document.querySelectorAll('.donar')) { a.href = AIT_DONATE_URL; a.hidden = !AIT_DONATE_URL; }
  // La guía de Ollama da permiso solo a esta extensión, no a todas (chrome-extension://*).
  for (const c of document.querySelectorAll('.origen-ext')) c.textContent = c.dataset.plantilla.replace('{o}', location.origin);
  $(/linux/i.test(navigator.userAgentData?.platform || navigator.platform) ? 'soLinux' : 'soOtro').open = true;
  // Con el navegador en inglés la opción no cambia nada.
  $('uiEnglishRow').hidden = AIT_BROWSER_LANG.startsWith('en');
  setupTheme();
  $('mainList').append(...MAIN.map((id) => serviceItem(id, AIT_PROVIDERS[id])));
  // Fuera de los tres principales, agrupados por cómo se paga y dónde corren.
  const groups = [
    ['anthropic', 'openai', 'custom'],
    ['openrouter'],
    ['ollama', 'lmstudio'],
  ];
  const titles = [aitT('groupPaid'), aitT('groupFreePaid'), aitT('groupLocal')];
  for (const [i, ids] of groups.entries()) {
    const list = Object.assign(document.createElement('ul'), { className: 'servicios__lista' });
    list.setAttribute('role', 'list');
    list.append(...ids.map((id) => serviceItem(id, AIT_PROVIDERS[id])));
    $('moreList').append(Object.assign(document.createElement('h3'), { className: 'servicios__grupo', textContent: titles[i] }), list);
  }
  $('langPick').replaceChildren(...AIT_LANGUAGES.map((l) => new Option(aitLangLabel(l), l)), new Option(aitT('otherLang'), OTHER_LANG));

  ($('form').querySelector(`.servicio__radio[value="${s.provider}"]`) || $('form').querySelector('.servicio__radio[value="custom"]')).checked = true;
  for (const f of FIELDS) $(f).value = s[f] ?? '';
  for (const c of CHECKS) $(c).checked = !!s[c];
  draft = s.services;
  const known = AIT_LANGUAGES.includes(s.targetLang);
  $('langPick').value = known ? s.targetLang : OTHER_LANG;
  $('targetLang').hidden = known;
  $('alwaysSites').value = (s.alwaysSites || []).join('\n');
  $('neverSites').value = (s.neverSites || []).join('\n');
  saved = JSON.stringify(readForm());
  await markMissing();
  applyPresetHints();
  refreshDirty();

  let prevApi = apiId();
  $('form').addEventListener('change', (e) => {
    if (e.target.name !== 'provider') return;
    draft = serviceDraft(prevApi);
    prevApi = apiId();
    showService(prevApi);
    const { tuning } = AIT_PROVIDERS[provider()];
    if (tuning) {
      $('concurrency').value = tuning.concurrency;
      $('maxChars').value = tuning.maxChars;
    }
    applyPresetHints();
  });
  $('form').addEventListener('input', refreshDirty);
  $('form').addEventListener('change', refreshDirty);
  window.addEventListener('beforeunload', (e) => { if (isDirty()) e.preventDefault(); });

  $('form').addEventListener('submit', (e) => {
    e.preventDefault();
    save();
  });

  $('localBtn').addEventListener('click', () => localCheck(true));
  $('nanoBtn').addEventListener('click', () => nanoCheck(true));
  $('apiKey').addEventListener('change', loadModels);
  $('baseUrl').addEventListener('change', loadModels);
  $('modelBtn').addEventListener('click', () => togglePicker($('modelPanel').hidden));
  $('modelBtn').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    togglePicker(true);
  });
  $('modelPanel').addEventListener('keydown', (e) => {
    const rows = visibleRows();
    const i = rows.indexOf(picker.active);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(rows[e.key === 'ArrowDown' ? Math.min(i + 1, rows.length - 1) : Math.max(i - 1, 0)] || null);
    } else if (e.key === 'Enter' && !e.target.classList.contains('selector__filtro')) {
      // Si no, Enter guardaría el formulario.
      e.preventDefault();
      if (picker.active) chooseModel(picker.active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      togglePicker(false);
      $('modelBtn').focus();
    }
  });
  $('modelSearch').addEventListener('input', filterModels);
  // Cada filtro va por su cuenta; con los dos, quedan los que cumplen ambos.
  for (const b of document.querySelectorAll('.selector__filtro')) {
    b.addEventListener('click', () => {
      b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
      filterModels();
      $('modelSearch').focus();
    });
  }
  // Con el clic en la lista el foco se queda en el buscador: si no, contaría como salir del selector.
  $('modelList').addEventListener('mousedown', (e) => e.preventDefault());
  $('modelList').addEventListener('click', (e) => {
    const li = e.target.closest('.selector__opcion');
    if (li) chooseModel(li);
  });
  $('modelList').addEventListener('mousemove', (e) => {
    const li = e.target.closest('.selector__opcion');
    if (li && li !== picker.active) setActive(li, false);
  });
  // Tab o clic afuera: se cierra sin cambiar nada.
  $('modelPick').addEventListener('focusout', (e) => {
    if (!$('modelPick').contains(e.relatedTarget)) togglePicker(false);
  });
  $('targetLang').addEventListener('change', () => localCheck(false));
  $('targetLang').addEventListener('input', langStatus);
  $('langPick').addEventListener('change', () => {
    const other = $('langPick').value === OTHER_LANG;
    $('targetLang').hidden = !other;
    if (other) {
      $('targetLang').value = '';
      $('targetLang').focus();
    } else {
      $('targetLang').value = $('langPick').value;
      localCheck(false);
    }
    langStatus();
  });

  $('showKey').addEventListener('click', () => {
    const k = $('apiKey');
    k.type = k.type === 'password' ? 'text' : 'password';
    $('showKey').textContent = aitT(k.type === 'password' ? 'show' : 'hide');
  });

  $('testBtn').addEventListener('click', async () => {
    await save();
    $('testBtn').disabled = true;
    $('test').hidden = true;
    setStatus($('testStatus'), aitT('testing'));
    const r = await chrome.runtime.sendMessage({ type: 'test' }).catch((e) => ({ ok: false, error: e.message }));
    $('testBtn').disabled = false;
    const out = $('test');
    out.replaceChildren();
    if (!r?.ok) {
      setStatus($('testStatus'), aitT('testFailed'), 'error');
      out.append(Object.assign(document.createElement('p'), { className: 'aviso aviso--error', textContent: r?.error || aitT('noService') }));
      out.hidden = false;
      return;
    }
    const result = r.sample[0] ?? '';
    const marksOk = /<x0\s*\/>/i.test(result) && /<g0>[\s\S]*<\/g0>/i.test(result);
    setStatus($('testStatus'), aitT(marksOk ? 'testOk' : 'testMarks', r.model), marksOk ? 'ok' : 'aviso');
    out.append(
      labelled(aitT('original'), tagged(SAMPLE)),
      labelled(aitT('translation'), tagged(result || aitT('empty'))),
      labelled(aitT('signInBtn'), tagged(r.sample[1] ?? aitT('empty'))),
    );
    if (!marksOk) {
      out.append(Object.assign(document.createElement('p'), {
        className: 'aviso',
        textContent: aitT('marksLost'),
      }));
    }
    out.hidden = false;
  });

  $('clearCache').addEventListener('click', async () => {
    const r = await chrome.runtime.sendMessage({ type: 'clearCache' });
    setStatus($('cacheStatus'), aitT('cleared', r?.removed ?? 0), 'ok');
  });
})();
