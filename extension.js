/**
 * LOLCC VS Code Extension - Entry Point
 *
 * 3 PC'li local LLM stack için Türkçe AI assistant.
 * - Chat WebView (sidebar)
 * - Inline Completion (Tab FIM)
 * - Status Bar (model + PC durumu)
 * - LiteLLM proxy üzerinden multi-PC fallback
 */
const vscode = require("vscode");
const { ApiClient } = require("./src/api-client");
const { ChatViewProvider } = require("./src/chat-panel");
const { LolccCompletionProvider } = require("./src/completion");
const { StatusBar } = require("./src/status-bar");
const { RemoteControl } = require("./src/remote-control");

let apiClient;
let statusBar;
let chatProvider;
let remoteControl;

function activate(context) {
  const config = () => vscode.workspace.getConfiguration("lolcc");

  apiClient = new ApiClient(config);
  statusBar = new StatusBar(apiClient, config);
  chatProvider = new ChatViewProvider(context.extensionUri, apiClient, config);
  remoteControl = new RemoteControl(apiClient, config);

  // --- WebView (sidebar chat) ---
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("lolcc.chatView", chatProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // --- Inline completion (Tab autocomplete) ---
  if (config().get("autocompleteEnabled")) {
    context.subscriptions.push(
      vscode.languages.registerInlineCompletionItemProvider(
        { pattern: "**" },
        new LolccCompletionProvider(apiClient, config)
      )
    );
  }

  // --- Status bar ---
  statusBar.show(context);

  // --- Commands ---
  context.subscriptions.push(
    vscode.commands.registerCommand("lolcc.openChat", () => {
      vscode.commands.executeCommand("workbench.view.extension.lolcc-sidebar");
    }),
    vscode.commands.registerCommand("lolcc.explainSelection", async () => {
      await sendSelectionToChat("Bu kodu Türkçe açıkla. Kısa ve net.", "Açıkla");
    }),
    vscode.commands.registerCommand("lolcc.refactorSelection", async () => {
      await sendSelectionToChat(
        "Bu kodu okunaklı, idiomatic refactor et. Davranışı koruyarak. Sadece kod döndür.",
        "Refactor"
      );
    }),
    vscode.commands.registerCommand("lolcc.healthCheck", async () => {
      await statusBar.runHealthCheck(true);
    }),
    vscode.commands.registerCommand("lolcc.remoteControl", async () => {
      await remoteControl.run();
    })
  );

  // Initial health check
  statusBar.runHealthCheck();

  console.log("[LOLCC] Extension activated.");
}

async function sendSelectionToChat(promptPrefix, taskLabel) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    vscode.window.showWarningMessage("LOLCC: Önce kod seç.");
    return;
  }
  const selected = editor.document.getText(editor.selection);
  const lang = editor.document.languageId || "text";
  const userMsg = `${promptPrefix}\n\n\`\`\`${lang}\n${selected}\n\`\`\``;

  // Open chat view if hidden
  await vscode.commands.executeCommand("workbench.view.extension.lolcc-sidebar");
  // Send via chat provider
  await chatProvider.postUserMessage(userMsg, taskLabel);
}

function deactivate() {
  statusBar?.dispose();
  console.log("[LOLCC] Deactivated.");
}

module.exports = { activate, deactivate };
