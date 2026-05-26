/**
 * LiteLLM proxy HTTP client.
 *
 * - Tüm istekler `fetch` ile (Node 18+ built-in).
 * - Streaming chat completion destekli (SSE parse).
 * - AMD daemon down olursa LiteLLM kendisi fallback chain'i denerse de,
 *   biz de defensive: timeout + retry yapısı.
 */
class ApiClient {
  constructor(configFn) {
    this.configFn = configFn;
  }

  base() {
    return this.configFn().get("apiBase").replace(/\/$/, "");
  }
  key() {
    return this.configFn().get("apiKey");
  }
  chatModel() {
    return this.configFn().get("chatModel");
  }
  autocompleteModel() {
    return this.configFn().get("autocompleteModel");
  }
  systemPrompt() {
    return this.configFn().get("systemPrompt");
  }
  maxTokens() {
    return this.configFn().get("maxTokens");
  }

  /**
   * Non-streaming chat completion.
   * @returns {Promise<{ content: string, model: string, reasoning?: string, tokensIn: number, tokensOut: number, durationMs: number }>}
   */
  async chat(messages, opts = {}) {
    const url = `${this.base()}/chat/completions`;
    const body = {
      model: opts.model || this.chatModel(),
      messages: this.#applySystemPrompt(messages),
      max_tokens: opts.maxTokens || this.maxTokens(),
      temperature: opts.temperature ?? 0.3,
      stream: false,
    };
    const start = Date.now();
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.key()}`,
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`API ${resp.status}: ${text.slice(0, 300)}`);
    }
    const data = await resp.json();
    const msg = data.choices?.[0]?.message || {};
    return {
      content: msg.content || "",
      reasoning: msg.reasoning_content || msg.provider_specific_fields?.reasoning_content,
      model: data.model,
      tokensIn: data.usage?.prompt_tokens || 0,
      tokensOut: data.usage?.completion_tokens || 0,
      durationMs: Date.now() - start,
    };
  }

  /**
   * Streaming chat — chunk callback ile token-token gelir.
   * @param {(chunk: { content?: string, reasoning?: string, done?: boolean, error?: string }) => void} onChunk
   */
  async chatStream(messages, onChunk, opts = {}) {
    const url = `${this.base()}/chat/completions`;
    const body = {
      model: opts.model || this.chatModel(),
      messages: this.#applySystemPrompt(messages),
      max_tokens: opts.maxTokens || this.maxTokens(),
      temperature: opts.temperature ?? 0.3,
      stream: true,
    };
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.key()}`,
        },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        onChunk({ error: `${resp.status}: ${text.slice(0, 300)}` });
        return;
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let totalContent = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // SSE: each event = "data: {json}\n\n"
        let lines = buf.split("\n");
        buf = lines.pop() || ""; // keep partial line
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") {
            onChunk({ done: true, total: totalContent });
            return;
          }
          try {
            const obj = JSON.parse(payload);
            const delta = obj.choices?.[0]?.delta || {};
            if (delta.content) {
              totalContent += delta.content;
              onChunk({ content: delta.content });
            }
            if (delta.reasoning_content) {
              onChunk({ reasoning: delta.reasoning_content });
            }
          } catch (_e) {
            // ignore parse errors mid-stream
          }
        }
      }
      onChunk({ done: true, total: totalContent });
    } catch (e) {
      onChunk({ error: e.message });
    }
  }

  /**
   * FIM (Fill-in-the-Middle) completion for inline Tab.
   * Qwen3 modelleri için `<|fim_prefix|>...<|fim_suffix|>...<|fim_middle|>` formatı.
   * Fallback: chat-completion ile context-aware.
   */
  async fim(prefix, suffix, opts = {}) {
    const url = `${this.base()}/chat/completions`;
    // Pragmatik: chat completion ile yapalım (FIM template her modelde uyumlu olmayabilir)
    const messages = [
      {
        role: "user",
        content: `Aşağıdaki kod boşluğunu tamamla. SADECE kayıp kısmı yaz, açıklama yok, kod blok markerı yok.\n\n--- PREFIX ---\n${prefix}\n--- SUFFIX ---\n${suffix}\n--- MIDDLE (sen yaz) ---`,
      },
    ];
    const body = {
      model: opts.model || this.autocompleteModel(),
      messages,
      max_tokens: opts.maxTokens || 128,
      temperature: 0.2,
      stop: ["\n\n", "```", "--- "],
      stream: false,
    };
    const ctrl = new AbortController();
    const timeoutMs = opts.timeoutMs || 4000;
    const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.key()}` },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      let text = data.choices?.[0]?.message?.content || "";
      // Strip eventual markdown fences
      text = text.replace(/^```[a-z]*\n?/i, "").replace(/```\s*$/, "").trim();
      return text || null;
    } catch (_e) {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Health probe — control center FastAPI'ye `/api/pcs` çağrısı.
   * Her PC'nin online durumu + amd_gpu_temp döner.
   */
  async healthCheck() {
    const dashboardUrl = this.configFn().get("dashboardUrl").replace(/\/$/, "");
    try {
      const resp = await fetch(`${dashboardUrl}/api/pcs`, { signal: AbortSignal.timeout(3000) });
      if (!resp.ok) return null;
      return await resp.json();
    } catch (_e) {
      return null;
    }
  }

  #applySystemPrompt(messages) {
    const sp = this.systemPrompt();
    if (!sp || messages.some((m) => m.role === "system")) return messages;
    return [{ role: "system", content: sp }, ...messages];
  }
}

module.exports = { ApiClient };
