/**
 * Remote Control — 3 PC'li LOLCC stack'ini VS Code içinden yönet.
 *
 * `LOLCC: Uzaktan Kontrol` komutu bir QuickPick akışı açar:
 *   1. PC seç (canlı /api/pcs durumuyla)
 *   2. Aksiyon seç (model yükle/değiştir, daemon restart, güç işlemleri)
 *   3. Gerekirse model / servis seç
 *   4. Yıkıcı işlemlerde modal onay
 *   5. Progress ile Control Center FastAPI'ye POST, sonucu bildir
 *
 * Backend sözleşmesi REMOTE_CONTROL.md içinde. Endpoint yolları
 * `lolcc.controlEndpoints` ayarından override edilebilir.
 */
const vscode = require("vscode");

// package.json chatModel enum ile senkron tutulur.
const KNOWN_MODELS = [
  "qwen3.5-4b-balanced",
  "phi-4-balanced",
  "qwen3-coder-30b",
  "qwen3-30b",
  "qwopus-reasoning",
  "hpserver-qwen4b",
];

const DAEMON_SERVICES = [
  { label: "lm-studio", detail: "LM Studio (AMD)" },
  { label: "llama-server", detail: "llama.cpp server (HpServer)" },
  { label: "litellm", detail: "LiteLLM proxy (4000)" },
];

// Aksiyon kataloğu. `path` default; `lolcc.controlEndpoints[id]` ile ezilebilir.
const ACTIONS = [
  {
    id: "model.load",
    label: "$(cloud-download) Model Yükle / Değiştir",
    detail: "Seçili PC'de bir LLM modelini yükle veya aktif modeli değiştir",
    path: "/api/model/load",
    needsModel: true,
    destructive: false,
  },
  {
    id: "model.unload",
    label: "$(trash) Model Boşalt",
    detail: "Seçili PC'de aktif modeli bellekten boşalt (VRAM/RAM serbest bırak)",
    path: "/api/model/unload",
    destructive: false,
  },
  {
    id: "daemon.restart",
    label: "$(debug-restart) Daemon Yeniden Başlat",
    detail: "LM Studio / llama-server / LiteLLM servisini yeniden başlat",
    path: "/api/daemon/restart",
    needsService: true,
    destructive: true,
  },
  {
    id: "power.wake",
    label: "$(zap) Uyandır (Wake-on-LAN)",
    detail: "Kapalı/uykudaki PC'ye WoL magic packet gönder",
    path: "/api/power/wake",
    power: true,
    allowOffline: true,
    destructive: false,
  },
  {
    id: "power.reboot",
    label: "$(refresh) Yeniden Başlat",
    detail: "PC'yi reboot et",
    path: "/api/power/reboot",
    power: true,
    destructive: true,
  },
  {
    id: "power.shutdown",
    label: "$(circle-slash) Kapat",
    detail: "PC'yi kapat (shutdown)",
    path: "/api/power/shutdown",
    power: true,
    destructive: true,
  },
];

class RemoteControl {
  /**
   * @param {ApiClient} apiClient
   * @param {() => vscode.WorkspaceConfiguration} configFn
   */
  constructor(apiClient, configFn) {
    this.apiClient = apiClient;
    this.configFn = configFn;
  }

  /** Komut girişi — tüm akışı yürütür. */
  async run() {
    const pc = await this.#pickPc();
    if (!pc) return;

    const action = await this.#pickAction(pc);
    if (!action) return;

    const payload = { pc: pc.name, ip: pc.ip };

    if (action.needsModel) {
      const model = await this.#pickModel();
      if (!model) return;
      payload.model = model;
    }
    if (action.needsService) {
      const service = await this.#pickService();
      if (!service) return;
      payload.service = service;
    }

    if (action.destructive) {
      const ok = await this.#confirm(pc, action, payload);
      if (!ok) return;
    }

    await this.#execute(pc, action, payload);
  }

  async #pickPc() {
    const pcs = await this.apiClient.healthCheck();
    if (pcs && Array.isArray(pcs) && pcs.length) {
      const items = pcs.map((p) => ({
        label: `${p.online ? "$(vm-active)" : "$(vm-outline)"} ${p.name}`,
        description: `${p.ip}${p.online ? "" : " · offline"}`,
        detail: p.amd_gpu_temp_c != null ? `AMD GPU ${p.amd_gpu_temp_c.toFixed(0)}°C` : undefined,
        pc: p,
      }));
      const picked = await vscode.window.showQuickPick(items, {
        title: "LOLCC Uzaktan Kontrol — PC seç",
        placeHolder: "İşlem yapılacak makineyi seç",
        matchOnDescription: true,
      });
      return picked?.pc;
    }

    // Dashboard erişilemiyor — manuel PC adı gir (WoL gibi işlemler için gerekli olabilir).
    const choice = await vscode.window.showWarningMessage(
      "Control Center (dashboard) erişilemiyor. PC adını elle girmek ister misin?",
      "Elle Gir",
      "İptal"
    );
    if (choice !== "Elle Gir") return null;
    const name = await vscode.window.showInputBox({
      title: "PC adı",
      prompt: "Hedef makinenin adı (örn. Yavuz-Ryzen)",
      ignoreFocusOut: true,
    });
    if (!name) return null;
    return { name: name.trim(), ip: "", online: false, manual: true };
  }

  async #pickAction(pc) {
    const powerEnabled = this.configFn().get("powerActionsEnabled");
    const items = ACTIONS.filter((a) => powerEnabled || !a.power)
      .filter((a) => a.allowOffline || pc.online || pc.manual)
      .map((a) => ({
        label: a.label + (a.destructive ? "  $(warning)" : ""),
        detail: a.detail,
        action: a,
      }));

    if (!items.length) {
      vscode.window.showInformationMessage(
        pc.online ? "Uygun aksiyon yok." : `${pc.name} offline — sadece Wake-on-LAN yapılabilir (güç işlemleri ayarda kapalı olabilir).`
      );
      return null;
    }
    const picked = await vscode.window.showQuickPick(items, {
      title: `LOLCC — ${pc.name} için aksiyon`,
      placeHolder: "Ne yapmak istiyorsun?",
      matchOnDetail: true,
    });
    return picked?.action;
  }

  async #pickModel() {
    const current = this.apiClient.chatModel();
    const items = [
      ...KNOWN_MODELS.map((m) => ({ label: m, description: m === current ? "aktif chat modeli" : undefined })),
      { label: "$(edit) Diğer…", other: true },
    ];
    const picked = await vscode.window.showQuickPick(items, {
      title: "Yüklenecek model",
      placeHolder: "Model ID seç",
    });
    if (!picked) return null;
    if (picked.other) {
      const custom = await vscode.window.showInputBox({
        title: "Model ID",
        prompt: "LiteLLM / LM Studio model ID'si",
        ignoreFocusOut: true,
      });
      return custom?.trim() || null;
    }
    return picked.label;
  }

  async #pickService() {
    const picked = await vscode.window.showQuickPick(DAEMON_SERVICES, {
      title: "Yeniden başlatılacak servis",
      placeHolder: "Daemon seç",
      matchOnDetail: true,
    });
    return picked?.label || null;
  }

  async #confirm(pc, action, payload) {
    const extra = payload.model
      ? `\nModel: ${payload.model}`
      : payload.service
      ? `\nServis: ${payload.service}`
      : "";
    const cleanLabel = action.label.replace(/\$\([^)]+\)\s*/g, "").trim();
    const choice = await vscode.window.showWarningMessage(
      `${pc.name} üzerinde "${cleanLabel}" çalıştırılsın mı?${extra}`,
      { modal: true, detail: action.detail },
      "Evet, çalıştır"
    );
    return choice === "Evet, çalıştır";
  }

  async #execute(pc, action, payload) {
    const path = this.#endpointFor(action);
    const cleanLabel = action.label.replace(/\$\([^)]+\)\s*/g, "").trim();
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `LOLCC: ${pc.name} → ${cleanLabel}…`,
        cancellable: false,
      },
      () => this.apiClient.control(path, payload)
    );

    if (result.ok) {
      vscode.window.showInformationMessage(
        `✅ ${pc.name}: ${cleanLabel} tamam${result.message ? ` — ${result.message}` : ""}`
      );
    } else {
      vscode.window.showErrorMessage(
        `❌ ${pc.name}: ${cleanLabel} başarısız — ${result.error || "bilinmeyen hata"}`
      );
    }
  }

  /** Aksiyon için endpoint yolu — config override varsa onu kullan. */
  #endpointFor(action) {
    const overrides = this.configFn().get("controlEndpoints") || {};
    const custom = overrides[action.id];
    return typeof custom === "string" && custom.trim() ? custom.trim() : action.path;
  }
}

module.exports = { RemoteControl };
