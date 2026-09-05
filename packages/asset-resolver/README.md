# @akari-video/asset-resolver

無料素材の参照配布 + オンデマンド取得 resolver v0。

「このアカウントで使える素材（無料 + 購入済み）」をカタログ + entitlements + ローカル取得状態から
1 リストに合成し、**使った素材だけ**を `~/.akari/assets/<category>/<id>/` へ取得・検証して登録する。
「全部ダウンロード」を既定にしない、という設計契約（内部リポ
`planning/notes-2026-08-04-asset-reference-distribution.md`）の本体側実装。

外部 npm 依存ゼロ（Node.js 組み込みモジュールのみ）。`packages/audio-library-setup` の
`fetch-akari-sounds.mjs`（取得 → sha256 検証 → 登録の前例）を汎用化したもの。有料素材の zip 展開
だけはシステムの `unzip` CLI を spawn する（npm 依存は増えない — ストアリポ
`worker/tools/publish-paid.mjs` が入稿側で `zip` CLI を使うのと対称）。

## CLI

```sh
akari-assets list [--category <c>] [--json]          # 合成カタログ一覧（取得状態バッジ込み）
akari-assets fetch <id> [--project <dir>] [--force]   # 素材を解決してローカルへ登録
akari-assets sync                                      # カタログを取得してローカルにキャッシュ
akari-assets browse [--port <n>]                       # ローカル HTTP サーバでカタログを閲覧・投入
```

`list` の状態バッジ: `☁` 未取得 / `✓` 取得済み（ローカルにキャッシュ済み） / `¥<price>` 未購入 /
`[installed]` `akari store install` で導入済み。

`akari store install <productId> [--from <zip>]` が `PACK.json` を持つ購入パックを展開すると、
収載素材は `~/.akari/assets/installed.json` に登録される。resolver はこの索引をリモートカタログへ
マージし、同じ id があれば導入済みのローカル実体を優先する。`fetch` はネットワークや entitlement
照会を使わずパックからコピーし、`PACK.json` 記載の sha256 と照合してから通常の素材ライブラリへ
原子的に登録する。

`fetch` はキャッシュヒットなら即座にそのパスを返す。未取得なら、カタログの `files[]` を全部
一時ディレクトリへ実体化 → sha256 検証 → （`meta.json` を含む素材は）`validate-asset.mjs` で
契約検証 → 全部通ってから `~/.akari/assets/<category>/<id>/` へ原子的に登録する。
途中で失敗したら一時ディレクトリを破棄し、登録先には一切書き込まない（fail-closed。部分状態を
残さない）。有料で未購入（`price > 0` かつ entitlements に無い）は `fetch` を拒否する
（一度取得済みのキャッシュはそのまま使える — ゲートは「新規取得」だけにかかる）。

`--project` 指定時のライブラリ→プロジェクトへの配置は `fs.cp` に `COPYFILE_FICLONE` を渡しており、
対応 FS（APFS 等）では CoW クローンになる（見た目は完全なコピーのまま実消費ほぼゼロ。書き換えた
ブロックだけ実体化する）。非対応環境・別ボリュームでは自動的に通常コピーへフォールバックする
（失敗しない）。darwin では Node の libuv 経由だとクローンが効かない環境があるため、先に
BSD `cp -Rc`（`clonefile(2)` 直呼び）を試し、失敗時のみ上記 `fs.cp` フォールバックへ落ちる。

### 有料素材の取得経路（`price > 0` かつ `files[]` を持たない item）

有料の実体（fragment.html / meta.json / \*.glb 等）はカタログに一切載らない（`files[]` 無し —
実体は非公開 R2 のまま）。entitled 判定を通った場合だけ、`src/paid-zip.mjs` が
`GET /api/store/v1/download/<id>`（Bearer 認証。ストア設計契約 §6/§8）から zip を取得し:

1. zip を展開（システムの `unzip` CLI。外部 npm 依存を増やさないための唯一の非組み込み依存）
2. `checksums.txt`（`<sha256>␠␠<相対パス>` 形式。契約 §6 の zip 構成 `<product_id>-v<version>/`
   直下）で全ファイルの sha256 を検証
3. `README.md` / `LICENSE.md` / `checksums.txt` を除く素材ペイロードを一時ディレクトリへコピー
4. （`meta.json` を含む素材は）`validate-asset.mjs` で契約検証
5. 全部通ってから `~/.akari/assets/<category>/<id>/` へ原子的に登録

無料経路と同じ fail-closed の規律（1 件でも失敗したら一時ディレクトリを破棄し、登録先には
一切書き込まない）を踏襲する。ダウンロード失敗（オフライン・トークン失効）・zip 構成不正・
checksums 不一致は、いずれも `AssetResolverError`（`code: 'download_failed'` または
`'integrity'`）で拒否する。ストアの向き先は無料経路と同じ `AKARI_STORE_API` / `AKARI_HOME/store-credentials.json` を使う。

`browse` は `index.html` / `app.js`（内部リポ `lab/asset-oneview-proto/` の PoC を移植した
1 ビュー UI）を配信し、検索・カテゴリフィルタ・状態バッジ・詳細パネルから
「ライブラリへ取得する」「プロジェクトへ入れる」を直接叩ける（エージェント非経由 = resolver 直行）。

## カタログスキーマ（`akari-assets-catalog/v0`）

```jsonc
{
  "schema": "akari-assets-catalog/v0",
  "version": "2026-08-04",
  "base": "https://akari-oss.app/assets/",
  "items": [
    {
      "id": "br-typing-laptop",
      "category": "still",
      "title": "ノートPCをタイピングする手元",
      "tags": ["broll", "deskwork"],
      "license": { "spdx": "CC0-1.0" },
      "price": 0,
      "version": 1,
      "files": [
        { "name": "meta.json", "key": "still/br-typing-laptop/v1/meta.json", "sha256": "...", "bytes": 123 },
        { "name": "preview.png", "key": "still/br-typing-laptop/v1/preview.png", "sha256": "...", "bytes": 456 },
        { "name": "fragment.html", "key": "still/br-typing-laptop/v1/fragment.html", "sha256": "...", "bytes": 789 }
      ],
      "preview": "still/br-typing-laptop/v1/preview.png",
      "provenance": { "model": "gpt-image", "prompt": "...", "generated_at": "2026-08-04T00:00:00Z" }
    }
  ]
}
```

`files[]` の各エントリは `url`（絶対 URL）か `key`（`base` からの相対キー）のどちらか一方を持つ。
`base` は http(s) URL でもローカルディレクトリのパスでもよい（ローカルなら `key` はファイルコピーで
解決される）。`preview` も同じ規約（絶対 URL ならそのまま、そうでなければ `base` 相対）。

## 環境変数

| 変数 | 既定値 | 用途 |
| --- | --- | --- |
| `AKARI_HOME` | `~/.akari` | ライブラリ（`assets/`）・カタログキャッシュ・`store-credentials.json` の置き場 |
| `AKARI_ASSETS_CATALOG` | `https://akari-oss.app/assets/catalog.json` | カタログの取得元。**URL** ならリモート fetch、それ以外はローカルファイルパスとして読む（未デプロイの開発時は store リポのローカル出力を指す） |
| `AKARI_ASSETS_BASE` | カタログの `base` フィールド | 素材実体の配信ベースの上書き（ローカル開発でディレクトリを直接指すときに使う） |
| `AKARI_STORE_API` | `https://akari-oss.app` | entitlements API のホスト上書き。未設定時は `~/.akari/store-credentials.json` の `url`（`akari store connect` が書き込む値）から組み立てる |

`store-credentials.json` が無い場合、または entitlements API への到達に失敗した場合は
「entitlements 不明」として無料素材のみが使える状態にフォールバックする（黙って有料を通したり、
逆に全体を止めたりはしない）。

## オフライン運用

`AKARI_ASSETS_CATALOG` がリモート URL のとき、`loadCatalog` は取得成功のたびに
`~/.akari/catalog-cache.json` へ自動キャッシュする。オフライン時（fetch 失敗）はこのキャッシュへ
フォールバックする。キャッシュも無い場合は「取得できていない」ことを明示するエラーで止まる
（黙って空のカタログを返したりしない）。ただし `installed.json` に導入済み素材がある場合は、
キャッシュが無くてもその素材だけを `list` / `fetch` できる。`akari-assets sync` はオンライン環境で
明示的にキャッシュを温めておくためのコマンド。

## テスト

```sh
node --test
```

`test/fixtures/build-fixture-library.mjs` が、`validate-asset.mjs` を通る最小構成
（`meta.json` + `fragment.html` + 1x1 `preview.png`）のフィクスチャ素材（無料 1 件・有料 1 件）を
一時ディレクトリに生成する。実素材は使わない。

- `catalog-and-state.test.mjs`: カタログ読み + 状態合成（available / locked / cached）
- `resolve-success.test.mjs`: resolve 成功 → 2 回目はキャッシュヒット → `--project` 相当のコピー
- `resolve-integrity.test.mjs`: sha256 不一致 → fail-closed（登録されず、部分ファイルも残らない）
- `resolve-locked.test.mjs`: 未購入は拒否 / entitlements 保有時は解決できる（`files[]` を持つ有料 item の場合）
- `resolve-paid-zip.test.mjs`: `files[]` を持たない有料 item（実カタログの形）の zip 取得経路 —
  entitled 成功 / 未購入 locked / checksums 不一致 fail-closed / ダウンロード失敗 fail-closed
- `entitlements.test.mjs`: credentials 無し・fetch 失敗はどちらも無料のみへフォールバック
- `browse-server.test.mjs`: `/api/items` `/api/fetch` の実サーバ経由スモークテスト

## 依存パッケージとの関係

- `packages/schemas/bin/validate-asset.mjs` を子プロセスで呼ぶ（素材契約の検証はこちらに寄せる。
  本パッケージ側でスキーマを再実装しない）
- `packages/akari-launcher/src/store-command.mjs` の `akari store connect` が書く
  `~/.akari/store-credentials.json`（`{ url, token, email }`）をそのまま読む
  （依存追加を避けるため import はせず、同じファイル規約だけを踏襲）
