# Hafıza Uygulamaları

Obsidian benzeri **Notlar** + Graphify benzeri **Graf** uygulaması. Node 24, düz ESM, derleme yok. API anahtarı yok (Claude, abonelikle Claude Code üzerinden MCP ile bağlanır).

## Çalıştırma
- `start-notes.bat` → http://localhost:4101 (not defteri; `vault/` klasörü)
- `start-graph.bat` → http://localhost:4102 (bilgi grafı; "Kod klasörleri" düğmesinden taranacak klasörleri ekle; "Yeniden tara" artımlı, Shift+tıkla = tam tarama)
- `npm test` → birim testleri (node:test) · `npm run bench -- 20000 20000` → ölçek benchmark'ı
- Ortam: `HAFIZA_VAULT` (vault yolu), `HAFIZA_OUT` (graf çıktısı, varsayılan `graphify-out/`), `HAFIZA_LOUVAIN_CAP` (varsayılan 100000)

## Mimari (ölçeklenebilir tasarım — projenin boyutu davranışı değiştirmemeli)
- **Dosyalar gerçek kaynak, SQLite türetilmiş önbellek.** `vault/.hafiza/index.db` (notlar, link, etiket, FTS5) ve `graphify-out/graph.db` (düğüm/kenar, trigram FTS). Silinirse yeniden kurulur. WAL: sunucu, MCP ve işçi iş parçacıkları aynı dosyayı paylaşır.
- **Hiçbir sorgu tüm dosyaları/grafı taramaz.** Arama FTS5, backlink/komşu/derece indeksli, yol çift yönlü BFS, klasör ağacı tembel+sayfalı, graf arayüzü yalnızca en merkezi N düğümü çizer ve tıklayınca komşuları sunucudan çeker.
- **Artımlı.** `NoteIndex.sync()` yalnızca mtime/boyutu değişen notları işler. Kod taraması yalnızca değişen dosyaları okur; ham import'lar saklanır, dosya kümesi değişince dosya okumadan yeniden çözülür. Hiçbir şey değişmediyse derece/arama/topluluk/rapor atlanır.
- **Taramalar işçi iş parçacığında** (`graph-app/scan-worker.js`, `notes-app/sync-worker.js`): büyük işlerde arayüz donmaz.
- Topluluk: ≤100k düğümde Louvain; üstünde klasör bazlı yedek kümeleme.
- Ölçüm (20k not + 20k kod dosyası, 80k düğüm/140k kenar): FTS arama 12–40 ms, backlink 0,7 ms, graf araması 1 ms, 1500 düğümlü alt graf ~30 ms, yol 1 ms; ilk dizinleme ~13 sn, değişiklik yokken tarama ~0,8 sn, 1 dosya değişince ~3,5 sn.

## Yapı
- `core/`: `db.js` (SQLite), `parse.js`, `vault.js`, `noteindex.js`, `graph.js` (GraphStore), `http.js`
- `notes-app/`, `graph-app/` (`build.js` tarama, `extract/` markdown + kod çıkarıcılar), `mcp/server.js`, `test/`, `bench/`

## MCP kaydı (bir kez)
```
claude mcp add hafiza -- node "<PROJE_YOLU>\mcp\server.js"
```
Araçlar (hepsi limit/offset'li): search_notes, list_notes, read_note, write_note, append_note, notes_by_tag, graph_rescan, graph_report, graph_query, graph_neighbors, graph_path, graph_communities.

## Notlar / sınırlamalar
- MCP sunucusunda stdout'a console.log yazma (protokol kanalı).
- `node:sqlite` Node'da "experimental"; uyarı `core/db.js` içinde bastırılır. API'si değişirse yalnızca `core/db.js` ve iki dizin sınıfı etkilenir.
- Kod çıkarıcı regex tabanlı (JS/TS, Python, Dart). 'uses' kenarı, değişmeyen dosyanın yeni eklenen bir sembole bağlantısını ancak tam taramada görür.
- Vault'u bulut senkronuna koyarsan `.hafiza/` klasörünü hariç tut (türetilmiş veri).
- Editör sade `<textarea>`.
