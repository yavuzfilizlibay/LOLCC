/**
 * Chat WebView Provider — v0.2 ile agent loop entegrasyonu.
 *
 * Mode toggle:
 *   - "chat"  → plain chat (single response, no tools)
 *   - "agent" → Cline-like multi-step (tool use loop)
 *
 * UI'da kullanıcı görev gönderdiğinde mode'a göre AgentLoop veya plain stream.
 */
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const { AgentLoop } = require("./agent-loop");

class ChatViewProvider {
  constructor(extensionUri, apiClient, configFn) {
    this.extensionUri = extensionUri;
    this.apiClient = apiClient;
    this.configFn = configFn;
    this.view = null;
    this.cancelled = false;
    this.mode = "chat"; // 'chat' or 'agent'
    this.autoApprove = false;
    this.agent = null;
  }

  resolveWebviewView(webviewView, _context, _token) {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    webviewView.webview.html = this.#renderHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case "userMessage":
          await this.#handleUserMessage(msg.content);
          break;
        case "clear":
          this.#getAgent().clearHistory();
          this.#post({ type: "cleared" });
          break;
        case "cancel":
          this.cancelled = true;
          break;
        case "setMode":
          this.mode = msg.mode === "agent" ? "agent" : "chat";
          this.#post({ type: "info", text: `Mod: ${this.mode === "agent" ? "🤖 Agent (tool kullanır)" : "💬 Chat (tek cevap)"}` });
          // Mode değişince history reset
          this.#getAgent().clearHistory();
          break;
        case "setAutoApprove":
          this.autoApprove = !!msg.value;
          this.#post({ type: "info", text: `Auto-approve: ${this.autoApprove ? "açık (read-only tool'lar)" : "kapalı"}` });
          break;
      }
    });
  }

  async postUserMessage(content, label) {
    if (!this.view) {
      await vscode.commands.executeCommand("workbench.view.extension.lolcc-sidebar");
      await new Promise((r) => setTimeout(r, 200));
    }
    if (this.view) {
      this.#post({ type: "userBubble", content, label: label || "Görev" });
      await this.#handleUserMessage(content);
    }
  }

  async #handleUserMessage(content) {
    this.cancelled = false;
    const agent = this.#getAgent();
    try {
      await agent.run(content, { mode: this.mode, autoApprove: this.autoApprove });
    } catch (e) {
      this.#post({ type: "error", text: "Hata: " + e.message });
    }
  }

  #getAgent() {
    if (!this.agent) {
      this.agent = new AgentLoop(
        this.apiClient,
        (msg) => this.#post(msg),
        () => this.cancelled
      );
    }
    return this.agent;
  }

  #post(msg) {
    this.view?.webview.postMessage(msg);
  }

  #renderHtml(webview) {
    const mediaPath = path.join(this.extensionUri.fsPath, "media");
    const html = fs.readFileSync(path.join(mediaPath, "chat.html"), "utf-8");
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "chat.css"));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "chat.js"));
    const cfg = this.configFn();
    return html
      .replaceAll("{{cssUri}}", cssUri.toString())
      .replaceAll("{{jsUri}}", jsUri.toString())
      .replaceAll("{{chatModel}}", cfg.get("chatModel"))
      .replaceAll("{{apiBase}}", cfg.get("apiBase"));
  }
}

module.exports = { ChatViewProvider };
