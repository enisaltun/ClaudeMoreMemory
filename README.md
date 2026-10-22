# Hafıza

Kendi bilgisayarında çalışan, **kurulum gerektirmeyen** iki küçük hafıza aracı ve Claude Code bağlantısı. Obsidian ve Graphify'a yerel, ücretsiz bir alternatif.

| Araç | Ne yapar |
|---|---|
| **Notlar** | Markdown not defteri: `[[bağlantılar]]`, geri bağlantılar, `#etiketler`, hızlı arama, günlük not |
| **Graf** | Notlarından ve kod projelerinden bilgi grafı çıkarır: topluluklar, en merkezi düğümler, komşuluk, en kısa yol |
| **MCP** | Claude Code'un notlarını okuyup yazmasını ve grafı sorgulamasını sağlar |

Notların düz `.md` dosyalarıdır. Hiçbir yere gönderilmez, API anahtarı gerekmez, her şey `localhost`'ta çalışır.

## Kurulum

**Gereken:** [Node.js 24](https://nodejs.org) veya üstü.

```bash
git clone https://github.com/enisaltun/hafiza.git
cd hafiza
npm install
```

## Kullanım

| | Windows | Diğer sistemler | Adres |
|---|---|---|---|
| Notlar | `start-notes.bat` | `npm run notes` | http://localhost:4101 |
| Graf | `start-graph.bat` | `npm run graph` | http://localhost:4102 |

- **Notlar:** Sol tarafta not listesi, ortada yazma alanı, sağda bağlantılar. `Ctrl+P` ile ara. Notların `vault/` klasöründe saklanır.
- **Graf:** "Kod klasörleri" düğmesine taramak istediğin proje klasörlerini yaz, sonra "Yeniden tara". Bir düğüme tıklayınca komşuları açılır.

## Claude Code ile kullanma

Bir kez kaydet (`TAM\YOL` yerine klasörün yolunu yaz):

```bash
claude mcp add hafiza -- node "TAM\YOL\hafiza\mcp\server.js"
```

Sonra Claude'a şöyle isteklerde bulunabilirsin: *"notlarımda X hakkında ne yazdım?"*, *"bu karardan bir not oluştur"*, *"projenin en merkezi dosyaları hangileri?"*.

## Nasıl çalışır

```
vault/*.md ──┐
             ├─► SQLite dizini ─► Notlar (4101) · Graf (4102) · MCP (Claude Code)
kod klasörü ─┘    (arama, bağlantı, graf)
```

- `.md` dosyaları asıl kaynaktır. SQLite dizini yalnızca hızlandırıcıdır; silinirse yeniden kurulur.
- Tarama **artımlıdır**: yalnızca değişen dosyalar okunur. Arama milisaniyeler sürer.
- Büyük projelerde de hızlıdır: 20.000 not + 20.000 kod dosyasında arama ~40 ms, arayüzler her zaman sınırlı veri gösterir.
- Kod taraması JavaScript/TypeScript, Python ve Dart dosyalarını destekler.

## Ayarlar (isteğe bağlı)

| Ortam değişkeni | Anlamı |
|---|---|
| `HAFIZA_VAULT` | Notların başka bir klasörde durması için |
| `HAFIZA_OUT` | Graf çıktılarının yeri (varsayılan `graphify-out/`) |

## Test

```bash
npm test
```

## Lisans

© 2026 **Enis Altun**. Tüm hakları saklıdır. **Ücretsiz kullanılabilir**; satış, yeniden dağıtım ve yazılı izinsiz yayımlama yasaktır. Ayrıntı: [LICENSE](LICENSE).
