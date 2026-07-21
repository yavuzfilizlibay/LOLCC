# LOLCC - Local LLM Control Center Extension

Yavuz-Ryzen AMD + HpServer + Yavuz-Arn-Home GPU compute için Türkçe AI assistant.

## Özellikler

- 💬 **Chat Panel** (sidebar) — streaming response, kod blokları, reasoning gösterimi
- ⚡ **Inline Completion** (Tab autocomplete) — FIM (Fill-in-the-Middle) Qwen3.5-4B üzerinden
- 📊 **Status Bar** — 3 PC online durumu + AMD GPU °C, tıklayınca detay
- 🎮 **Uzaktan Kontrol** — VS Code içinden PC seç → model yükle/değiştir, daemon restart, güç işlemleri (bkz. [REMOTE_CONTROL.md](REMOTE_CONTROL.md))
- 🎯 **Context menu**: seçili kodu açıkla / refactor et
- 🛡 **AMD daemon fragile değil**: LiteLLM proxy üzerinden fallback chain (HpServer CPU otomatik)
- 🇹🇷 Türkçe UI ve sistem prompt

## Konfigürasyon

VS Code Settings → "lolcc" ara:

| Key | Default | Açıklama |
|---|---|---|
| `lolcc.apiBase` | `http://localhost:4000/v1` | LiteLLM proxy URL |
| `lolcc.apiKey` | `sk-lolcc-proxy-2026` | LiteLLM master key |
| `lolcc.chatModel` | `qwen3-coder-30b` | Chat model ID |
| `lolcc.autocompleteModel` | `qwen3.5-4b-balanced` | FIM model ID |
| `lolcc.systemPrompt` | (hafif Türkçe) | ~100 token, AMD crash önler |
| `lolcc.maxTokens` | 2000 | Reasoning + content için yeter |
| `lolcc.dashboardUrl` | `http://localhost:8090` | Control Center URL |
| `lolcc.dashboardApiKey` | `` (boş) | Control Center opsiyonel Bearer key |
| `lolcc.powerActionsEnabled` | `false` | Uzaktan kontrolde güç işlemleri (WoL/reboot/shutdown) |
| `lolcc.controlEndpoints` | `{}` | Uzaktan kontrol endpoint override'ları |

## Komutlar

- `LOLCC: Chat Paneli Aç`
- `LOLCC: Seçili Kodu Açıkla` (Editor right-click)
- `LOLCC: Refactor Öner` (Editor right-click)
- `LOLCC: PC Sağlık Kontrolü` (status bar tıkla)
- `LOLCC: Uzaktan Kontrol` (PC seç → model/daemon/güç aksiyonu)

## Kullanım

1. Activity bar'da **LOLCC** ikonuna tıkla → chat panel
2. Tab tuşu → inline autocomplete
3. Sağ alt köşede status bar → tıkla, 3 PC sağlığı

## Gereksinimler

- VS Code 1.85+
- LOLCC stack çalışıyor olmalı (LiteLLM 4000, Dashboard 8090)
- LM Studio AMD ve/veya HpServer llama-server endpoint'leri up
