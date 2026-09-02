# contract — 素材の参照モデル v0（共有ライブラリ参照の台帳と解決規則）

- 状態: 実装済み（機械層のみ。シェル UI の採用は後続）
- 決定日: 2026-09-02
- 実装: `packages/asset-resolver`（記帳・実体化）/ `packages/render-cut`・`packages/edit-lint`（解決）

## 1. 目的

カタログ素材をプロジェクトごとに実体コピーすると、同じ素材が何度もダウンロード・複製されて
プロジェクトが肥大する。実体は**マシン単位の共有ライブラリ**（`~/.akari/assets/<category>/<id>/`）に
1 部だけ置き、プロジェクトには**参照だけを記録**できるようにする。

## 2. 設計の要点

- **edit.json は変えない**。参照素材も従来どおり `assets/<category>/<id>/<file>` の
  プロジェクト相対パスで宣言される。実体がプロジェクトに無いことは参照台帳が説明する。
- 参照台帳 = プロジェクトの `.akari/asset-references.json`:

  ```json
  { "version": 0, "references": [ { "id": "<素材 id>", "category": "<カテゴリ>" } ] }
  ```

  references は category → id の安定ソート・重複なし。読み手は寛容（無い / 壊れは空扱い）、
  書き込みは tmp + rename の原子的更新。`version` は台帳自身のスキーマ版数であり
  edit.json の version とは無関係。
- **解決規則**: 宣言されたプロジェクト相対パスが `assets/<category>/<id>/<rest>` の形で、
  (1) プロジェクト実体が存在せず、(2) 台帳に `{category, id}` があるとき、
  `<AKARI_HOME>/assets/<category>/<id>/<rest>`（AKARI_HOME 既定 `~/.akari`・env で上書き可）へ
  フォールバックする。解決先は realpath 後も `<AKARI_HOME>/assets` 配下に収まる正規ファイルで
  あること（`..` 等の脱出は fail-closed で拒否）。
- render-cut は解決した入力を render inputs 記録に `scope: "library"` として残す
  （既存 `scope: "akari"` と同列の additive 記録）。edit-lint は解決できる参照を欠落と報告せず、
  台帳にあるが実体が無い参照は「共有ライブラリ参照（未取得）」として欠落報告する。
- render-cut / edit-lint は依存ゼロ CLI のため、解決ロジックは各パッケージ内に**同一実装を重複**して
  持つ（`src/library-reference.mjs`）。挙動同一性は両テストの同一ケース表で担保する。

## 3. 使い方（CLI）

```sh
# 参照モードで取得（コピーせず台帳へ記帳。既定は従来どおりコピー）
akari-assets fetch <id> --project <dir> --reference

# 「素材をまとめる」— 参照の実体化（持ち出し・アーカイブ用）
akari-assets bundle --project <dir> [--dry-run]
```

bundle は台帳の各参照をキャッシュから `assets/<category>/<id>/` へ実体化して台帳から除去する。
未取得の参照は resolve（取得）を試み、取得できないものは台帳に残して部分成功（exit 非 0）で報告する。冪等。

## 4. スコープ外（後続）

- シェル UI の採用（取り込みフローの reference 既定化・プロジェクト面の「参照」バッジ・
  プレビュー経路のフォールバック）
- 共有キャッシュの容量管理 UI

出自: 2026-09-02 の素材パネル再設計ラウンドの裁定 3（実体 = 共有キャッシュ・プロジェクトには参照・
持ち出しは「素材をまとめる」で閉じる）。
