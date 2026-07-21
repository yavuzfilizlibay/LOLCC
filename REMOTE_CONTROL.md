# LOLCC — Uzaktan Kontrol (Remote Control)

`LOLCC: Uzaktan Kontrol` komutu, 3 PC'li local LLM stack'ini VS Code içinden
yönetmeni sağlar. Komut bir QuickPick akışı açar:

1. **PC seç** — canlı `GET /api/pcs` durumuyla (online/offline, AMD GPU °C)
2. **Aksiyon seç** — model yükle/değiştir, model boşalt, daemon restart, güç işlemleri
3. **Detay** — gerekirse model ID veya servis seç
4. **Onay** — yıkıcı işlemlerde (restart / reboot / shutdown) modal onay
5. **Çalıştır** — Control Center FastAPI'ye POST, sonuç bildirimi

Extension tarafı tamamen implement edilmiştir. Aksiyonlar aşağıdaki REST
sözleşmesini bekler; endpoint'leri Control Center (dashboard) tarafında
expose etmen gerekir.

## Ayarlar

| Key | Default | Açıklama |
|---|---|---|
| `lolcc.dashboardUrl` | `http://localhost:8090` | Control Center base URL |
| `lolcc.dashboardApiKey` | `""` | Opsiyonel `Authorization: Bearer <key>` header (boşsa gönderilmez) |
| `lolcc.powerActionsEnabled` | `false` | Güç işlemlerini (WoL/reboot/shutdown) menüde göster |
| `lolcc.controlEndpoints` | `{}` | Endpoint yolu override'ları (aşağıdaki tabloya bak) |

> **Not:** Güç işlemleri güvenlik için varsayılan **kapalı**. Açmak için
> `lolcc.powerActionsEnabled: true` yap.

## REST sözleşmesi

Tüm istekler `POST {dashboardUrl}{path}`, gövde JSON. Her gövdede en az
`pc` (PC adı) ve `ip` alanları gönderilir.

| Aksiyon | `controlEndpoints` anahtarı | Default path | Ek gövde alanı |
|---|---|---|---|
| Model Yükle/Değiştir | `model.load` | `POST /api/model/load` | `model` |
| Model Boşalt | `model.unload` | `POST /api/model/unload` | — |
| Daemon Restart | `daemon.restart` | `POST /api/daemon/restart` | `service` (`lm-studio` \| `llama-server` \| `litellm`) |
| Uyandır (WoL) | `power.wake` | `POST /api/power/wake` | — |
| Yeniden Başlat | `power.reboot` | `POST /api/power/reboot` | — |
| Kapat | `power.shutdown` | `POST /api/power/shutdown` | — |

### Örnek istekler

```http
POST /api/model/load
Content-Type: application/json

{ "pc": "Yavuz-Ryzen", "ip": "192.168.1.20", "model": "qwen3-coder-30b" }
```

```http
POST /api/daemon/restart

{ "pc": "HpServer", "ip": "192.168.1.30", "service": "llama-server" }
```

### Beklenen yanıt

Başarı — HTTP `200`:

```json
{ "ok": true, "message": "qwen3-coder-30b yüklendi (12.4s)" }
```

- `ok` alanı yoksa, `200` başarı sayılır.
- `message` opsiyonel; varsa bildirim toast'ında gösterilir.
- Düz metin `200` yanıtı da başarı sayılır (metin `message` olarak gösterilir).

Hata — HTTP `4xx`/`5xx` **veya** `200` + `{ "ok": false }`:

```json
{ "ok": false, "error": "AMD daemon crashed, HpServer'a fallback yok" }
```

`error` yoksa `message` ya da ham gövde/`HTTP <status>` gösterilir.

## Davranış notları

- **PC listesi:** `GET /api/pcs` erişilemezse akış "PC adını elle gir"
  seçeneği sunar (WoL gibi offline işlemler için).
- **Offline PC:** Sadece Wake-on-LAN (`power.wake`) offline makinede
  listelenir; diğer aksiyonlar PC online (veya elle girilmiş) olmalı.
- **Timeout:** Kontrol istekleri 15 sn timeout ile gider.
- **Auth:** `lolcc.dashboardApiKey` set edilmişse tüm dashboard isteklerine
  (`/api/pcs` dahil) `Authorization: Bearer` header'ı eklenir.
