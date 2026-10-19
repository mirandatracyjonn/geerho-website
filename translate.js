// Translation (2026-10-19), like the apps: "Translate" on listing descriptions and messages. Browsers with a built-in
// translator (Chrome's Translator API) translate right on the page, on the device. Others open Google Translate in a
// new tab with the text (Google then sees that text; the button says so in its title).
const target = (navigator.language || "en").split("-")[0];

async function builtIn(text) {
  if (!("Translator" in self) || !("LanguageDetector" in self)) return null;
  try {
    const detector = await self.LanguageDetector.create();
    const [best] = await detector.detect(text);
    const source = best?.detectedLanguage;
    if (!source || source === "und") return null;
    if (source === target) return { same: true };
    const available = await self.Translator.availability({ sourceLanguage: source, targetLanguage: target });
    if (available === "unavailable") return null;
    const translator = await self.Translator.create({ sourceLanguage: source, targetLanguage: target });
    return { text: await translator.translate(text), source };
  } catch { return null; }
}

/** A "Translate" button that shows the translation under `anchor` (or opens Google Translate). */
export function translateButton(text, anchor, className = "link-button") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = "Translate";
  button.title = "Translate into your language";
  button.addEventListener("click", async () => {
    button.disabled = true;
    const result = await builtIn(text);
    button.disabled = false;
    if (result?.same) { button.textContent = "Already in your language"; return; }
    if (result?.text) {
      const out = document.createElement("p");
      out.className = "translation";
      out.textContent = result.text;
      const note = document.createElement("span");
      note.className = "card-meta";
      note.textContent = ` Translated by your browser from ${new Intl.DisplayNames([target], { type: "language" }).of(result.source) ?? result.source}`;
      out.append(note);
      anchor.after(out);
      button.remove();
      return;
    }
    window.open(`https://translate.google.com/?sl=auto&tl=${encodeURIComponent(target)}&text=${encodeURIComponent(text.slice(0, 4500))}&op=translate`,
                "_blank", "noopener");
  });
  return button;
}
