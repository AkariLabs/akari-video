# tl-caption-motion-clear — 字幕の「動き」を押し直し / 「なし」で外す（L1 証跡）

動きパネルで当たっているカードをもう一度押すと外れること、「動き」の切替の横の「なし」でそのスロットが外れることを、
実機（Electron・CDP ポート 9474）で確かめた記録。

## 再現手順（リポのルートで、apps/shell を build 済みにしてから）

```bash
W=$(mktemp -d)
node apps/shell/extensions/akari-annotations/evidence/tl-caption-motion-clear/scripts/gen-fixture.mjs "$W/fixture"
node apps/shell/extensions/akari-annotations/evidence/tl-caption-motion-clear/scripts/l1.mjs "$W" nobag
node apps/shell/extensions/akari-annotations/evidence/tl-caption-motion-clear/scripts/l1.mjs "$W" bag
```

- fixture: 15 秒・字幕 4 行（どの行にも `text_style.color`）。`nobag` = 字幕の袋なし（captions.json に書く）/ `bag` = 袋あり（「動き」カードは edit.json の袋 item の `motion` に書く）
- 起動した Electron は自分の PID だけを止める。`AKARI_HOME` / `--user-data-dir` / `THEIA_CONFIG_DIR` は作業用ディレクトリ内の専用名
- スキーマ検証は `validate-captions` CLI と、`captions.schema.json` の Ajv 検証（`schema-check.mjs`）の両方。CLI は `textAnimation` の `minProperties` を見ないため、空の `animation: {}` が落ちることは Ajv 側で対照を取った

## 結果

| 記録 | 内容 |
|---|---|
| `results-nobag.json` | 23 / 23 PASS（フェードの押し直し・テキストアニメ側からの解除・組「タイプライター」の押し直し・「なし」（登場 / 退場）・強調の押し直し・Cmd+Z・スキーマ検証・実演が走らないこと） |
| `results-bag.json` | 9 / 9 PASS（袋の「動き」カードの押し直しで `motion.in` が消える・「なし」（強調）で `motion.loop` だけ消える・組「シンプル」の押し直しで `motion` がまとめて消える・Cmd+Z） |
| `nobag-01-fade-applied.png` / `nobag-02-fade-cleared.png` | フェードを当てた状態（動きカードとテキストアニメの両方が押された表示）/ 押し直した後 |
| `nobag-05-typewriter-applied.png` / `nobag-06-none-button.png` | 組「タイプライター」を当てた状態 / 「なし」ボタン |
| `bag-09-bag-fade-applied.png` / `bag-09-bag-fade-cleared.png` | 袋の字幕でフェードを当てた状態 / 押し直した後 |

Undo はすべて Cmd+Z（Meta+Z）1 手で戻った（記録の `via`）。
