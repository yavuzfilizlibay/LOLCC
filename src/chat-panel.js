/**
 * Chat WebView Provider — sidebar chat panel.
 * Streaming destekli: token geldikçe UI'ya post mesaj.
 */
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");

class ChatViewProvider {
  constructor(extensionUri, apiClient, configFn) {
    this.extensionUri = extensionUri;
    this.apiClient = apiClient;
    this.configFn = configFn;
    this.messages = []; // chat history
    this.view = null;
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
          this.messages = [];
          this.#post({ type: "cleared" });
          break;
        case "modelSelect":
          await vscode.workspace.getConfiguration("lolcc").update("chatModel", msg.model, true);
          this.#post({ type: "info", text: `Model: ${msg.model}` });
          break;
      }
    });
  }

  async postUserMessage(content, label) {
    if (!this.view) {
      await vscode.commands.executeCommand("workbench.view.extension.lolcc-sidebar");
      // wait a tick for view to init
      await new Promise((r) => setTimeout(r, 200));
    }
    if (this.view) {
      this.#post({ type: "userBubble", content, label: label || "Görev" });
      await this.#handleUserMessage(content);
    }
  }

  async #handleUserMessage(content) {
    this.messages.push({ role: "user", content });
    this.#post({ type: "assistantStart" });
    let assistantContent = "";

    await this.apiClient.chatStream(this.messages, (chunk) => {
      if (chunk.error) {
        this.#post({ type: "error", text: chunk.error });
        return;
      }
      if (chunk.content) {
        assistantContent += chunk.content;
        this.#post({ type: "assistantToken", text: chunk.content });
      }
      if (chunk.reasoning) {
        this.#post({ type: "reasoningToken", text: chunk.reasoning });
      }
      if (chunk.done) {
        this.messages.push({ role: "assistant", content: assistantContent });
        this.#post({ type: "assistantEnd" });
      }
    });
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
