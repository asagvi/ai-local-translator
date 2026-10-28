# Privacy Policy — Translator: Browser, AI & Local

Last updated: October 27, 2026

Translator: Browser, AI & Local ("the extension") translates web pages in your browser. This policy explains what
data the extension handles, where it goes, and what stays on your computer.

**In short:** the extension has no server of its own and does not collect, sell or share your data. With
Chrome Translator or Gemini Nano, the text you translate doesn't leave your computer. With a cloud AI service, the text you ask to
translate is sent directly from your browser to the service you chose.

## What the extension sends, and to whom

The extension only sends a page's content when you ask it to translate that page (toolbar button, Alt+T or
the right-click menu), or when you added that site to "Always translate on these sites". It does not read or
send pages you don't translate.

You can also translate just the text you select, with the button that appears next to it, with "Translate
selection" in the right-click menu or with Alt+S. This also works on text you select in a field where you are
typing (to translate it into the page's language and replace it). Only the selected text is sent (or the text you
type after "Edit text"), and only after you ask. With a single word
and a cloud AI service, the sentence around it (up to about 300 characters) goes too, so the AI picks the right
meaning. The button itself works on your computer: selecting text sends nothing.

What happens next depends on the translation service you pick in Settings:

| Service | Where the text goes |
|---|---|
| Chrome Translator, Gemini Nano | Nowhere. Translation runs on your device, inside Chrome. |
| LM Studio, Ollama, or another server you configure | Only to the address you enter (usually your own computer). |
| Google Gemini, Anthropic (Claude), OpenAI, OpenRouter | Directly to that company's API, using your own API key. |
| Chrome Translator + Google Gemini | Chrome Translator translates on your device. Only the sentences it gets wrong (broken links or formatting), and whole pages in a language pair it doesn't have, go to Google Gemini to fix them, with your own API key. |

When a cloud service is used, each request contains:

- the text of the page being translated, or the text you selected (with code, commands, links and similar parts replaced by placeholders where possible);
- the page's address (URL) and title, so the AI understands the context;
- your style instructions and your glossary, if you wrote any;
- if "Understand the page before translating" is on, a summary of the page: its title, language, meta description, headings and a short text sample.

That data is then handled under the privacy policy of the service you chose:

- Google Gemini API: https://ai.google.dev/gemini-api/terms — with a free API key, Google may use what you send to improve its products. Settings shows this notice next to the key.
- Anthropic: https://www.anthropic.com/legal/privacy
- OpenAI: https://openai.com/policies/privacy-policy
- OpenRouter: https://openrouter.ai/privacy

**Listen** (in the selection card) uses the voices your browser provides. In Google Chrome these are often
Google's online voices: the translated text is then sent to Google to produce the audio, under Google's privacy
policy (https://policies.google.com/privacy). Nothing is sent until you press Listen.

The extension never sends your data to the developer or to any analytics, advertising or tracking service.

## What is stored on your computer

Everything below stays in your browser's local extension storage and is never sent to the developer:

- **Settings**: the service you chose, target language, preferences, your glossary, and the lists of sites to always or never translate.
- **API key**: stored only in this browser and sent only to the service it belongs to, to authenticate your requests. If you turn on "Forget API keys when closing the browser", it is kept only in memory and deleted when the browser closes.
- **Saved translations** (if "Remember translations" is on): translated text, so a page you revisit is translated instantly. You can delete them anytime in Settings → Advanced → "Delete saved translations". They are also cleared automatically after 40,000 entries.
- **Recent translations** (only if you turn on "Keep recent translations", off by default): the last 20 texts you translated with the selection card, plus the ones you pin, with their translation, so you can find them again in the toolbar popup. You can delete one or all of them there; turning the option off deletes them all.
- **Page summaries**: kept only until you close the browser.

Uninstalling the extension deletes all of this.

## Permissions

- **Access to all websites** and **scripting**: to read and translate the text of the page you ask it to translate, on any site.
- **Storage** and **unlimited storage**: to save your settings and translations on your computer.
- **Context menus**: for the "Translate page with AI / show original" and "Translate selection" right-click options.
- **Offscreen document**: to run Chrome's on-device AI (Gemini Nano and Chrome Translator), which isn't available in the background process.

## Children

The extension is not directed at children and does not knowingly collect information from anyone.

## Changes

If this policy changes, the new version will be published at this same address with a new date.

## Contact

Aldair — asagvi@gmail.com
