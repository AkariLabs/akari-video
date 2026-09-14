# 設計契約 — 拡張キット v0（技術契約）

## 1. 定義と構成

拡張キットは、公開されている AKARI Video の器へスキル・テンプレート・素材・説明書を追加するコンテキスト束である。既存の `akari store install <productId>` が次へ展開する。

```text
~/.akari/assets/store/<productId>/
├── manifest.json
├── skills/<skill-name>/SKILL.md
├── templates/<name>.json
├── assets/<category>/<id>/{meta.json, …}
├── docs/*.md
├── README.md
├── LICENSE.md
└── checksums.txt
```

`productId` は Store の商品 id、`version` は商品の整数版である。キット全体のライセンスは `LicenseRef-AKARI-Assets-v0` とし、各素材の `meta.json` も個別の `license` を持つ。

## 2. `manifest.json`

`schemaVersion: 1` の manifest は additive-only とする。例:

```json
{
  "schemaVersion": 1,
  "id": "world-kit",
  "kind": "kit",
  "name": "ワールドキット",
  "version": 1,
  "requires": {
    "cli": ">=0.1.70",
    "runtimes": ["world", "three"],
    "products": ["akari-pop-motion-set"]
  },
  "skills": [{ "dir": "skills/design-world", "name": "design-world" }],
  "templates": [{ "path": "templates/paper-to-browser.json", "for": "world-map", "label": "紙の地図 → ブラウザの中" }],
  "assets": [{ "category": "overlay", "id": "world-far-bands" }],
  "docs": [{ "path": "docs/world-hen.md", "label": "ワールド編（抜粋）" }],
  "license": "LicenseRef-AKARI-Assets-v0",
  "provenance": { "author": "AKARI Labs", "source": "example:world-kit" }
}
```

必須フィールドは `schemaVersion`、`id`、`kind`、`name`、`version`、`requires.cli`、`license`。`kind` は v0 では `kit` のみ。`validate-kit-manifest.mjs` はスキル実体、素材メタデータ、テンプレート用途語彙を含めて検査する。

## 3. 展開

`akari store install <productId>` は従来の entitlement 確認、zip 取得、checksum 照合、展開を終えたあと、`manifest.json` がある商品だけ次を行う。

1. manifest と `requires` を検査する。CLI または runtime の不足は fail-closed、依存商品の不足は警告と導入案内にする。
2. `assets[]` を `~/.akari/assets/<category>/<id>` へ相対 symlink で公開する。各素材はリンク前に `validate-asset.mjs` で検査する。
3. `skills[]` を `~/.akari/kits/plugin/skills/<name>` へ相対 symlink で公開する。
4. `~/.akari/kits/installed.json` に id、version、導入日時、展開先、スキル、素材を記録する。
5. `templates[]` は移動せず、CLI が各展開先の manifest を列挙して読む。

manifest が無い商品は従来の素材商品として扱う。検査器や runtime registry が npm 配布物に同梱されておらず照合できない場合は、その検査だけを警告付きでスキップする。`akari store uninstall <productId>` は台帳に記録した symlink と台帳エントリを外し、再導入用の展開ディレクトリは残す。

## 4. スキルの発見

Claude Code 向けには `~/.akari/kits` を directory marketplace として生成する。`plugin/skills/` は全キットの合成ディレクトリで、名前空間は純正の `akari:` と分離した `akari-kits:` になる。初回だけ次を実行する。

```sh
claude plugin marketplace add ~/.akari/kits
claude plugin install akari-kits@akari-kits
```

`claude` が PATH に無い場合は、Claude Code のプラグイン設定で `~/.akari/kits` を marketplace として追加する。SessionStart hook は導入済みキットがあり、`enabledPlugins` に `akari-kits@akari-kits` が無い場合だけこの案内を 1 行表示し、設定を変更しない。

Codex、Cursor、opencode では、プロジェクトの `.agents/.codex/.cursor/.opencode/skills` へキットスキルも合成する。同名があれば純正スキルを優先する。plugin が利用できない環境でも `~/.akari/kits/plugin/skills/<name>/SKILL.md` を直接読める。

## 5. アプリ（ホームの拡張キットカード）

ホームの AKARI Store カードの隣に拡張キットカードを 1 枚出し、未接続では出さず、導入済みは id・version・スキル名・素材数の一覧と未有効化時の有効化案内、購入済み・未導入は `akari store install <id>` の案内、未購入は教材の引換ページの案内、という 3 状態とする（アプリはコマンドを実行せず、コピーと外部ブラウザ起動だけを行う）。

## 6. 更新と版

キットの版は Store の整数版とする。`akari store status` が導入済みの id、version、スキル名、素材数を表示し、同じ `akari store install` で新版へ置換する。
