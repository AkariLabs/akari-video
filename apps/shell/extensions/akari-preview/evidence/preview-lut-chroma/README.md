# preview LUT / chroma WebGL rail evidence

## 結果

production Electron を CDP で操作し、`akari.preview.ensureVisible` → `seekOutput` → rail canvas の
`drawImage` / `getImageData` で 320×180 fixture を実測した。MAD は
`Σ|preview-export| / (画素数×3×255)`。TV range の追加正規化は行っていない
（tagged TV-range 動画を Electron/Chromium と ffmpeg の双方で display RGB へ展開して比較）。

| fixture | MAD | 測定環境 | 判定 |
|---|---:|---|---|
| source chroma + 背景色 | 0.2872% | Electron + CDP | PASS（≤1%） |
| cinematic LUT intensity 1.0 | 0.4273% | Electron + CDP | PASS（≤1%） |
| cinematic LUT intensity 0.5 | 0.3781% | Electron + CDP | PASS（≤1%） |
| PiP layer chroma | 0.1042% | headless Chromium | PASS（≤1%） |
| transition × LUT | — | Electron + CDP、3 seek points | PASS |
| 宣言なし | — | Electron + CDP | PASS（rail 0） |

source chroma の preview FNV は `c4f2874e` で、同一時刻へのシーク往復後も
`c4f2874e` と完全一致した。rail は source / transition / still の 3 枚で、source rail は
`hasChroma: true`、`time: 1` と宣言・seek 位置に一致した。LUT intensity 1.0 は
`340c7bec → 340c7bec`、0.5 は `32af7728 → 32af7728` で、往復再描画も決定論的だった。
LUT intensity 1.0 fixture は全 rail で `hasLut: true` を確認した。

宣言なし fixture は rail canvas 0 個・空の rails 配列で、native video を直接描画した FNV は
`ac17e6b2`。宣言のないプロジェクトでは rail DOM を生成しない構造的不活性を実機で確認した。

## transition × LUT

`e-transition-lut` の dissolve transition-out と LUT の共存を `t=1.1 / 1.5 / 1.9` で実測した。
各点で rail は source / transition / still の 3 枚、source と transition はともに
`status: ready`・`hasLut: true` で、rail 内部時刻も seek 先と一致した。

| time | outgoing opacity | incoming opacity |
|---:|---:|---:|
| 1.1 | 0.9 | 0.1 |
| 1.5 | 0.5 | 0.5 |
| 1.9 | 0.1 | 0.9 |

opacity は dissolve 式どおり直線的にクロスし、各点の corner / center ピクセルも互いに異なる色を
返した。これにより、遷移中間フレームで transition と LUT が同時に動作することを確認した。

## PiP layer chroma の測定限界

PiP layer chroma の MAD `0.1042%` は headless Chromium 実測であり、Electron と同じ
`video-fx.js` shader コードパスを使用した。実機 Electron で同じ画素比較を複数回試したが、共有ワーカー上で
同時稼働する複数の Electron GPU プロセスとの競合により CDP `Runtime.evaluate` がタイムアウトし、
完全な MAD 測定は完走できなかった。

実機では rail が `role: layer:pip-keyed`・`hasChroma: true`・`status: ready` になることと、
クロマ抜け後の背景色が declaration と一致することを個別に確認した。したがって wiring は Electron 実機、
画素 MAD は同一 shader を使う headless Chromium の証跡として区別する。

## フェイルオープン

Electron を `--disable-webgl --disable-webgl2` で起動した初回試行では、rail 0 個、badge
「プレビュー未対応: LUT」への復帰、native video の `readyState: 1` を確認した。rail の畳み込み、
badge 復帰、video 要素を失わないフェイルオープンの中核は実機で成立した。

同じフラグでの再試行では WebGL2 rail が生成される場合もあり、この環境では Chromium の無効化フラグが
WebGL context 生成を決定論的には止めなかった。これは driver / 実行環境依存の制約として記録し、
強制失敗試験を常に同じ状態へ固定できたとは扱わない。

## LUT 適用範囲

render-cut の実段は LUT を含む `cut.mp4` → PiP を足す `layered.mp4` → HTML overlay の順。
PiP 中心は layer 後 `(205,31,31)` で元素材 `(205,31,31)` と一致し、LUT は PiP に乗らない。
HTML overlay も LUT 後段の command 入力であるため乗らない。Shell rail はこの実測どおり base /
transition / still にだけ LUT を掛け、PiP と overlay DOM には掛けない。値は
`scope-measurements.json`。

## 実行環境と CORS 回帰確認

ラッパー側で production Electron + CDP による L1 検証を完了した。Shell 固有配線は
`video-fx-webview-wiring.test.mjs`、既存 5 transition 配線は
`transition-webview-wiring.test.mjs` でも検査している。

base video の `crossorigin="anonymous"` に対して `/media/` 応答へ
`Access-Control-Allow-Origin: *` が無かった CORS 回帰は、ストリーム成功応答へ ACAO を共通付与するよう
修正した。この修正を含む build で全 PASS fixture を実測し、実機 Electron の `#preview-video` が
`readyState >= 2` へ正常到達することを確認した。
