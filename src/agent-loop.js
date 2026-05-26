/**
 * Agent loop — Cline-like multi-step task runner.
 *
 * Akış:
 *   1. Kullanıcı görev verir
 *   2. Model'i çağır (streaming response)
 *   3. Response'tan tool extract et
 *   4. Tool için kullanıcı onayı al (auto-approve listesinde değilse)
 *   5. Tool execute et, sonucu history'ye ekle
 *   6. attempt_completion gelene veya iteration limit'e kadar tekrar
 *
 * UI ile bağlantı: postMessage ile her aşamayı bildirir.
 */
const vscode = require("vscode");
const { extractFirstTool } = require("./tools/tool-parser");
const { EXECUTORS } = require("./tools/executors");
const { buildAgentSystemPrompt } = require("./tools/system-prompt");

const MAX_ITERATIONS = 15;

class AgentLoop {
  /**
   * @param {ApiClient} apiClient
   * @param {(msg) => void} post - postMessage to webview
   * @param {() => boolean} cancelled - cancellation flag
   */
  constructor(apiClient, post, cancelled) {
    this.apiClient = apiClient;
    this.post = post;
    this.cancelled = cancelled;
    this.history = [];
  }

  /**
   * @param {string} userTask - initial user message
   * @param {object} opts - { autoApprove: bool, mode: 'agent'|'chat' }
   */
  async run(userTask, opts = {}) {
    const autoApprove = opts.autoApprove ?? false;
    const isAgent = opts.mode === "agent";

    // System prompt — agent mode'da tool description'lar var, chat mode'da hafif
    if (this.history.length === 0) {
      const sys = isAgent
        ? buildAgentSystemPrompt({
            workspaceName: vscode.workspace.workspaceFolders?.[0]?.name,
            platform: process.platform,
          })
        : "Sen Türkçe konuşan kıdemli bir geliştiricisin. Kısa, öz, kod örnekli cevap ver.";
      this.history.push({ role: "system", content: sys });
    }
    this.history.push({ role: "user", content: userTask });

    if (!isAgent) {
      // Plain chat — stream once, no tool loop
      await this.#streamOnce();
      return;
    }

    // Agent loop
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      if (this.cancelled()) {
        this.post({ type: "error", text: "Görev iptal edildi." });
        return;
      }
      this.post({ type: "iteration", n: iter + 1, max: MAX_ITERATIONS });
      const fullResponse = await this.#streamOnce();
      if (!fullResponse) {
        this.post({ type: "error", text: "Model boş cevap döndü." });
        return;
      }

      const tool = extractFirstTool(fullResponse);
      if (!tool) {
        // No tool = model done thinking but didn't call attempt_completion
        this.post({
          type: "info",
          text: "Model tool çağırmadı — görev sonlandırılmamış olabilir. /retry ile devam edebilirsin.",
        });
        return;
      }

      // attempt_completion = end of task
      if (tool.tool === "attempt_completion") {
        const result = tool.params.result || "Görev tamamlandı.";
        this.post({ type: "completion", text: result });
        return;
      }

      // Confirm before destructive tools
      const destructive = ["write_to_file", "execute_command"];
      let approved = autoApprove && !destructive.includes(tool.tool);
      if (!approved) {
        approved = await this.#confirmTool(tool);
      }
      if (!approved) {
        const reason = "Kullanıcı tool'u reddetti.";
        this.history.push({
          role: "user",
          content: `[Tool ${tool.tool} reddedildi: ${reason}] Farklı bir yaklaşım dene veya görevi sonlandır.`,
        });
        this.post({ type: "info", text: reason });
        continue;
      }

      // Execute
      this.post({ type: "toolStart", tool: tool.tool, params: tool.params });
      const executor = EXECUTORS[tool.tool];
      let result;
      try {
        result = await executor(tool.params);
      } catch (e) {
        result = { ok: false, error: e.message };
      }
      this.post({ type: "toolResult", tool: tool.tool, result });

      // Feed result back to model
      const resultMsg = result.ok
        ? `[${tool.tool} OK]\n${result.data || "(boş)"}`
        : `[${tool.tool} HATA]\n${result.error || "(unknown)"}`;
      this.history.push({ role: "user", content: resultMsg });
    }

    this.post({
      type: "error",
      text: `Maks ${MAX_ITERATIONS} iterasyon doldu. Görev tamamlanmadı.`,
    });
  }

  /** Single streaming model call — history'e assistant ekler, full response döndürür */
  async #streamOnce() {
    let full = "";
    this.post({ type: "assistantStart" });
    await this.apiClient.chatStream(this.history, (chunk) => {
      if (chunk.error) {
        this.post({ type: "error", text: chunk.error });
        return;
      }
      if (chunk.content) {
        full += chunk.content;
        this.post({ type: "assistantToken", text: chunk.content });
      }
      if (chunk.reasoning) {
        this.post({ type: "reasoningToken", text: chunk.reasoning });
      }
      if (chunk.done) {
        this.post({ type: "assistantEnd" });
      }
    });
    if (full) {
      this.history.push({ role: "assistant", content: full });
    }
    return full;
  }

  async #confirmTool(tool) {
    let preview = "";
    const { tool: name, params } = tool;
    if (name === "write_to_file") {
      preview = `Dosya yaz: ${params.path}\nİçerik (${(params.content || "").length} char)`;
    } else if (name === "execute_command") {
      preview = `Komut çalıştır:\n${params.command}`;
    } else {
      preview = `Tool: ${name}\n${JSON.stringify(params, null, 2)}`;
    }
    const choice = await vscode.window.showInformationMessage(
      `LOLCC tool çağrısı:\n\n${preview}`,
      { modal: true },
      "Onayla",
      "Reddet"
    );
    return choice === "Onayla";
  }

  clearHistory() {
    this.history = [];
  }
}

module.exports = { AgentLoop };
