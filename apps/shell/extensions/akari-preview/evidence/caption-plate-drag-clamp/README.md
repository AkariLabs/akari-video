# caption-plate-drag-clamp — L1 証跡

プレビューの字幕プレートを「その行だけ」X/Y ドラッグで動かす + はみ出し防止クランプ
（既定 ON・行ごと解除）+ 既定に戻す、の実機（Electron + CDP）検証。

## 走らせ方

```
node scripts/gen-fixture.mjs          # fixture/ を決定論で作り直す（mp4 は ffmpeg color）
bash scripts/run-l1.sh after          # 本番ビルドの Electron を起動して手順 1〜6 を回す
```

- `scripts/launch-shell.sh` / `scripts/cdp-lib.mjs` は
  `akari-annotations/evidence/chip-reachability/scripts/` の写し（元は触っていない）。
  cdp-lib には本レーンの追記（`waitFor` / 修飾キー付きドラッグ）だけを足してある。
- ドラッグ・クリックは CDP `Input.dispatchMouseEvent` の page 座標で行う。
  page 座標と webview（OOPIF）の client 座標のズレは、実測 1 回のキャリブレーションで求める。
- `fixture/` は 5 行（words 付き・object ルート + `default_text_style.zone = bottom`）の
  captions.json と v2 の edit.json（1280x720 / src 1 本 / speed 1 / cuts 無し）。
  10 秒の mp4 は生成物なので `.gitignore` 済み（`gen-fixture.mjs` で再生成できる）。
- 実行は `runs/` 配下の使い捨てワークスペースを書き換えるので、`fixture/` は汚れない。

## 手順と観測

| # | 操作 | 観測 |
|---|---|---|
| 1 | 行 2 の時刻へシークしてプレートを (+200, −150) px ドラッグ | 行 2 に `text_style.text_anchor` + `position`（0..1）。`default_text_style` と他 4 行はバイト不変。バッジ = 「この字幕だけ動く — ⌥ドラッグで全字幕」 |
| 2 | ⌥ + 同じドラッグ | `default_text_style.text_anchor/position` が変わり、行 2 の `text_style` はバイト不変。ドラッグ中のバッジ = 「全字幕が動く」 |
| 3 | クランプ ON で右下へ大きくドラッグ | 保存値で箱がフレーム内（`x + plateW/frameW ≤ 1` / `y ≤ 1`） |
| 4 | 🧲 クリック → OFF → 同じドラッグ | フレーム外の値が保存される（= lint pass。不合格なら write されない） |
| 5 | ↺ クリック | 行 2 の `text_anchor` / `position` が消え、↺ が消える |
| 6 | プレビューを閉じて開き直す | 🧲 が既定 ON に戻る（クランプ状態は永続化しない） |

結果は `results/results.json` と `results/shots/*.png`。
