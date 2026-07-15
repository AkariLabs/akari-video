# 取得・配置・検証・INDEX 更新

[starter-pack.md](starter-pack.md) で明示承認を得た catalog エントリだけを対象にする。承認されていない id を一緒に取得しない。

## 1. 取得する（acquisition ごとに分岐）

### acquisition: direct

エージェントが `curl` 等で取得してよい。

```sh
curl -fsSL "<source.url または直接ファイル URL>" -o "<作業ディレクトリ>/<file>"
```

- 取得直後にファイル種別・サイズを確認する（`file`, `ls -la`）。想定外の HTML エラーページ等を実体と誤認しない。
- `source.license_at_source` を出発点にしつつ、取得元ページで実際に確認できる範囲のライセンス表記と突き合わせる。矛盾したら取得を止めて報告する。

### acquisition: login / purchase

エージェントは取得しない。次をユーザーへ提示する。

- `source.url`（取得先ページ）
- 必要な手続き（会員登録・購入）の概要（catalog 側に書かれている範囲で。無い情報を推測で補わない）
- 「取得したら、どこに置きましたか？」を聞き、ユーザーが答えたローカルパスを次工程の入力にする

## 2. 選ばれたスコープの assets/<category>/<id>/ へ配置する

配置前に**登録先スコープ**をユーザーに確認する（契約「アセットのスコープ階層」参照）: `user`（`~/.akari-video/assets/`、全プロジェクト共通 — スターターパックの既定候補）/ `local`（プロジェクト内 `assets/`）/ `shared`（上位ディレクトリの `.akari-video/assets/`）/ `builtin`（製品リポの `assets/` — 開発者がライブラリ自体を育てる場合のみ）。以降の `assets/...` 表記は選ばれた層のルートを指す。

既存の同名ディレクトリがあれば上書きしない。内容を比較し、更新か新 id かの明示判断を人間から得る（[harvest-asset](../harvest-asset/SKILL.md) と同じ規律）。

取得した実体の性質によって以降の作業量が異なる。

- **authoring 不要な素材**（audio・broll など、取得した実体そのものが完成品）: meta.json をほぼそのまま複製し、下記の変更点だけ反映する。
- **authoring が必要な素材**（3d モデル単体、書体ファイル単体など、`fragment.html` や `@font-face` 定義がまだ無いもの）: [harvest-asset](../harvest-asset/SKILL.md) 2 節と同じ手順（CSS 変数 → knobs、依存 → requires の自動抽出）を踏んでから配置する。catalog の meta.json はあくまで下書きの出発点として扱う。

最低限そろえる: 実体ファイル + `meta.json` + `preview.png`。`preview.png` はカテゴリに応じて [harvest-asset](../harvest-asset/SKILL.md) 4 節の手順（HTML は headless Chrome、3D は代表 pose、B-roll は `ffmpeg` の代表フレーム、audio は waveform）で作る。生成できなければ理由を残し、実体と違う mock を preview として作らない。

### meta.json の書き方

catalog 側の `meta.json` をベースに、次を変更する。

1. **`remote` キーを外す（削除する）。** 実体が揃った素材はカタログ専用フラグを持たない。既存の `assets/` 内の他素材も `remote` フィールドを持たない。
2. **`provenance.origin` にカタログ由来である旨と取得元を記録する（必須）。** 例:
   `"catalog/<category>/<id> 由来 / 取得元: <source.url> / acquisition: <direct|login|purchase> / license_at_source: <...> / 取得日: YYYY-MM-DD"`
   分からない値を埋めない。取得日は実行日で確定する。
3. `source` ブロックは残してもよい（schema 上、`remote` が無くても `source` object は valid）。機械可読な取得記録として残す場合は保持し、`source.url` は実際に取得したファイル/ページの URL に合わせて更新する。不要なら削除してよい。必須なのは 1・2 のみ。
4. `license` / `tags` / `title` / `description` / `when_to_use` / `ai_usage` / `knobs` / `requires` / `author` / `price` は catalog 側の値を土台にする。authoring が必要な素材では、実際に作った `fragment.html` の CSS 変数・依存と食い違っていないか確認してから確定する。license が確定しない場合は `assets/` へ入れない。

### font カテゴリの特例

フォントは再配布ライセンスが同梱を許さないことが多い。

- ライセンスが redistribution / embedding を明示的に許可する場合（OFL 系の多くの Google Fonts 等）だけ、バイナリを `assets/font/<id>/` へ実体として配置し、`remote` を外す。
- 許可が確認できない場合、バイナリを `assets/` へコピーしない。`remote: true` を維持したまま、`ai_usage` にユーザーの実際のインストール先（OS フォントディレクトリ等）を記録し、`fragment.html` 側は `@font-face` でユーザー環境のフォント名を前提にする設計に留める。

## 3. attribution_required を記録する

`source.attribution_required` または `license.attribution_required` が true の場合、次の両方を行う。

- `assets/<category>/INDEX.md` の該当行に「要クレジット」等、attribution が必要である旨を明記する。
- ユーザーへ「この素材を書き出しに使う際は、プロジェクト側（エンドロール等）にクレジット表記が必要」と明示的に伝える。自動挿入は将来仕様であり、今は記録と告知のみ行う。

## 4. validator で検証する

```sh
node packages/schemas/bin/validate-asset.mjs "assets/<category>/<id>"
```

失敗したら `meta.json`、最小 3 点セット、category 一致、相対参照、INDEX を直し、成功するまで再実行する。`packages/schemas/bin/validate-asset.mjs` または `packages/schemas/asset-meta.schema.json` が無い場合は成功扱いにせず、成果報告に次をそのまま残す。

```text
後で実行: node packages/schemas/bin/validate-asset.mjs（validator / schema 作成後）
```

## 5. assets/<category>/INDEX.md を更新する

harvest-asset と同じ書式で 1 行追加する。

```text
<id> — <何で、どんな場面向けかを一文で>（要クレジットなど注記があれば併記）
```

重複行を作らない。新 category（font 等、`assets/` 側にまだ存在しないディレクトリ）を初めて作るときだけ `assets/INDEX.md` にもカテゴリ説明を追加する。

## よくある間違い

- ライセンスが未確認・不明確なまま取得を実行する（catalog の `license_at_source` を鵜呑みにし、取得元での実際の表記を確認しない）。
- attribution_required の記録漏れ（INDEX にもユーザーにも伝えない）。
- catalog の meta.json をそのまま `assets/<category>/<id>/meta.json` としてコピーし、`remote: true` が残る。
- `login` / `purchase` のカタログエントリをエージェントが代理で取得しようとする。
- フォントの再配布可否を確認せず、`assets/font/<id>/` へバイナリを無条件コピーする。
- validator を通さず「配置完了」と報告する。
- 承認されていない catalog エントリまで一緒に取得する。
- 既存 `assets/` の同名ディレクトリを黙って上書きする。
- 3d / font など authoring が必要な素材を、catalog の meta.json をそのまま流用して「完成」と扱う（knobs・requires が実体と食い違ったまま残る）。

## 根拠

- 契約: [`docs/contract-2026-07-13-asset-library.md`](../../docs/contract-2026-07-13-asset-library.md)「カタログと取得スキル」§
- 素材化・meta.json v0 の詳細規律: [../harvest-asset/SKILL.md](../harvest-asset/SKILL.md)
- authoring hard rules: [../overlay-authoring/SKILL.md](../overlay-authoring/SKILL.md)
