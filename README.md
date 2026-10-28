# Translator: Browser, AI & Local (extensión de Chrome)

Traduce páginas web con IA **sin romper el código**: primero entiende de qué trata la página y luego traduce solo lo que es lenguaje natural.

## Instalar

1. Descomprime la carpeta `ai-translator`.
2. Abre `chrome://extensions` y activa **Modo de desarrollador**.
3. **Cargar descomprimida** → elige la carpeta.
4. Se abren los Ajustes: elige con qué traducir (el Traductor de Chrome no necesita nada más; Gemini trae una guía para la key gratis), pulsa **Guardar cambios** y, si quieres, **Probar traducción**.

## Uso

- Clic en el icono → **Traducir esta página** (o `Alt+T`, o clic derecho → “Traducir página con IA / ver original”).
- El mismo botón alterna entre **original** y **traducción** sin volver a gastar tokens.
- “Traducir siempre en este sitio” lo activa automáticamente al entrar.
- Selecciona un texto y pulsa el botón que aparece al lado (o clic derecho → “Traducir selección”): la traducción sale en una tarjeta, por párrafos y con el código intacto. Una palabra sola, con un servicio de IA, trae también su tipo y otros significados.
- El popup muestra el **contexto detectado** (tipo de página, dominio y términos que no se tocarán).

## Cómo decide qué NO traducir

Son capas, de la más barata a la más inteligente:

1. **Estructura HTML**: `code`, `pre`, `kbd`, `samp`, `var`, `script`, `style`, `textarea`, inputs, SVG, fórmulas, `contenteditable`, `translate="no"` y `.notranslate`.
2. **Editores y resaltadores**: Monaco, CodeMirror, Ace, highlight.js, Prism, Shiki, KaTeX/MathJax, vistas de archivo y diffs de GitHub.
3. **Fuente monoespaciada**: un fragmento monoespaciado dentro de un párrafo se trata como código. Un bloque monoespaciado se envía a la IA marcado como “mono”, y solo se traduce si es prosa.
4. **Heurística de forma**: URLs, emails, rutas, nombres de archivo, `camelCase`, `snake_case`, `obj.metodo()`, `Clase::metodo`, `--flags`, prompts `$ comando`.
5. **Contexto con IA (antes de traducir)**: se envía un resumen de la página (título, encabezados, código en línea, muestra de texto) y la IA devuelve tipo de página, dominio, tono, glosario y una lista de términos que no deben traducirse en *esa* página. Ese perfil acompaña a cada lote. No se pide con el Traductor de Chrome ni con Traductor de Chrome + IA.
6. **Frases completas con marcadores**: cada párrafo viaja entero como `Run <x0/> to apply the <g0>database changes</g0>`. `<x0/>` es el código (no se envía a traducir y vuelve intacto) y `<g0>` es el enlace o negrita. Si la IA rompe los marcadores, se reintenta una vez; si vuelve a fallar, ese fragmento queda en el original.

Además puedes añadir selectores propios en Opciones, globales o por dominio:

```
.product-sku
@github.com .commit-title
```

## Proveedores sin pagar

**Traductor de Chrome (por defecto, sin key):** es el traductor integrado de Google Chrome y corre en tu equipo. Es el más rápido: una pantalla en menos de un segundo.
1. En Opciones deja el servicio "Traductor de Chrome" y pulsa **Comprobar**. Si falta el paquete de idioma, pulsa **Descargar**: son unos MB y se baja una sola vez.
2. No analiza el contexto de la página. Si un fragmento sale con enlaces o negritas rotos, lo arregla **Gemini Nano**, la IA integrada de Google Chrome (no se elige como servicio: es unas 20 veces más lenta). Opciones ofrece **Descargar Gemini Nano** si falta; son varios GB.
3. Gemini Nano necesita Google Chrome (Brave, Edge, Opera y Vivaldi no lo traen), 22 GB libres en disco y una tarjeta gráfica con más de 4 GB (o 16 GB de RAM), y solo traduce a español, inglés, japonés, alemán y francés. Tampoco arranca si la tarjeta gráfica está ocupada (otro modelo de IA cargado, un juego): libérala y reinicia Chrome. Sin Nano, esos fragmentos quedan en el original.

**Traductor de Chrome + Google Gemini:** traduce el Traductor de Chrome, y a Gemini (con tu key gratis, ver abajo) solo van las frases que salen rotas. Si el Traductor no tiene el par de idiomas, la página entera va a Gemini. Es el recomendado donde no hay Gemini Nano.

**Gemini con key gratis:** entra a [Google AI Studio](https://aistudio.google.com/) con tu cuenta de Google → *Get API key*. No pide tarjeta.
1. En Opciones elige "Google Gemini" y pega la key (la guía de 3 pasos está ahí mismo). La extensión busca los modelos de tu cuenta y elige el recomendado; pulsa **Guardar cambios**. Lo mismo pasa con Anthropic, OpenAI, OpenRouter, LM Studio y Ollama.
2. Al elegirlo se ajustan solos los lotes (6000 caracteres, 1 en paralelo).
3. Si llegas al límite por minuto, la traducción espera lo que pide Google y continúa sola.

## Todos los proveedores

| Proveedor | URL base | Notas |
|---|---|---|
| Traductor de Chrome | — | Local, sin key, el más rápido |
| Traductor de Chrome + Google Gemini | — | Gemini solo arregla lo roto |
| Anthropic | `https://api.anthropic.com` | El modelo se elige solo (Haiku) |
| OpenAI | `https://api.openai.com/v1` | El modelo se elige solo (el "mini") |
| Gemini | `https://generativelanguage.googleapis.com/v1beta` | El modelo se elige solo (el Flash-Lite estable más nuevo) |
| OpenRouter | `https://openrouter.ai/api/v1` | Elige el modelo en la lista; filtros "Solo gratis" y "Para traducir" |
| LM Studio | `http://localhost:1234/v1` (sin `/v1` también sirve) | Developer → Local Server, arrancar el servidor |
| Ollama | `http://localhost:11434/v1` (sin `/v1` también sirve) | Necesita permiso para la extensión: ver abajo |

La lista de modelos tiene buscador (con más de 10). Con LM Studio y Ollama se elige solo Gemma 4 12B si está descargado (~8 GB de memoria gráfica); si no, el primero.

**LM Studio y Ollama** corren en tu equipo y necesitan instalarse aparte. Pueden traducir más lento según la tarjeta gráfica, y el primer texto espera a que el modelo lea la página. Al elegirlos se ajustan solos los lotes (1500 caracteres, 1 a la vez).

**Ollama** responde 403 si no le das permiso a la extensión. Opciones muestra los comandos con el origen de tu extensión (`chrome-extension://<id>`); no uses `chrome-extension://*`, que abre Ollama a cualquier extensión. En Linux, con Ollama como servicio:

```
sudo systemctl edit ollama
# [Service]
# Environment="OLLAMA_ORIGINS=chrome-extension://<id>"
sudo systemctl restart ollama
ollama pull gemma4:12b
```

En Windows o macOS, crea la variable de entorno `OLLAMA_ORIGINS=chrome-extension://<id>` y reinicia Ollama.

Con menos de 24 GB de memoria gráfica, Ollama lee solo 4096 tokens por consulta y recorta el resto sin avisar; por eso se envían 1500 caracteres. Para más, agrega `Environment="OLLAMA_CONTEXT_LENGTH=8192"` (usa más memoria gráfica).

## Detalles técnicos

- Solo traduce lo visible (y ~800 px alrededor) a medida que haces scroll: ahorra tokens en páginas largas.
- Contenido dinámico (SPA, React, carga infinita) se traduce al aparecer.
- Cuando la frase conserva la misma estructura, la traducción se escribe **en los mismos nodos de texto** en lugar de reemplazar elementos; así React/Vue no se rompen y los enlaces siguen funcionando.
- Caché persistente de traducciones (por idioma + modelo); se vacía desde Opciones.
- También traduce `placeholder`, `title`, `alt` y `aria-label`.
- La API key se guarda en `chrome.storage.local`, que solo leen el service worker, Opciones y el popup: el script que corre en cada página no la ve. Se envía solo al servicio al que pertenece. Requiere Chrome 140 o superior.

## Archivos

```
manifest.json   MV3
background.js   llamadas a la IA, prompts, perfil de contexto, caché, atajo y menú
offscreen.*     documento invisible donde corren el Traductor de Chrome y Gemini Nano
nano.js         utilidades de la Prompt API y la Translator API
content.js      escaneo del DOM, protección de código, lotes, aplicar / revertir
settings.js     valores por defecto, proveedores y textos
popup.*         ventana del icono
options.*       configuración
ui.css          estilos del popup y de Opciones (claro y oscuro)
theme.js        tema elegido, antes de pintar
_locales/       textos de la interfaz en 10 idiomas
tests/          pruebas (ver AGENTS.md)
empaquetar.sh   arma el zip para la Chrome Web Store en dist/
```

## Limitaciones

- No traduce dentro de iframes ni de Shadow DOM de terceros.
- Si la IA reordena enlaces dentro de una frase, ese párrafo se reconstruye; en apps React muy dinámicas eso puede chocar ocasionalmente (igual que con el traductor de Chrome).

## Licencia

GPL-3.0 o posterior: ver [LICENSE](LICENSE). Quien publique una versión modificada tiene que publicar también su código con la misma licencia.

La fuente Atkinson Hyperlegible Next (`fonts/`) tiene su propia licencia, OFL 1.1 ([fonts/OFL.txt](fonts/OFL.txt)).
