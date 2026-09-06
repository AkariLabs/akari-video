# webview-theme-vars — 実機（L1）証跡

Codex 拡張の webview が「白地に薄い文字」になる不具合の二層（層 A = 内側 `<html style>` の
`--vscode-*` 消失 / 層 B = シェル root の `color-scheme: dark` と webview ホストページ
（`@theia/plugin-ext` の `pre/index.html`・指定なし = light）の不一致で Chromium が
不透明な白キャンバスを描く）を実機で確定し、恒久策が効いたことを BEFORE / AFTER で示す。

パスはすべて `<repo>` / `<tmp>` / `<home>` に置換済み。Codex にはログインしていない
（拡張の UI は startup-loader または拡張自身のエラーページのまま。機構の検証に会話は要らない）。
スクリーンショットはホーム画面の「AKARI Store」カードにオーナーのメールが出るため、
`scripts/redact-shots.mjs` で x 200-1040 / y 800-960 を黒で潰してある（計測点は
Codex パネル内 x ≥ 1054 とプレビューの 0,0-1200x800 なので、測った画素にはかからない）。

## 走らせ方

```bash
# 1. スクラッチ（THEIA_CONFIG_DIR / --user-data-dir / ワークスペース）を作る
SC=$(scripts/setup-scratch.sh)          # => /private/tmp/akari-wtv.XXXXXX
# 2. CDP 付きで起動（ポートは他レーンと被らない 9762 系）
scripts/launch.sh "$SC" 9762
# 3. 計測（--phase before|after）
node scripts/run-coldstart-early.mjs --port 9762 --out . --phase before --seconds 40
node scripts/run-matrix.mjs           --port 9762 --out . --phase before
node scripts/run-preview.mjs          --port 9762 --out . --phase before --edit "$SC/ws/project/edit.json"
node scripts/run-selfheal.mjs         --port 9762 --out . --idle-sec 300        # AFTER のみ
node scripts/run-light.mjs            --port 9762 --out . --phase after         # AFTER のみ
node scripts/run-trigger-hunt.mjs     --port 9762 --out . --edit "$SC/ws/project/edit.json" --steps abdefg --idle-min 30
node scripts/compare-preview.mjs      --out .
```

BEFORE ビルド = `src/browser/akari-button-style-contribution.ts` と
`akari-theme-frontend-module.ts` を修正前（`a0abb35f`）へ戻して `npm run build`。
AFTER ビルド = 本ブランチの HEAD で `npm run build`。

## 実測（要点）

### 行列（`before-matrix.json` / `after-matrix.json`・PNG は `*-vars-*.png`）

Codex パネル内 3 点と、隣接する Theia 右パネル 3 点（iframe の 12px 外）の画素。

| セル | BEFORE inside | Δ→panel | AFTER inside | Δ→panel |
|---|---|---|---|---|
| 変数あり × root dark | (255,255,255) | **245** | (30,30,30)※ | 20 |
| 強制消失 × root dark | (255,255,255) | **245** | (10,10,10) | **0** |
| 変数あり × root なし | (10,10,10) | 0 | (30,30,30)※ | 20 |
| 強制消失 × root なし | (10,10,10) | 0 | (10,10,10) | **0** |

- 「強制消失 × root dark = 白 / 強制消失 × root なし = 暗」が**二層の証明**
  （変数が消えても、root の `color-scheme` が無ければ白くならない）
- ※ AFTER の「変数あり」は Codex 側が自前の不透明な背景 `#1e1e1e` を描いている状態。
  BEFORE の同セルが白いのは、この run の Codex がまだ startup-loader で body が透明だったため
  （= 層 B は変数が揃っていても実害が出る）
- AFTER のシェル: `documentElement` の `color-scheme` = **dark**（v0.1.41 の修正は生きている）/
  `iframe.webview` = **light**（埋め込みホストページと一致 → キャンバスが透明に戻る）

### 起動直後（`before-coldstart-early.json` / `after-coldstart-early.json`・`*-early-*.png`）

同じ手順・同じ 40 秒窓・スクラッチは毎回新規。

| | BEFORE | AFTER |
|---|---|---|
| 白い（>200）サンプル数 | **7 / 12** | **0 / 20** |
| 白かった時刻 | 13.9 s 〜 28.0 s | なし |
| 暗くなった時刻 | 29.4 s | **0.4 s**（最初のサンプルから） |
| その間の N | 627（欠けていない） | 627 |

`before-early-00.png` がオーナーの実機で起きた見た目そのもの（右の CODEX パネルだけ真っ白）。
`after-early-00.png` が同じ瞬間の AFTER。

`before-coldstart.json` / `after-coldstart.json` / `before-coldstart-run1.json` は
120 秒の追跡（`run-coldstart.mjs`）。内側 frame へ attach してから測り始めるため
起動直後の窓を取り逃すことがあり（実測 25〜30 秒かかる run がある）、
`run-coldstart-early.mjs` を追加してその窓を埋めた。run1 は最初の走（BEFORE ビルド・
白 0.7 s 〜 11.8 s）。

### 自己修復（`after-selfheal.json`・`after-selfheal-*.png`）

1. ベースライン N = 627 → 内側 `<html style>` から `--vscode-*` を 627 個すべて削除
2. 0.5 秒後のパネル画素 (10,10,10) = 隣接パネルと **Δ0**（白くならない）
3. N は **16.1 秒**でベースラインへ復帰（受け入れ条件 60 秒以内）
4. 復帰後、CDP の実マウス・実キーが内側 document へ届く
   （pointerdown 1 / click 1 / keydown 1「a」・`document.hasFocus()` = true）
5. アイドル 300 秒の `styles` 再送 = **6 回 = 1.20 回/分**（受け入れ条件 2 回/分以下）

未ログインの Codex は入力欄も onboarding ボタンも描かない（`focus.info.found` = false）ため、
「入力欄をクリックしてフォーカス」は**実行できず**、代わりに 4 の実入力で代替した。

### 回帰

- (α) プレビュー webview（`before-preview.json` / `after-preview.json` / `preview-regression.json`）:
  同じ fixture（`dev-fixtures/preview-lut-chroma/b-lut-050`）・同じシーク（1 s）・
  webview の iframe を 0,0-1200x800 に釘付けにして 8px 格子 15000 点 →
  **maxΔ = 0 / meanΔ = 0 / Δ>2 の点 0**。AFTER 同士の撮り直しでも maxΔ = 0（ノイズ床 0）
- (β) メイン document の `colorScheme` は BEFORE / AFTER とも **dark**
- (γ) ライトテーマ（`after-light.json` / `after-light-*.png`）: パネル内 (255,255,255) =
  隣接パネル (255,255,255)（Δ0）で濃い文字あり（暗画素比 0.58%）。強制消失時も Δ0

### トリガー狩り（`trigger-hunt.json` / `trigger-hunt-c.json` / `trigger-hunt-c-after.json`）

`CSSStyleDeclaration.prototype` の `removeProperty` / `setProperty` / `cssText` と
`Element.prototype.setAttribute('style')` / `removeAttribute('style')` を内側 frame 限定でラップし、
`--vscode-*` の削除・空文字設定を stack つきで記録した状態で (a)〜(g) を実行。

| 行 | 操作 | N | 結果 |
|---|---|---|---|
| baseline | — | 627 | — |
| (a) | テーマ dark → light → dark | 629 | 増えるだけ（light で 2 個追加）・欠落なし |
| (b) | Codex コンテナ 閉→開 / 右パネル 畳→展開 | 629 | 欠落なし |
| (c) | Codex ビューを左パネルへ → 戻す | 627 | 欠落なし（AFTER ビルドで実測。BEFORE では view container が dispose され webview が戻らず計測不能） |
| (d) | 新しいウィンドウ 開→閉 | 629 | 欠落なし |
| (e) | 最小化→復帰 / 幅 600px ↔ 元 | 629 | 欠落なし |
| (f) | 出力プレビューを開いて再生・シーク | 629 | 欠落なし |
| (g) | 30 分放置（5 分刻み） | 629 | 欠落なし |

**変数が消える瞬間は再現しなかった（未再現）**。ラップした 5 経路のログ（`varLog`）は全行で空。
= 層 A のトリガーは未特定のまま。恒久策はトリガー非依存（白くしない + 消えても戻す）なので、
未再現でも受け入れ条件は満たす。

## 環境メモ（再現時の注意）

- Codex 拡張はシェルが自前で版を配る。`setup-scratch.sh` が ditto した
  `openai.chatgpt-26.5707.71524` は起動中に `26.5901.22334` へ置き換わる。
  さらに 2026-09-06 13:19 にオーナー側アプリが `~/.theia/deployedPlugins` を更新して
  `26.5707.71524` 自体が消えたため、以降は `AKARI_WTV_PLUGIN_SRC` で複製元を差し替えている
  （BEFORE / AFTER は同じ版で走らせた）
- Codex の UI は未ログイン・ネットワーク到達なしのため startup-loader のままか
  拡張自身の「Codex could not start」ページに落ちる。どちらでも Theia が注入する
  `--vscode-*` と body の透明度は同じなので、二層の検証には影響しない
- スクラッチのパスは `/private/tmp`（物理パス）で渡す。`/tmp` のまま渡すと
  akari-preview の「ワークスペース内か」判定が realpath と食い違い、
  「ワークスペース外の動画はプレビューできません」になる
- 左右のバー幅が run ごとに 7px 変わるため、プレビューの画素比較は
  iframe を `position: fixed` で 0,0-1200x800 に釘付けにしてから撮る
