# 端末画面・キーの材質を生成時に整える

画面の白濁を見つけたら、まず取得原本・生成レシピ・ライブ用派生 GLB の材質を区別する。
黒い Base Color と発光画像だけでは PBR の鏡面反射は止まらない。Emission を Principled に
置き換える経路では metallic / roughness / specular / clearcoat の実効値も調べる。

画面、キーの樹脂、印字、筐体、トラックパッドを個別に扱う。画面のためにシーン全体の
環境光・露出を下げない。`ScreenMaterial` 等の名前から全素材へ無条件に設定を適用しない。

## 共通の生成入口

[scripts/device_materials.py](scripts/device_materials.py) は GLB の JSON チャンクだけに
明示指定した材質係数を適用する。画像、形状、カメラ、アニメーションの BIN チャンクは
バイト単位で保持する。`emissiveTexture` / `emissiveFactor` / 発光強度、未指定の係数・
テクスチャ・拡張も維持する。ランタイムの `materialOverrides` に未対応キーを追加しない。

Blender レシピから `export_glb(filepath, profiles, **export_options)` を呼ぶと、通常の GLB
書き出しと材質設定が一つの生成処理になる。モジュールはこのスキルの `scripts/` から
`importlib.util.spec_from_file_location` で読み込める。プロジェクトへ配備されたスキルは
`.claude/skills/overlay-authoring/scripts/device_materials.py`。単独配布レシピに組み込む場合は
ヘルパーもレシピ内へ同梱し、ユーザー固有の絶対パスを埋め込まない。

既存モデルを確認用の派生物へ変換するときは Python 3 で次を実行する:

```sh
python3 .claude/skills/overlay-authoring/scripts/device_materials.py \
  --input assets/models/original.glb --output assets/generated/device-matte.glb \
  --profiles .akari/work/keep/device-material-profiles.json \
  --report .akari/reports/device-materials.json
```

入力・既存出力は上書きしない。原本を更新する回避スクリプトを案件ごとに作らない。
選定した profiles JSON を生成レシピの入力として残し、後段の変換では材質を保持する。

profiles は明示的な対象の配列。次は強いスタジオ照明で確認した候補値の例であり、
全端末に使う既定値ではない。`values` の各係数は 0〜1。

```json
[
  {"material":"ScreenMaterial","values":{"metallic":0,"roughness":0.90,"specular":0.05}},
  {"material":"keycap","meshes":["keyboard_keys"],"name":"KeyboardMatteMaterial",
   "values":{"roughness":0.90,"specular":0.02,"clearcoat":0}}
]
```

`meshes` を指定すると材質を複製し、そのメッシュの対象 primitive にだけ割り当てる。
USB 端子などで共有される元の keycap 材質は維持する。材質名・メッシュ名が重複して
曖昧な場合、対象が無い場合、未知の係数や範囲外の値はエラーにする。
`meshes` を省略するとその材質の全使用箇所が対象になるため、監査レポートの対象一覧を確認する。

## 比較と採用

- 同じ画像・カメラ・照明・発光倍率で、正面と左右斜めを比較する。キーは specular、
  clearcoat、roughness を一つずつ変えた対照を作り、色・露出を先に暗くして原因を隠さない。
- ガラス画面のスマホも同じ照明で確認する。発光画面の挿入板と、その背後のガラス・
  ベゼル・背面を分ける。白濁を再現しないモデルへ不要な変更を入れない。
- 画像と動画の差し替え、brightness の保持を検査する。GLB の
  `KHR_materials_specular` / `KHR_materials_clearcoat` が読み込み後も残ることを確認する。
  `threeRuntime.inspect(container).materials` は読み込み後の係数を返す検証用の入口。
- [既存プレビュー](../edit-lint/preview.md) と実際の GPU / OSR 出力で比較し、どの入口で
  再生・シーク・フレームを確認したか明記する。別ページの描画をアプリ確認済みとしない。
- 比較画像、採用値、素材の版・ハッシュ、変更対象と非対象の不変確認を記録する。
  画面の黒・白文字・色付き UI、キー印字と筐体の区別が保たれることを視認する。
  配布原本の更新は検証済みの版更新として行い、既存案件の原本を置き換えない。
