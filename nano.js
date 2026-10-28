/* Utilidades de Gemini Nano (Prompt API) y del Traductor de Chrome. Las usan offscreen.js, options.js y popup.js. */
/* eslint-disable no-unused-vars */

function aitNanoApi() {
  if (typeof LanguageModel !== 'undefined') return LanguageModel;
  // Nombre antiguo durante el origin trial.
  if (globalThis.ai && globalThis.ai.languageModel) return globalThis.ai.languageModel;
  return null;
}

function aitNanoOptions(inLangs, outLang) {
  return {
    expectedInputs: [{ type: 'text', languages: inLangs }],
    expectedOutputs: [{ type: 'text', languages: [outLang] }],
  };
}

// Normaliza los valores de availability() entre versiones de Chrome.
async function aitNanoAvailability(opts) {
  const api = aitNanoApi();
  if (!api) return 'missing';
  let a;
  try {
    a = api.availability ? await api.availability(opts) : (await api.capabilities()).available;
  } catch (e) {
    if (e && e.name === 'NotSupportedError') return 'unsupported-language';
    throw e;
  }
  const map = { readily: 'available', 'after-download': 'downloadable', no: 'unavailable' };
  return map[a] || a;
}

// Mensaje para availability() 'missing' o 'unavailable'.
function aitNanoUnavailableMsg(avail) {
  const browser = aitBrowserName();
  if (browser !== 'Google Chrome') {
    return aitT('errNanoBrowser', browser, AIT_PROVIDERS.gemini.label);
  }
  if (avail === 'missing') return aitT('errNanoOld');
  return aitT('errNanoUnavailable');
}

function aitTranslatorAvailability(src, dst) {
  if (typeof Translator === 'undefined') return Promise.resolve('missing');
  return Translator.availability({ sourceLanguage: src, targetLanguage: dst });
}

function aitTranslatorUnavailableMsg(avail) {
  const browser = aitBrowserName();
  // Brave sí lo trae: el navegador solo se nombra cuando la API no existe.
  if (avail === 'missing' && browser !== 'Google Chrome') {
    return aitT('errTrBrowser', browser, AIT_PROVIDERS.gemini.label);
  }
  if (avail === 'missing') return aitT('errTrOld');
  return aitT('errTrLang');
}

// monitor de create(): avisa el avance de la descarga en %.
function aitMonitor(onProgress) {
  return (m) => m.addEventListener('downloadprogress', (e) => onProgress(Math.round((e.loaded > 1 ? e.loaded / e.total : e.loaded) * 100)));
}

// Descarga el par de idiomas del Traductor. Necesita un clic del usuario.
async function aitDownloadTranslator(opts, onProgress, onInstalling) {
  const create = () => Translator.create({ ...opts, monitor: aitMonitor(onProgress) });
  let session;
  try {
    session = await create();
  } catch (e) {
    // En páginas de extensión el primer Translator.create() falla aunque baja el paquete; segundos después funciona.
    onInstalling?.();
    for (let i = 0; !session; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        session = await create();
      } catch (again) {
        if (i >= 9) throw again;
      }
    }
  }
  session.destroy();
}

function aitNanoError(e) {
  const name = e && e.name;
  const msg = (e && e.message) || String(e);
  if (name === 'QuotaExceededError') return 'TRUNCATED';
  if (name === 'NotSupportedError') return aitT('errNanoLang');
  if (name === 'NotAllowedError') return aitT('errNanoNotDownloaded');
  // En el offscreen, los textos propios llegan como {"i18n":…} y ya empiezan con "Gemini Nano:".
  return msg.startsWith('Gemini Nano') || msg.startsWith('{"i18n"') ? msg : `Gemini Nano: ${msg}`;
}
