// Ventana que abre la tarjeta de la selección: el Traductor de Chrome solo baja un idioma con un clic en una página de
// la extensión (lo bajado desde la página queda para ese sitio, no para la extensión).
(async () => {
  const $ = (id) => document.getElementById(id);
  const q = new URLSearchParams(location.search);
  const [src, dst] = (q.get('pair') || '').split('>');
  const tab = Number(q.get('tab'));
  const settings = await aitGetSettings();
  await aitLoadUi(settings.uiEnglish);
  aitLocalize();
  let name = dst;
  try { name = new Intl.DisplayNames([AIT_UI_LANG], { type: 'language' }).of(dst) || dst; } catch { /* código raro */ }
  $('text').textContent = aitT('popupNeedLang', name);

  $('btn').addEventListener('click', async () => {
    $('btn').disabled = true;
    $('bar').hidden = false;
    try {
      await aitDownloadTranslator({ sourceLanguage: src, targetLanguage: dst }, (pct) => {
        $('bar').value = pct;
        $('text').textContent = aitT('downloadingPct', name, pct);
      }, () => { $('text').textContent = aitT('installing', name); });
      await chrome.tabs.sendMessage(tab, { type: 'downloaded' }).catch(() => {});
      window.close();
    } catch (e) {
      $('text').className = 'estado estado--error';
      $('text').textContent = `${AIT_PROVIDERS.chrome.label}: ${(e && e.message) || e}`;
      $('btn').disabled = false;
      $('bar').hidden = true;
    }
  });
})();
