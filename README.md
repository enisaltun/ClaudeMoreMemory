# Hafıza

Kendi bilgisayarında çalışan iki küçük araç ve Claude Code için bir MCP sunucusu:

- **Notlar** — Obsidian benzeri Markdown not defteri: `[[wikilink]]`, geri bağlantılar, `#etiket`, tam metin arama, canlı güncelleme.
- **Graf** — Graphify benzeri bilgi grafı: notlarından ve kod klasörlerinden (JS/TS, Python, Dart) düğüm/kenar çıkarır; topluluklar, en merkezi düğümler, komşuluk ve en kısa yol.
- **MCP sunucusu** — Claude Code, notlarını arayıp okuyabilir/yazabilir ve grafı sorgulayabilir. API anahtarı gerekmez.

Notların düz `.md` dosyalarıdır; hiçbir yere gönderilmez. Her şey yerelde (`127.0.0.1`) çalışır.

## Gereksinimler
- **Node.js 24** (yerleşik SQLite için)

## Kurulum
```bash
git clone https://github.com/enisaltun/hafiza.git
cd hafiza
npm install
```

## Kullanım
| Araç | Başlat | Adres |
|---|---|---|
| Notlar | `start-notes.bat` (veya `npm run notes`) | http://localhost:4101 |
| Graf | `start-graph.bat` (veya `npm run graph`) | http://localhost:4102 |

- Notların `vault/` klasöründe durur (başka bir yer için `HAFIZA_VAULT` ortam değişkeni).
- Graf'ta "Kod klasörleri" düğmesinden taranacak proje klasörlerini ekle, sonra "Yeniden tara".

## Claude Code'a bağlama (bir kez)
```bash
claude mcp add hafiza -- node "TAM\YOL\hafiza\mcp\server.js"
```

## Büyük projelerde
Dizinler SQLite'ta tutulur, tarama artımlıdır ve arayüzler her zaman sınırlı veri gösterir; vault ve proje büyüklüğü hızı belirgin etkilemez (20.000 not + 20.000 kod dosyasında arama milisaniyeler sürer). Ayrıntılar için `CLAUDE.md`'ye bak. Ölçmek için: `npm run bench -- 20000 20000`.

## Test
```bash
npm test
```

## Lisans
Telif hakkı © 2026 **Enis Altun**. Tüm hakları saklıdır. Ücretsiz kullanılabilir; yeniden dağıtım, satış ve yazılı izinsiz yayımlama yasaktır. Ayrıntı: [LICENSE](LICENSE).
