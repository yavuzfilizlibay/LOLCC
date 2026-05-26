/**
 * Status Bar Item — sağ alt köşede LOLCC durumu.
 *
 * - Tıklayınca: PC sağlık özet popup
 * - Renk: tüm PC'ler online ise yeşil, biri offline ise turuncu, hepsi offline ise kırmızı
 * - 30 saniyede bir auto-refresh
 */
const vscode = require("vscode");

class StatusBar {
  constructor(apiClient, configFn) {
    this.apiClient = apiClient;
    this.configFn = configFn;
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = "lolcc.healthCheck";
    this.item.text = "$(sync~spin) LOLCC";
    this.timer = null;
  }

  show(context) {
    this.item.show();
    context.subscriptions.push(this.item);
    // auto-refresh every 30s
    this.timer = setInterval(() => this.runHealthCheck(), 30_000);
  }

  async runHealthCheck(showPopup = false) {
    const cfg = this.configFn();
    const model = cfg.get("chatModel");
    const data = await this.apiClient.healthCheck();
    if (!data) {
      this.item.text = "$(warning) LOLCC: dashboard kapalı";
      this.item.tooltip = "Control Center FastAPI (8090) erişilemiyor";
      this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
      if (showPopup) {
        vscode.window.showWarningMessage("LOLCC: Control Center (8090) erişilemiyor. LOLCC kısayoluna tıkla.");
      }
      return;
    }

    const onlineCount = data.filter((p) => p.online).length;
    const total = data.length;
    const amdTemp = data.find((p) => p.name === "Yavuz-Ryzen")?.amd_gpu_temp_c;
    const tempStr = amdTemp != null ? ` · AMD ${amdTemp.toFixed(0)}°C` : "";

    let icon = "$(check)";
    let bg = null;
    if (onlineCount === 0) {
      icon = "$(error)";
      bg = new vscode.ThemeColor("statusBarItem.errorBackground");
    } else if (onlineCount < total) {
      icon = "$(warning)";
      bg = new vscode.ThemeColor("statusBarItem.warningBackground");
    }
    this.item.text = `${icon} LOLCC ${onlineCount}/${total}${tempStr}`;
    this.item.tooltip = this.#buildTooltip(data, model);
    this.item.backgroundColor = bg;

    if (showPopup) {
      const lines = data.map((p) =>
        `${p.online ? "✅" : "❌"} ${p.name.padEnd(16)} ${p.ip}${
          p.amd_gpu_temp_c != null ? ` · GPU ${p.amd_gpu_temp_c.toFixed(0)}°C` : ""
        }`
      );
      const summary = `Model: ${model}\n\n${lines.join("\n")}`;
      vscode.window.showInformationMessage(summary, { modal: true });
    }
  }

  #buildTooltip(data, model) {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**LOLCC** · Model: \`${model}\`\n\n`);
    md.appendMarkdown("| PC | Status | IP |\n|---|---|---|\n");
    for (const pc of data) {
      const status = pc.online ? "🟢" : "🔴";
      md.appendMarkdown(`| ${pc.name} | ${status} | ${pc.ip} |\n`);
    }
    return md;
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.item.dispose();
  }
}

module.exports = { StatusBar };
