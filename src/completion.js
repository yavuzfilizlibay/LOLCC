/**
 * Inline Completion Provider — Tab autocomplete.
 *
 * VS Code "Inline Suggest" API'yi kullanır. Cursor pozisyonundaki
 * prefix + suffix'i alır, model'e FIM çağrısı yapar, dönen text'i
 * inline öneri olarak gösterir.
 *
 * Debounce: 300ms — user yazarken her keystroke'ta çağrı yapmaz.
 */
const vscode = require("vscode");

const DEBOUNCE_MS = 300;
const MAX_PREFIX = 1500;  // char
const MAX_SUFFIX = 500;

class LolccCompletionProvider {
  constructor(apiClient, configFn) {
    this.apiClient = apiClient;
    this.configFn = configFn;
    this._lastTrigger = 0;
    this._cache = new Map(); // simple LRU-like memoization
  }

  async provideInlineCompletionItems(document, position, _context, token) {
    // Toggle check
    if (!this.configFn().get("autocompleteEnabled")) return null;

    // Debounce
    const now = Date.now();
    const sinceLast = now - this._lastTrigger;
    if (sinceLast < DEBOUNCE_MS) {
      await new Promise((r) => setTimeout(r, DEBOUNCE_MS - sinceLast));
    }
    this._lastTrigger = now;
    if (token.isCancellationRequested) return null;

    // Build prefix + suffix
    const offset = document.offsetAt(position);
    const fullText = document.getText();
    const prefix = fullText.slice(Math.max(0, offset - MAX_PREFIX), offset);
    const suffix = fullText.slice(offset, offset + MAX_SUFFIX);

    if (prefix.trim().length < 3) return null; // skip empty buffers

    // Cache key (line+col+last 50 prefix chars)
    const cacheKey = `${document.uri.toString()}@${offset}@${prefix.slice(-50)}`;
    if (this._cache.has(cacheKey)) {
      return [{ insertText: this._cache.get(cacheKey), range: new vscode.Range(position, position) }];
    }

    try {
      const completion = await this.apiClient.fim(prefix, suffix, { timeoutMs: 4000 });
      if (!completion || token.isCancellationRequested) return null;

      // Trim to first sensible boundary
      const trimmed = this.#trimCompletion(completion, prefix);
      if (!trimmed) return null;

      // Cache
      if (this._cache.size > 50) {
        const firstKey = this._cache.keys().next().value;
        this._cache.delete(firstKey);
      }
      this._cache.set(cacheKey, trimmed);

      return [{
        insertText: trimmed,
        range: new vscode.Range(position, position),
      }];
    } catch (_e) {
      return null;
    }
  }

  #trimCompletion(text, prefix) {
    // Eğer model prefix'i tekrar yazdıysa, başını kes
    const lastLine = prefix.split("\n").pop();
    if (lastLine && text.startsWith(lastLine)) {
      text = text.slice(lastLine.length);
    }
    // İlk anlamlı blok — boş satırlardan önce
    const cutIdx = text.indexOf("\n\n");
    if (cutIdx > 0) text = text.slice(0, cutIdx);
    return text.trimEnd();
  }
}

module.exports = { LolccCompletionProvider };
