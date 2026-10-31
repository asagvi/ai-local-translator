const $ = (id) => document.getElementById(id);

function openOptions() {
  chrome.runtime.openOptionsPage();
  window.close();
}
for (const id of ['opts', 'opts2', 'change']) $(id).addEventListener('click', openOptions);

// Chincheta de trazos: con aria-pressed la rellena el CSS.
function pinIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [k, v] of Object.entries({ width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  for (const d of ['M12 17v5', 'M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z']) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

// Como en el indicador, solo se anuncia el resultado (no el avance), y solo cuando cambia.
function setStatus(text, kind = '', announce = true) {
  $('status').textContent = text;
  $('status').className = `estado${kind ? ` estado--${kind}` : ''}`;
  if (announce && $('statusSr').textContent !== text) $('statusSr').textContent = text;
}

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let settings = await aitGetSettings();
  await aitLoadUi(settings.uiEnglish);
  aitLocalize();
  for (const a of document.querySelectorAll('.donar')) { a.href = AIT_DONATE_URL; a.hidden = !AIT_DONATE_URL; }

  $('svc').textContent = aitServiceName(settings);

  const supported = tab?.id && /^(https?|file):/.test(tab.url || '') && !/chromewebstore\.google\.com|chrome\.google\.com\/webstore/.test(tab.url);
  if (!supported) {
    $('controls').hidden = true;
    $('unsupported').hidden = false;
    return;
  }

  const api = aitApiSettings(settings);
  const preset = AIT_PROVIDERS[api.provider] || AIT_PROVIDERS.custom;
  if (!aitIsLocal(api) && (!api.model || (preset.needsKey && !api.apiKey))) $('nokey').hidden = false;

  const host = new URL(tab.url).hostname;
  $('host').textContent = host || aitT('thisPage');
  $('always').checked = aitHostMatches(settings.alwaysSites, host);
  $('bilingual').checked = Boolean(settings.bilingual);

  const langs = [...new Set([settings.targetLang, ...AIT_LANGUAGES])];
  $('lang').replaceChildren(...langs.map((l) => new Option(aitLangLabel(l), l)));
  $('lang').value = settings.targetLang;

  async function send(type, extra) {
    try {
      return await chrome.tabs.sendMessage(tab.id, { type, ...extra });
    } catch {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['settings.js', 'content.js'] });
        return await chrome.tabs.sendMessage(tab.id, { type, ...extra });
      } catch {
        return null;
      }
    }
  }

  const langNames = new Intl.DisplayNames([AIT_UI_LANG], { type: 'language' });
  const langName = (code) => {
    try {
      const n = code ? langNames.of(code) : '';
      return n ? n[0].toUpperCase() + n.slice(1) : aitT('pageLang');
    } catch {
      return aitT('pageLang');
    }
  };

  // Con el Traductor de Chrome el origen se puede elegir (la página puede declarar mal su idioma); la IA lo reconoce sola.
  const pickSrc = aitProviderType(settings) === 'chrome';
  if (pickSrc) $('src').replaceChildren(new Option('', ''), ...AIT_LANGUAGES.map((l) => new Option(aitLangLabel(l), l)));
  $('src').hidden = !pickSrc;
  $('fromBox').hidden = pickSrc;
  $('src').addEventListener('change', async () => {
    state = await send('source', { lang: $('src').value });
    render(state);
  });

  function render(st) {
    $('from').textContent = langName(st?.lang);
    if (pickSrc) {
      $('src').options[0].textContent = `${langName(st?.lang)} (${aitT('srcAuto')})`;
      if (document.activeElement !== $('src')) $('src').value = st?.src || '';
    }
    const btn = $('main');
    const bar = $('bar');
    bar.hidden = true;
    if (!st) {
      btn.textContent = aitT('translatePage');
      setStatus(aitT('errTab'), 'error');
      return;
    }
    btn.textContent = aitT(st.mode === 'translated' ? 'showOriginal' : st.mode === 'original' ? 'showTranslation' : 'translatePage');

    const total = st.done + st.pending;
    if (st.error) setStatus(st.error, 'error');
    else if (st.analyzing) setStatus(aitT('analyzing'), '', false);
    else if (st.mode !== 'off' && st.pending) {
      bar.hidden = false;
      bar.max = total;
      bar.value = st.done;
      setStatus(aitT('progress', st.done, total), '', false);
    } else if (st.mode === 'translated') {
      setStatus(st.errors ? aitT('doneErrors', st.errors) : aitT('doneOk'), 'ok');
    } else if (st.mode === 'original') setStatus(aitT('viewingOriginal'));
    else setStatus('');

    const p = st.profile;
    if (p && (p.pageType || p.topic)) {
      const box = $('context');
      const line = (text, cls = '') => Object.assign(document.createElement('p'), { textContent: text, className: cls });
      const kept = p.keepVerbatim || [];
      box.replaceChildren(
        line(aitT('ctxDetected', [p.pageType, p.domain].filter(Boolean).join(', '))),
        ...(p.topic ? [line(p.topic, 'ayuda')] : []),
        ...(kept.length ? [line(aitT('ctxKept', `${kept.slice(0, 12).join(', ')}${kept.length > 12 ? '…' : ''}`), 'ayuda')] : []),
      );
      box.hidden = false;
    }
  }

  // Con el Traductor, un idioma sin descargar se ofrece descargar acá: Translator.create() necesita este clic.
  let dlOpts = null;
  async function checkDownload() {
    $('dl').hidden = true;
    dlOpts = null;
    if (aitProviderType(settings) !== 'chrome') return false;
    const dst = aitLangCode(settings.targetLang);
    const src = String(state?.lang || 'en').toLowerCase().split('-')[0];
    if (!dst || src === dst) return false;
    const a = await aitTranslatorAvailability(src, dst).catch(() => 'missing');
    if (a !== 'downloadable' && a !== 'downloading') return false;
    dlOpts = { sourceLanguage: src, targetLanguage: dst };
    $('dlText').className = 'estado estado--aviso';
    $('dlText').textContent = aitT('popupNeedLang', settings.targetLang);
    $('dl').hidden = false;
    return true;
  }

  $('dlBtn').addEventListener('click', async () => {
    const name = settings.targetLang;
    $('dlBtn').disabled = true;
    $('dlBar').hidden = false;
    try {
      await aitDownloadTranslator(dlOpts, (pct) => {
        $('dlBar').value = pct;
        $('dlText').textContent = aitT('downloadingPct', name, pct);
      }, () => { $('dlText').textContent = aitT('installing', name); });
      $('dl').hidden = true;
      state = await send('restart');
      render(state);
    } catch (e) {
      $('dlText').className = 'estado estado--error';
      $('dlText').textContent = `${AIT_PROVIDERS.chrome.label}: ${(e && e.message) || e}`;
    } finally {
      $('dlBtn').disabled = false;
      $('dlBar').hidden = true;
    }
  });

  // Las últimas traducciones de la tarjeta de la selección (las anota el background).
  let recent = (await chrome.storage.local.get('history')).history || [];
  let shown = [];
  async function saveRecent() {
    await chrome.storage.local.set({ history: recent });
    renderRecent();
  }
  function renderRecent() {
    const words = $('recentSearch').value.toLowerCase().split(/\s+/).filter(Boolean);
    // Fijadas arriba; sort es estable, así que cada grupo sigue del más nuevo al más viejo.
    shown = recent.filter((h) => words.every((w) => `${h.o}\n${h.t}`.toLowerCase().includes(w)))
      .sort((a, b) => Boolean(b.fav) - Boolean(a.fav));
    $('recentList').replaceChildren(...shown.map((h) => {
      const li = document.createElement('li');
      li.className = 'reciente';
      const tr = document.createElement('p');
      tr.className = 'reciente__trad';
      tr.textContent = h.t;
      const or = document.createElement('p');
      or.className = 'reciente__orig';
      or.textContent = h.o;
      const acts = document.createElement('div');
      acts.className = 'reciente__acciones';
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'popup__enlace';
      copy.textContent = aitT('selCopy');
      copy.addEventListener('click', async () => {
        let msg = aitT('selCopied');
        try { await navigator.clipboard.writeText(h.t); } catch { msg = aitT('selCopyFail'); }
        copy.textContent = msg;
        $('recentStatus').textContent = msg;
        setTimeout(() => { copy.textContent = aitT('selCopy'); }, 1500);
      });
      const fav = document.createElement('button');
      fav.type = 'button';
      fav.className = 'reciente__borrar reciente__fav';
      fav.append(pinIcon());
      fav.setAttribute('aria-pressed', String(Boolean(h.fav)));
      fav.setAttribute('aria-label', aitT('recentFav'));
      fav.title = aitT('recentFav');
      fav.addEventListener('click', async () => {
        h.fav = !h.fav;
        await saveRecent();
        // La lista se rearmó y el ítem cambió de lugar: el foco sigue a su chincheta.
        $('recentList').children[shown.indexOf(h)]?.querySelector('.reciente__fav').focus();
      });
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'reciente__borrar';
      del.textContent = '✕';
      del.setAttribute('aria-label', aitT('recentDelete'));
      del.title = aitT('recentDelete');
      del.addEventListener('click', async () => {
        recent = recent.filter((x) => x !== h);
        await saveRecent();
        if (recent.length) $('recentSearch').focus();
      });
      acts.append(copy, fav, del);
      li.append(tr, acts, or);
      return li;
    }));
    const on = Boolean(settings.keepRecent);
    const has = on && recent.length > 0;
    $('keepRecent').checked = on;
    $('recentSearch').hidden = !has;
    $('recentClear').hidden = !has;
    $('recentList').hidden = !on;
    $('recentEmpty').hidden = !on || shown.length > 0;
    $('recentEmpty').textContent = aitT(has ? 'recentNoMatch' : 'recentEmpty');
  }
  $('recentSearch').addEventListener('input', renderRecent);
  // Apagado, el background borra la lista.
  $('keepRecent').addEventListener('change', async () => {
    settings = await aitSaveSettings({ keepRecent: $('keepRecent').checked });
    if (!settings.keepRecent) recent = [];
    renderRecent();
  });
  $('recentClear').addEventListener('click', async () => {
    recent = [];
    $('recentSearch').value = '';
    await saveRecent();
  });
  renderRecent();

  let state = await send('status');
  render(state);
  checkDownload();

  $('main').addEventListener('click', async () => {
    const type = !state || state.mode === 'off' || state.mode === 'original' ? 'translate' : 'original';
    state = await send(type);
    render(state);
  });

  $('lang').addEventListener('change', async () => {
    settings = await aitSaveSettings({ targetLang: $('lang').value });
    // Sin el idioma descargado se vuelve al original y se traduce al terminar la descarga.
    if (await checkDownload()) {
      if (state && state.mode !== 'off') render(state = await send('stop'));
      return;
    }
    if (state && state.mode !== 'off') {
      state = await send('restart');
      render(state);
    }
  });

  // La página cambia al instante: el background avisa a las pestañas con el cambio de configuración.
  $('bilingual').addEventListener('change', async () => {
    settings = await aitSaveSettings({ bilingual: $('bilingual').checked });
  });

  $('always').addEventListener('change', async () => {
    const list = new Set(settings.alwaysSites || []);
    if ($('always').checked) list.add(host);
    else list.delete(host);
    settings = await aitSaveSettings({ alwaysSites: [...list] });
    if ($('always').checked && (!state || state.mode === 'off')) {
      state = await send('translate');
      render(state);
    }
  });

  setInterval(async () => {
    state = await send('status');
    render(state);
  }, 800);
})();
