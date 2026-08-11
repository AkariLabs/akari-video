---
lifecycle: draft
created: 2026-08-11
updated: 2026-08-11
---

# 分析トラック契約 v0 — Vision ランドマーク・トラック（face-landmarks / hand-pose）と keyframes 消費

- 日付: 2026-08-11
- 状態: **ドラフト**（v0 実装と同時に確定させる。実装で判明した齟齬は追記で解消）
- 前提:
  - `contract-2026-07-17-data-contract-versioning.md`（version 整数・追加のみ・寛容リーダーの三原則）
  - `contract-2026-07-23-analysis-person-matte.md`（Swift サイドカーの流儀・analysis.json の tracks 契約・検証責務の分担）
  - `contract-2026-07-25-project-structure-v0.md`（分析サイドカーの置き場 = `.akari/sidecars/`）
  - `contract-2026-08-02-preview-parity.md`（render/Web/shell 3 面パリティの原則）
- スコープ: 動画から抽出する**ランドマーク・トラック**（顔・手）のデータ契約、生成サイドカーの
  入出力、消費（`layers[].keyframes` への変換）の責務分担。**新しいレンダー機構は作らない**

## 0. 設計原則

1. **分析はプル駆動**。網羅的な事前分析はしない。エフェクトを使いたいときに、必要な種類の
   トラックだけを生成してサイドカーにキャッシュする
2. **分析は事実の記録、演出は消費側の仕事**。トラックには検出の生値（座標・信頼度）だけを入れ、
   平滑化・間引き・演出パラメータ化は変換器（消費側）が行う。同じトラックから別演出を再生成できる
3. **消費は既存機構への変換**。トラック → `edit.json` の `layers[].keyframes`
   （transform / perspective）へ決定論変換する。レンダー・Web プレビュー・shell プレビューの
   3 面パリティは既存の layers 機構がすでに担保しているため、**本契約の範囲で新しい
   3 面実装は発生しない**（これが本契約の最重要設計判断）
4. **プロバイダ中立**。トラック形式は「何で検出したか」に依存しない。v0 のプロバイダは
   Apple Vision framework（macOS）のみだが、将来の別プロバイダ（例: MediaPipe）は
   `provider` フィールドの値が変わるだけで同じ形式を吐く
5. **宣言のない能力は存在しない**（avatar rendition / asset knobs と同じ哲学）。環境が
   対応しない分析は `--check` が正直に不可を返す。推測実行しない

## 1. analysis.json への追加（additive）

`tracks` に **optional キー** 2 つを追加する。`tracks.required`（speakers / faces /
person_matte）には**入れない**（person_matte が必須なのは既存消費者の事情であり、新トラックは
真に任意として追加する）。

```jsonc
"tracks": {
  // ...既存キー...
  "face_landmarks": {            // 任意。無ければ「未生成」
    "path": "vision/face-landmarks.json",   // analysis.json のあるディレクトリ基準の相対パス
    "sample_fps": 24,
    "provider": "apple-vision",             // 自由文字列（enum 強制しない）
    "tool": "vision-tracks.mjs v0",
    "generated_at": "2026-08-11T12:00:00Z"
  },
  "hand_pose": { /* 同形 */ }
}
```

## 2. トラックファイル形式（vision-tracks v0）

`path` が指す JSON ファイル。1 ファイル 1 種類（face-landmarks と hand-pose は別ファイル）。

```jsonc
{
  "version": 0,
  "kind": "face-landmarks",      // "face-landmarks" | "hand-pose"
  "source": { "path": "../..(元動画への相対)", "duration": 12.5 },
  "sample_fps": 24,
  "provider": { "name": "apple-vision", "os": "macOS 15.5" },
  "samples": [
    { "t": 0.0, "detections": [ /* §2.1 / §2.2 */ ] },
    { "t": 0.0417, "detections": [] }     // 検出ゼロのフレームも t を残す（欠測と非検出を区別）
  ]
}
```

- **座標系（最重要規約）**: すべて **0〜1 正規化・左上原点**（動画ピクセル系と同じ向き）。
  Vision framework は左下原点で返すため、**y 反転はサイドカーの責務**。消費側は変換しない
- `samples[].t` は元動画の秒（`in`/`out` と同じ時間軸）。サンプリングは `sample_fps` の等間隔
- 生値主義: 平滑化・補間済みの値を入れない。信頼度（`conf`）を必ず併記する

### 2.1 face-landmarks の detection

```jsonc
{
  "box": [x, y, w, h],           // 顔矩形（正規化）
  "conf": 0.98,
  "landmarks": {                  // VNFaceLandmarks2D 由来。キーは snake_case
    "left_pupil": [x, y],
    "right_pupil": [x, y],
    "left_eye": [[x,y], ...],     // 領域は点列
    "right_eye": [[x,y], ...],
    "outer_lips": [[x,y], ...],
    "inner_lips": [[x,y], ...]
    // v0 で必須なのは上記 6 キー。他の VNFaceLandmarkRegion2D は任意で追加してよい（追加のみ）
  }
}
```

### 2.2 hand-pose の detection

```jsonc
{
  "chirality": "left",           // "left" | "right" | "unknown"
  "conf": 0.95,
  "joints": {                     // VNHumanHandPoseObservation.JointName の snake_case
    "thumb_tip": [x, y],
    "index_tip": [x, y]
    // v0 で必須なのは thumb_tip / index_tip。他の 19 関節は任意で追加してよい（追加のみ）
    // 信頼度が閾値未満の関節はキーごと省略する（捏造ゼロ — 無い関節は無い）
  }
}
```

### 2.3 形式の詳細（v0 実装時点で追記・2026-08-11）

実装（`vision-tracks-helper.swift` / `vision-tracks.mjs`）で判明した §2 の詳細化。原則・
責務分担は変えない。

- **座標のクランプ**: Vision framework は、遮蔽・フレーム端で切れた関節点を画像範囲の外へ
  わずかに外挿することがある（実測: `y = 1.0015984773635864` を観測 —
  `tasks/2026-08-11-vision-tracks-v0/report.md` 参照）。「すべて 0〜1 正規化」を字義通り
  保証するため、サイドカー（Swift ヘルパー）は y 反転後の値を `[0, 1]` へ丸めてから出力する。
  丸めは person-matte-helper のアルファ値クランプ（`min(max(value, 0), 255)`）と同じ防御であり、
  捏造ではなく Vision 自身が返した値を契約の範囲へ収める処理である。
- **顔ランドマークの検出単位での省略**: 手の関節はキー単位で省略できる（§2.2）が、顔は
  6 領域（瞳 2・目 2・唇 2）がひとかたまりで計算される Vision の性質上、Swift ヘルパーは
  ある顔検出の landmarks 計算が失敗した（Vision が `landmarks` を返さなかった）場合、
  その検出を `detections` から**丸ごと**除く。box・conf だけを残す縮退形は作らない
  （§2.1 の必須 6 キーが揃わない detection を出力に混ぜない）。実測（1 名がほぼ映り続ける
  26.3 秒素材）ではこの除外は 0 件だった。

## 3. サイドカー（生成側）

person-matte と同じ分離: **Swift ヘルパーはフレーム変換だけ、コンテナ・時刻・組み立ては
ラッパー（.mjs）の責務**。

- 置き場: `skills/analyze-footage/bin/vision-tracks/`
  - `vision-tracks-helper.swift` — stdin から raw BGRA フレーム列、stdout へ **JSON Lines
    （1 フレーム 1 行の検出結果）**。`swiftc -O` オンデマンドビルド・バイナリは `.gitignore`
  - `vision-tracks.mjs` — `ffmpeg`（デコード・fps/幅統一）→ helper → トラックファイル組み立て →
    `analysis.json` の tracks へ追記（原子的置換）。`--kinds face,hand` / `--fps` / `--check`
    （macOS / swiftc / ffmpeg の可用性確認）
- 手順書: `skills/analyze-footage/vision-tracks.md`（person-matte.md と同格の任意工程）。
  `SKILL.md` の実行順・ハードルールに配線する
- 起動主体はエージェント（スキル手順に従い bash で直接叩く）。CLI サブコマンドにはしない
  （判断を伴う工程はスキル、の境界裁定に従う）

## 4. 消費（変換器）

トラック → `edit.json` への反映は**決定論の変換器**が行う。v0 の消費者は 2 つ（別契約で
実装しても本契約の §2 形式だけを入力にする）:

| 消費者 | 入力 | 出力 |
|---|---|---|
| eye-bar（目線黒帯） | face_landmarks（両瞳） | 黒帯レイヤー + `layers[].keyframes` の transform（x/y/rotate/scale） |
| finger-frame（指フレーム） | hand_pose（両手の thumb_tip / index_tip = 4 点） | 対象レイヤーの `layers[].keyframes` の perspective（4 隅 corner-pin）+ 発動区間 |

- 平滑化（移動平均・One Euro 等）・キーフレーム間引き・欠測補間は**変換器の責務**。
  パラメータは変換器の引数で決定論に
- perspective keyframes の ffmpeg 側は既存の時間窓分割フォールバック
  （`expandLayerForPerspectiveKeyframes`）に乗る。新しいレンダー経路は作らない
- `cuts[].fx` は**使わない**（全画面ポスト効果の器。空間追跡系はレイヤー機構が正）

## 5. 検証責務

- `packages/schemas/bin/` に新しいバリデータ CLI は**作らない**（person-matte 契約 §7 の分担を
  継続）。トラックファイルの JSON Schema は `skills/analyze-footage/references/
  vision-tracks.schema.json` に置き、スキル手順の jsonschema 検証が担う
- `analysis.schema.json` への tracks 2 キー追加は additive のみ
- **`packages/analysis-report/render-analysis-report.mjs` の軽量チェックを同時に更新する**
  （person_matte が残した「消費者の追随債務」を新トラックで繰り返さない）
- verify は L0（該当 package / skill の `node --test`）。GUI を触らないため L1/L2 は対象外

## 6. やらないこと（v0）

- 感情・笑い・音声イベント分析（SoundAnalysis）— 別契約
- 自動リフレーム（サリエンシー）・美的スコア — 別契約
- クラウド実行・macOS 以外のプロバイダ実装（形式だけプロバイダ中立にしておく）
- `edit.json` からトラックファイルを直接参照する仕組み（消費は変換器経由のみ。エフェクトが
  分析に依存する形をスキーマに持ち込まない）
