# LOLCC Stack - Known Issues

Bu döküman bilinen sorunları, sebepleri ve workaround'ları listeler. GitHub issue'larıyla cross-link.

## 🔴 Critical

### #1 — AMD LM Studio daemon model load fail pattern
- **Symptom**: `lms load --context-length N` → `Error: Some model operation failed (Exit code: 0)`. Zombi process 5-12 GB RAM tutar
- **Triggers**: Çoklu yükleme denemesi, Cline gibi heavy-prompt agent client'lar, idle-unload sonrası reload
- **Affected**: Yavuz-Ryzen (AMD RX 7900 XTX, Vulkan runtime)
- **Workaround**: Hard reset → `Get-Process 'LM Studio','lms','lms-host' | Stop-Process -Force`, lock dosyaları sil (`%USERPROFILE%\.lmstudio\.internal\llmster-pid.lock`), LM Studio UI manuel reload
- **Permanent fix**: LiteLLM proxy fallback chain (HpServer Qwen4b'ye düşme — şu an freeze sırasında çıkarıldı)

### #2 — Cline / agent client `n_keep >= n_ctx` overflow
- **Symptom**: `litellm.APIConnectionError: OpenAIException - The number of tokens to keep from the initial prompt is greater than the context length (n_keep: 12251 >= n_ctx: 4096)`
- **Root cause**: Cline sistem prompt'u ~12-13k token. LM Studio'da auto-load varsayılan 4-8k context kullanır
- **Workarounds**:
  1. Modeli **16k+ context** ile manuel yükle (`lms load --context-length 16384`)
  2. Cline Settings → **Compact Prompt ON** (12k → 4-5k token)
  3. LOLCC extension için: hafif sistem prompt (~80 token)
- **Affected**: Cline, LOLCC-Agent (fork), bizim LOLCC-Extension benzer pattern

## 🟡 High

### #3 — LiteLLM cp1252 UnicodeEncodeError
- **Symptom**: LiteLLM start sırasında `UnicodeEncodeError: 'charmap' codec can't encode characters ... ApplicationStartupFailed`
- **Root cause**: LiteLLM banner Unicode block characters içerir, Windows console default cp1252
- **Fix**: `start-litellm.bat` wrapper'da `PYTHONIOENCODING=utf-8` + `PYTHONUTF8=1` + `chcp 65001` SART
- **Status**: Resolved via `D:\Dashboard-Stack\start-litellm.bat`

### #4 — Open WebUI duplicate OpenAI connections aggregate fail
- **Symptom**: HpServer / AMD modeller dropdown'da görünmez. `/api/models` boş döner
- **Root cause**: Open WebUI Admin → Connections → 2 OpenAI placeholder (api.openai.com, geçersiz key). 500 dönen connection aggregate query'yi bozuyor → tüm dropdown silent fail
- **Fix**: Geçersiz/duplicate connection'ları DB direct write ile sil (`fix_openai_connections.py`)
- **Affected**: Open WebUI 0.9.5

### #5 — HpServer Qwen3.5-4B response.content boş, reasoning_content dolu
- **Symptom**: LiteLLM via HpServer 8081 → `content=""`, `reasoning_content` 1500+ char (think mode)
- **Root cause**: Qwen3 default chat template `<think>` mode aktif, llama.cpp `--reasoning-format` flag yok current build'de
- **Workaround**: `max_tokens` ≥ 1500 (reasoning + final için) veya client tarafında reasoning_content'i göster
- **Pending**: llama-server `--chat-template` ile think mode disable veya newer build

## 🟢 Medium

### #6 — PS Remoting AAD user LM Studio daemon restart imkansız
- **Symptom**: lanadmin PS Remoting'den AAD user'ın LM Studio'sunu restart denenince `lms server start` "Waking up..." takılır, `schtasks /RU "AzureAD\..."` LastTaskResult=1
- **Root cause**: AAD username parantezli SID resolve fail (`YavuzFilizlibay(Data`), Win32_Process.Create SYSTEM context'inde çalışır farklı user
- **Workaround**: AAD user `Startup folder shortcut` (UI login'inde otomatik), manuel LM Studio UI tıklama
- **Affected**: Arn-Home (Nvidia, AAD account)

### #7 — LOLCC-Extension v0.2.1 agent mode silent fail
- **Symptom**: Chat panel'de "merhaba" gönder → hiçbir cevap gelmiyor, error yok, debug log yok
- **Root cause**: Undetermined. Olası nedenler: WebView postMessage queue, apiClient.chatStream fetch SSE parse, Node 22 SSE handling
- **Workaround**: LOLCC-Agent (Cline fork) kullan
- **Status**: Open — Output channel logging gerekli debug için

### #8 — SMB Z:\ cold-load 30 saniye
- **Symptom**: AMD/Nvidia LM Studio ilk model load 30-40 saniye (sonraki yükleme cache'den hızlı)
- **Root cause**: Gigabit ethernet ~125 MB/s teorik, 2.5-17 GB GGUF dosyası
- **Workaround**: Modelleri **preload** (warm), idle-unload kapalı tut
- **Mimari karar**: Kullanıcı local kopya yapmak istemiyor (HpServer storage tek-master)

### #9 — windows_exporter slow probe response (5 MB body)
- **Symptom**: `/api/pcs` Yavuz-Ryzen `online: false` döner → HTTP probe 1.5-3 saniye timeout aşılır
- **Root cause**: 635 GPU metric satırı + diğerleri = ~5 MB response body
- **Fix**: TCP socket probe (`asyncio.open_connection`) HTTP yerine + `127.0.0.1` hairpin NAT fallback. `main.py:_probe_online`
- **Status**: Resolved

### #10 — LM Studio CUDA runtime auto-install yok
- **Symptom**: Arn-Home Nvidia'da fresh LM Studio kurulumunda `"No LM Runtime found for model format 'gguf'!"`
- **Root cause**: LM Studio Vulkan default geliyor (AMD), CUDA Llama.cpp explicit install gerek
- **Fix**: LM Studio UI → Discover/Runtimes → CUDA llama.cpp install (~200 MB)
- **Status**: Resolved 2026-05-26

---

## Linkler

- [Project README](./README.md)
- [LOLCC repo](https://github.com/yavuzfilizlibay/LOLCC)
- [LOLCC-Agent repo](https://github.com/yavuzfilizlibay/LOLCC-Agent) (Cline fork)
- GitHub Issues — bu sorunların tracked versionu
