# @akari-video/asset-resolver

ライブラリの置き場は既定で作業場の `library/`。作業場が無いときは従来の `~/.akari/assets/` を使う。
`akari-assets list`（または `akari assets list`）の先頭行で実際の置き場を確認する。
以下の `<ライブラリの置き場>` はその表示先を指し、音源はその下の `audio/` に入る。

無料素材の参照配布 + オンデマンド取得 resolver v0。

「このアカウントで使える素材（無料 + 購入済み）」をカタログ + entitlements + ローカル取得状態から
1 リストに合成し、**使った素材だけ**を `<ライブラリの置き場>/<category>/<id>/` へ取得・検証して登録する。
「全部ダウンロード」を既定にしない、という設計契約（内部リポ
`planning/notes-2026-08-04-asset-reference-distribution.md`）の本体側実装。

外部 npm 依存ゼロ（Node.js 組み込みモジュールのみ）。`packages/audio-library-setup` の
`fetch-akari-sounds.mjs`（取得 → sha256 検証 → 登録の前例）を汎用化したもの。有料素材の zip 展開
だけはシステムの `unzip` CLI を spawn する（npm 依存は増えない — ストアリポ
`worker/tools/publish-paid.mjs` が入稿側で `zip` CLI を使うのと対称）。

## CLI

```sh
akari-assets list [--category <c>] [--source <lab|site|own>] [--json]          # 合成カタログ一覧（取得状態バッジ込み）
akari-assets add <path...> --plan [--json]            # ファイル・フォルダの取り込み計画
akari-assets add --apply <plan.json> [--json]         # 確認済み計画を複製して登録
akari-assets fetch <id> [--project <dir>] [--force]   # 素材を解決してローカルへ登録
akari-assets migrate [--dry-run]                      # 旧置き場を再移行（dry-run は変更しない）
akari-assets sync                                      # カタログを取得してローカルにキャッシュ
akari-assets browse [--port <n>]                       # ローカル HTTP サーバでカタログを閲覧・投入
```

`list` の状態バッジ: `☁` 未取得 / `✓` 取得済み（ローカルにキャッシュ済み） / `¥<price>` 未購入 /
`[installed]` `akari store install` で導入済み。

`akari store install <productId> [--from <zip>]` が `PACK.json` を持つ購入パックを展開すると、
収載素材は `<ライブラリの置き場>/installed.json` に登録される。resolver はこの索引をリモートカタログへ
マージし、同じ id があれば導入済みのローカル実体を優先する。`fetch` はネットワークや entitlement
照会を使わずパックからコピーし、`PACK.json` 記載の sha256 と照合してから通常の素材ライブラリへ
原子的に登録する。

`fetch` はキャッシュヒットなら即座にそのパスを返す。未取得なら、カタログの `files[]` を全部
一時ディレクトリへ実体化 → sha256 検証 → （`meta.json` を含む素材は）`validate-asset.mjs` で
契約検証 → 全部通ってから `<ライブラリの置き場>/<category>/<id>/` へ原子的に登録する。
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
5. 全部通ってから `<ライブラリの置き場>/<category>/<id>/` へ原子的に登録

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
| `AKARI_HOME` | `~/.akari` | マシン状態（library-location.json・カタログキャッシュ・store-credentials.json）。作業場なしでは旧 assets/ もここに置く |
| `AKARI_LIBRARY_ROOT` | 未設定 | ライブラリの書き込み先の明示上書き（読みは旧置き場にもフォールバック） |
| `AKARI_ASSETS_CATALOG` | `https://akari-oss.app/assets/catalog.json` | カタログの取得元。**URL** ならリモート fetch、それ以外はローカルファイルパスとして読む（未デプロイの開発時は store リポのローカル出力を指す） |
| `AKARI_ASSETS_BASE` | カタログの `base` フィールド | 素材実体の配信ベースの上書き（ローカル開発でディレクトリを直接指すときに使う） |
| `AKARI_STORE_API` | `https://akari-oss.app` | entitlements API のホスト上書き。未設定時は `~/.akari/store-credentials.json` の `url`（`akari store connect` が書き込む値）から組み立てる |

`store-credentials.json` が無い場合、または entitlements API への到達に失敗した場合は
「entitlements 不明」として無料素材のみが使える状態にフォールバックする（黙って有料を通したり、
逆に全体を止めたりはしない）。

## オフライン運用

`AKARI_ASSETS_CATALOG` がリモート URL のとき、`loadCatalog` は取得成功のたびに
`~/.akari/catalog-cache.json` へ自動キャッシュする。オフライン時（fetch 失敗）はこのキャッシュへ
フォールバックする。キャッシュも無い場合、`list` は警告を stderr に出し、置き場の素材と `installed.json` の導入済み素材を返す。
`AKARI_ASSETS_CATALOG` に指定したローカルファイルが読めない場合も同様。
`fetch` / `sync` の取得エラーの扱いは従来どおり。`akari-assets sync` はオンライン環境で
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

## ライブラリの解決と移行

`resolveAssetLibraryRoots(env, { platform })` の正本は `packages/creator-root/src/index.mjs`。
書き込みは `AKARI_LIBRARY_ROOT` → `<AKARI_HOME>/library-location.json` → 従来の `assets/` の順で 1 か所に決まる。
location が有効なのは migrating / done のときだけ。pending / declined では旧置き場への読み書きを維持し、同期フォルダへは書き込まない。
明示の AKARI_LIBRARY_ROOT は最優先。読み取りは有効な置き場と従来の置き場を重複なく見る（新しい方を優先）。cwd の上方探索はしない。
`list --json` は互換性のため従来どおり素材配列のみを返す。置き場表示は通常の `list` の先頭行。

シェルと launcher の起動時に共通の移行実装を呼ぶ。`library-location.json` は version 0、
root（絶対パス）、state（pending / migrating / done / declined）、decidedAt、migratedAt、notifiedAt を持ち、
一時ファイル + rename で原子的に更新する。不在・壊れは従来の置き場へフォールバックする。
移行先を初めて決めるときだけ `AKARI_CREATOR_ROOT` とマシンポインタの `lastRoot` を使う。

同一ディスクは rename、EXDEV は複製・サイズと sha256 照合・旧側削除。同名素材は上書きせず旧側に残し、
結果の skipped に記録する。カテゴリの中の新規素材は再移行できる。付随ファイルとキットの参照も追随する。
途中失敗は migrating のまま再開可能。done 後に旧 CLI が追加した素材は `akari-assets migrate` で寄せる。
作業場なしは何もしない。OneDrive / Dropbox / iCloud Drive / Google Drive 配下は pending に留め、
結果に同期先と総容量を返す。ドロップフォルダと reviews はマシン状態として元の場所に残す。


## カタログ外の素材と出どころ

`list --json` は素材配列を返す。リモートカタログにない `<category>/<id>` も含め、
新しい置き場を優先し、従来の置き場も読む。カタログ側に同じ key がある場合は 1 件にまとめる。
ローカルの表示情報は meta.json、`files: [{name, bytes}]` は実ディレクトリから得る。
壊れた meta.json も id を title にした item として残し、`warnings[]` に理由を付ける。

追加フィールド:

| フィールド | 意味 |
| --- | --- |
| `sourceKind` | カタログ収載・ストア導入は `lab`。それ以外は `origin:site` / `origin:own`、既存の `source.url`（site）、既定 own の順 |
| `tags` / `machineTags` | 人向けタグ / `origin:*`・`site:*`・`folder:*`・`pack:*`・`license:subscription` |
| `folder` / `site` / `subscription` | 機械用タグの値（無ければ null / null / false） |
| `creditText` | CREDIT.txt の先頭 1 行。無ければ null |
| `libraryDir` / `addedAt` | ローカル素材の絶対パス / ディレクトリ birthtime（無効なら mtime）の ISO 時刻 |
| `preview` / `mediaFile` | ローカル素材では `preview.png` / 直下で一意な主メディアのファイル名。無ければ null |

主メディアはシェルと同じ一意解決の規則で、複数テイクから勝手に選ばない。
still の `preview.png` は主メディア候補から除く。音・映像・画像に加え、取り込み対象の
AIFF・SVG・フォント・glTF も判定する（シェルでの配置可否とは別）。
`composeState()` は一覧に加え取得エラー等の `warnings[]` を返す。

## ローカル取り込みの JSON 契約

```sh
akari-assets add /path/to/track.wav /path/to/folder --plan --json > plan.json
# plan.json の items[].kind / selected と任意の credit / pack を編集
akari-assets add --apply plan.json --json
```

plan は置き場に書き込まない。隠しファイル・Thumbs.db・シンボリックリンクを除いて再帰し、
5,000 ファイルで打ち切った場合は `truncated: true` と `warnings[]` を返す。

```jsonc
{
  "schema": "akari-assets-add-plan/v0",
  "items": [{
    "path": "/absolute/path/track.wav", "name": "track.wav", "bytes": 2000000,
    "category": "audio", "kind": "sfx", "durationSec": 14,
    "durationSource": "ffprobe", "ambiguous": true, "proposedId": "track",
    "mtimeMs": 1790000000000, "folder": "Tracks"
  }],
  "duplicates": [], "rejected": [], "truncated": false, "limit": 5000, "warnings": []
}
```

- 音: 10 秒未満 = `kind: "sfx"`、30 秒以上 = `"bgm"`、間は `ambiguous: true` + 既定 `"sfx"`。
  利用者の選択は `items[].kind` を `"bgm"` に変えて反映する。`ambiguous` は判定時の情報として残せる。
- ffprobe 不在だけはサイズで推定する（1,200,000 bytes 未満 = sfx、4,000,000 bytes 超 = bgm、間は ambiguous）。
  `durationSec: null` / `durationSource: "size"`。ffprobe が動いてエラーを返した音は rejected。
- 画像 = still、映像 = broll、フォント = font、GLB/glTF = scene3d。これらの kind は category と同じ、
  durationSec / durationSource は null。cube は presets 管轄のため rejected。0 バイト・対応外形式も理由つきで rejected。
- `duplicates[]` は元ファイル情報 + `status: "duplicate"` + 既存の `category` / `id` / `libraryDir`。
  同じバイト数の既存ペイロードがある場合だけ、取り込み元とその候補の sha256 を計算・比較する。
  候補がなければ先頭 512 bytes の読み取り確認のみ行い、hash は計算しない。計算した場合だけ `sha256` を plan に含める。`rejected[]` は元ファイル情報 + `reason`。
- `folder` は渡されたフォルダ名。単独ファイルには付けない。`selected: false` の item は apply で除外する。
- `credit` は plan 全体または item に指定でき、改行を空白にして CREDIT.txt へ保存する。
- `pack: {id, title}` は plan 全体で任意指定。全追加素材に pack タグを付け、ライブラリ直下の
  `packs.json` に `akari-catalog-packs/v0` の行を追加する。混在セットの category は最初に登録した素材のもの。
- サイト取り込みは plan または item に `origin: "site"`, `site`, `sourceUrl`, `licenseAtSource`,
  `subscription` を指定する。source の acquisition は subscription=true なら login、ほかは direct。
  `sourceUrl` と `licenseAtSource` は必須。既定の own には source を作らない。

apply の結果は `{added: [{category,id,libraryDir,warnings?}], duplicates, rejected, failures}`。
failures は `{path?, reason}`。1 件でも失敗した CLI は exit 1 と結果 JSON を返すが、残りの素材は続ける。
id は proposedId を使い、衝突時だけ `-2` 以降を足す。元ファイルのサイズ・mtime を再確認し（plan に sha256 があればそれも照合）、
apply 時に計算した hash と複製後の hash を比較して、
同じディスクの一時ディレクトリへ CoW 複製 → 検証 → rename する。コピー元は消さない。
失敗した素材の一時ファイルと配置済みファイルは削除する。並行 apply は `.add-lock` で排他し、
実行中なら failures を返す（強制終了で残った lock は、実行がないことを確認して除去する）。

### プレビュー・表示用ファイルと厳密な検証

apply は全カテゴリで `preview.png` を置く。音は register-drop-folder と同じ関数で波形を生成し、
映像は ffmpeg で先頭フレームをサムネイルにする。ffmpeg 不在・実行失敗時は、Node 組み込みの
zlib で作る決定的なプレースホルダ PNG に置き換え、`added[].warnings` にその旨を返す。
PNG の still は元画像を複製して preview にする。font / scene3d / PNG 以外の still もプレースホルダを使う。

still には実体画像を相対参照する最小の `fragment.html`、scene3d には canvas と
`data-akari-3d-scene` の model 宣言を持つ最小の `fragment.html` を生成する。
生成した素材を既存 `validate-asset.mjs` に渡し、exit 0 の場合だけ登録する。
非 0 の診断を警告として許容する例外は設けず、`failures[]` に記録して素材を残さない。

### apply が作る meta.json の既定値

| 必須項目 | 既定値 |
| --- | --- |
| id | ファイル名由来の proposedId（非 ASCII は短いハッシュ、衝突時は接尾辞） |
| category | 拡張子で決めた audio / still / broll / font / scene3d |
| title | 元ファイル名（拡張子を除く。例: mid.wav → mid） |
| description | 利用者がローカルから取り込んだ素材 |
| when_to_use | 利用者のプロジェクトでこの素材を使うとき |
| tags | origin:own。必要時に folder:* / sfx / pack:*。site 由来は origin:site / site:* / license:subscription |
| knobs | [] |
| ai_usage | 利用者の利用条件の範囲で使用する。再配布・AI 学習には使用しない。 |
| requires | [] |
| provenance | {origin: "利用者がローカルから取り込み", generator: null} |
| author | user |
| license | {spdx: "LicenseRef-user-owned", scope: "private-owned", attribution_required: false, ai_training_allowed: false}（credit 指定時だけ attribution_required=true） |
| price | 0 |

`planAdd` の `probe(path, {env})` 注入口は秒数か null（不在）を返し、壊れた音なら throw する。
追加テストはこの注入口を使うため、ffprobe / ffmpeg は不要。

`planAdd` の `hashFile(path)` 注入口は、同サイズ候補がない場合に呼ばれないことを検証するために使える。
