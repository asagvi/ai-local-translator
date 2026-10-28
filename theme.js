// Tema elegido en Ajustes; se aplica antes de pintar para que la página no parpadee.
try {
  const t = localStorage.getItem('ait-theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch { /* sin almacenamiento: tema del sistema */ }
