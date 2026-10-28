# Chrome Web Store — "Privacy practices" tab

Answers to paste into the Developer Dashboard. They must match `PRIVACY.md`: if the code changes what is sent
or stored, update both.

## Single purpose

> Translates web pages into the user's language while leaving code, commands, identifiers, links and proper
> names untouched.

## Permission justifications

**storage**
> Saves the user's settings (translation service, target language, preferences, site lists, API key) and, if
> enabled, previously translated text so revisited pages translate instantly. Everything stays in local
> extension storage; if the user chooses, API keys are kept only in session storage and deleted when the
> browser closes.

**unlimitedStorage**
> The local translation cache can exceed the default 10 MB quota on long or frequently visited pages. It is
> capped at 40,000 entries and can be cleared from Settings.

**scripting**
> Injects the translation script into tabs that were already open before the extension was installed, when
> the user asks to translate them.

**contextMenus**
> Adds "Translate page with AI / show original" to the page's right-click menu, and "Translate selection" when
> text is selected.

**offscreen**
> Chrome's on-device AI (Gemini Nano via the Prompt API, and the Translator API) is not available in the
> service worker. An offscreen document runs them so translation can happen locally, without sending text
> anywhere.

**Host permission (`<all_urls>`)**
> The extension's purpose is to translate any web page the user chooses. The content script must read and
> replace the page's text on whatever site the user is on, and the user can set sites to translate
> automatically. Nothing is sent until the user asks to translate a page or the text they selected, or
> adds the site to "Always translate". When the user picks a cloud AI service, requests go directly from the browser to that
> service's API (Google, Anthropic, OpenAI, OpenRouter) or to a server address the user enters.

## Remote code

> No, I am not using remote code. All JavaScript is included in the package. The extension only exchanges
> JSON data (text to translate and translations) with the AI service the user selects.

## Data usage

Data types to check (they apply when the user picks a cloud service, or "Chrome Translator + Google Gemini", which
sends Gemini the sentences to fix; with Chrome Translator or Gemini Nano nothing leaves the device, but the form asks about
the extension as a whole):

- [x] **Website content** — the text of the page being translated, or the text the user selected (for a single
  word, also the sentence around it), sent to the AI service the user chose. "Listen" uses the browser's speech
  voices; in Google Chrome they are often Google's online voices, which receive the translated text.
- [x] **Web history** — the URL and title of the page being translated go with each request to that service.
- [x] **Authentication information** — the user's own API key, stored locally and sent only to its service.
- [ ] Personally identifiable information, health, financial and payment, personal communications, location,
  user activity: not collected.

Certifications (all three apply):

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases.
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes.

Sending text to the AI service the user picked is what the extension does, so it is the approved use case.

## Privacy policy URL

Publish `PRIVACY.md` at a public address (GitHub Pages, a public gist, or your site) and paste that URL into
the dashboard. If the policy changes, update its "Last updated" date.
