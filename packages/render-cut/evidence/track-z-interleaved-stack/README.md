# r5c-track-z: 交互スタック z 順 実測（L2 受け入れ条件 #1・#3）

`check-interleaved-stack.mjs` は一時プロジェクトで下記の交互スタックを合成する:

- cuts track0 = 緑（土台。[0,3) で常時存在）
- layers track0 = 完全不透明の黄色いテロップ相当（[0.5, 2.5) で存在）
- cuts track1 = 青（[1, 2.5) で存在。layers0 と重なる窓を持つ）

`timeline.tracks` の宣言順だけを変えた 2 パターンを実レンダリングし、t=2.0s
（cuts1 と layers0 が重なる窓）と t=0.2s（どちらの track も非活性で cuts0 のみ）の
ピクセルを実測する。

```sh
node packages/render-cut/evidence/track-z-interleaved-stack/check-interleaved-stack.mjs
```

## 結果

- `result-before-fix.json`: 実装前（本タスク開始時点の HEAD）の実測。stack-a と
  stack-b が**バイト等価**（宣言順が完全に無視されている）で、どちらも t=2.0s に
  黄（layers0）——contract のバグそのものを実証する
- `result-after-fix.json`: 実装後の実測（ラッパーが独立に再実行）。
  - stack-a（`[cuts0, layers0, cuts1]` = cuts1 が最前面宣言）: t=2.0s = **青
    (cuts1)** — cuts1 が layers0 のテロップより前面に出ることを確認
  - stack-b（`[cuts0, cuts1, layers0]` = layers0 が最前面宣言、順序反転）:
    t=2.0s = **黄 (layers0)** — 宣言順を入れ替えると前後が反転することを確認
  - 両方とも t=0.2s = 緑 (cuts0) — 上位 track が非活性な時間は下の土台が正しく
    透過して見えることの回帰チェック

captions は今回の変更で触っていない後段合成（cuts+layers 合成後に無条件で最前面）
なので、この実測は L2 #3（captions 常時最前面）についても、cuts/layers の z 変更が
その後段に影響しないことの間接的な裏付けになる（captions 自体のピクセル実測は
別途 report.md の制約事項を参照）。
