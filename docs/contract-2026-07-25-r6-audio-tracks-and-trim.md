# R6 契約 — タイムライン配置原則・音源複数トラック化・音源トリム・ソーストリマー

- 日付: 2026-07-25
- 状態: draft（裁定は確定。実装と並走で approved 化）。本書は技術仕様のみ。
  判断経緯・実装レーンの運用は非公開の内部記録で管理する（本リポには置かない方針）
- 前提: `contract-2026-07-14-edit-json-v1-audio.md`（audio スキーマ正本）、
  `contract-2026-07-17-data-contract-versioning.md`（三原則）

## 1. 確定事項（2026-07-25 裁定）

1. **タイムライン配置原則 = Premiere 型を正式採用**:
   - 音源グループは**最下段固定**（並べ替え不可）
   - cuts 帯（Video）はその上の縦中心。上に layers / captions（重ね物）
   - 映像系トラック内の縦順は従来どおり**上の行ほど前面**（z 順裁定は不変）
   - ルーラー（メモリ）位置は現状のまま固定
   - 既定スタック（下から audio→cuts→layers→captions）と整合。本裁定はこれを
     「固定の配置原則」として明文化するもの
2. **音源の重なり解消 = 複数音声トラック化**:
   - sfx の `track` フィールド（schema 既存）を UI で解放し、音声もトラックを増やせるようにする
   - 従来の「audio は当面 ref 0 固定（単一トラック）」運用を本裁定で変更
   - `timelineTrack` は kind:'audio' の複数宣言を既に許容（schema 変更不要）。
     音声トラック群は配置原則 1 により常に最下段グループ内で増減する
3. **ソーストリマーの入口 = タイムラインのクリップ dblclick**:
   - クリップをダブルクリック → カット外部分を薄く表示し、左右スライドで in/out 調整
   - 素材ファイルの dblclick = 素のソース再生、とは両立（入口が別）

## 2. 音源トリム（schema 拡張）

### schema

- `sfxItem` に optional `in` / `out` を追加（**素材秒**。`in` ≥ 0 省略時 0、
  `out` > `in` 省略時 素材末尾）。再生区間 = 素材の [in, out)、
  タイムライン上の開始は従来どおり `t`（timeline 秒）、表示尺 = out − in
- `narrationItem` にも同じ optional `in` / `out` を追加する。再生区間・素材秒・既定値・
  `out > in` の検証分担は sfx と同一で、タイムライン上の開始は narration の `t` とする
- `bgm` に optional `in` を追加（BGM ファイル内の開始オフセット素材秒。ループ・全体尺
  トリムの既存意味論は不変）
- edit-lint: `out <= in` を error。実尺越えの検知は lint では行わない
  （lint は ffprobe を持たない — クランプは消費側の責務）
- cuts 側の語彙に倣い、$comment に意味論を明記する

### 消費（render-cut + preview）

- render-cut: sfx の [in, out) 切り出しを出力に反映。bgm の `in` オフセット反映
- render-cut: narration の [in, out) 切り出しも出力に反映する。`in` が素材実尺以上なら 0 へ、
  `out` が素材実尺を超えれば素材末尾へクランプして warning を出す。クランプ後に `out <= in` なら
  その narration 要素だけを skip する。`in` / `out` の有無にかかわらず、各 narration 要素は
  デコード可否の判定を兼ねて実尺を従来と同じ 1 回だけ probe し、デコードできなければ従来どおり
  その要素だけを skip して warning を出す一方、両方省略された要素には `atrim` を前置きせず、
  従来とバイト同一のフィルタ文字列を保つ
- preview（previewAudio）: 同意味論で再生。実尺越え in/out は素材末尾へクランプ

### UI

- 音源バーの端ドラッグでトリム（in/out 書き戻し）。動画クリップのトリムと同じ操作感
- 複数音声トラック行の表示・追加・アイテムのトラック間移動（裁定 2）
- 配置原則（裁定 1）の実装: audio グループ最下段固定・cuts 縦中心・上に重ね物。ルーラー無移動

## 3. ソーストリマー

- 入口: クリップ dblclick（裁定 3）。トリマーモード中はカット外を薄く表示し、
  左右スライドで in/out を調整。解除は Esc / 再 dblclick / 他クリップ選択
- サムネイルは素材全体のフィルムストリップを 1 回だけ焼き、窓移動は CSS
  background-position のみで行う（トリム / スリップ操作で再焼成しない設計）

## 4. 受け入れの軸

- schema: schemas / edit-lint テスト全数 green
- 消費: in/out 付き sfx の出力音声を ffprobe / 波形で実測（切り出し位置・尺一致）。
  preview 側も同 fixture で聴感 + 実測。クランプ動作の実測
- UI: 実機で (a) 配置原則どおりの表示 (b) 音声トラック追加とアイテム移動が edit.json に
  書き戻る (c) 音源バー端ドラッグで in/out 書き戻り・リロード後保持 (d) トリマーの
  表示・調整が機能 (e) 既存トラック UI・z 順の無退行

## 5. §2 追記 — sfx フェード（audio-clip-fades, 2026-08-18・オーナー裁定「クリップ主義」T2）

BGM をクリップ化する裁定（内部リポ `akari-video-internal` の該当タスク）に伴い、
「音楽をクリップ（audio.sfx[]）として置いても BGM ベッドと同じフェード表現ができる」を
満たすため、`sfxItem` に optional の `fade_in` / `fade_out`（秒・0 以上）を追加のみ拡張する
（`version` 不変・`contract-2026-07-17-data-contract-versioning.md` の原則に従う）。

### schema

- `sfxItem.fade_in` / `fade_out`: 秒・省略時 0（フェードなし）。`audio.bgm.fadeIn` /
  `fadeOut`（camelCase）とは異なり **snake_case**（既存の `gain_db` と同じ命名系列）
- フェード対象はこのクリップの実効再生窓 `[t, t + 実効尺)`。実効尺は §2 の `[in, out)` が
  既知なら `out − in`、`in`/`out` 省略時は素材尺（消費側が実尺を解決できた場合のみ）
- クランプ規則は `audio.bgm.fadeIn`/`fadeOut` と同型: `fade_in`/`fade_out` それぞれ独立に
  実効尺の半分までクランプ（render-cut が実装、edit-lint は `in`/`out` が両方既知のときだけ
  警告できる — lint は ffprobe を持たないため実尺越えの検知は消費側の責務、という §2 本文の
  既存原則をフェードにもそのまま適用）

### 消費（render-cut + preview 3 面）

- render-cut: sfx の afade を volume の直後・adelay の直前に挿入する（adelay 後だと
  `st=0` が delay 由来の無音区間を指してしまうため）。`in`/`out` 併用時は atrim/asetpts で
  尺をリセットした後の実効尺基準で afade を計算する
- シェルプレビュー（akari-preview）: sfx は 1 回きりの `BufferSourceNode` 再生のため、
  bgm の毎 tick 再計算（fadeMultiplier）ではなく、schedule 時点で
  `gain.gain.setValueAtTime`/`linearRampToValueAtTime` によるブレークポイント列を組む
  （`sfxFadeGainSchedule`、シーク再開時は経過秒からブレークポイントを再構成）
- Web UI（preview-server）: bgm と同じ毎 tick 再計算方式。ただしこの層は現状 sfx の
  `in`/`out` トリム自体を未実装のため、フェードの実効尺は常にデコード済み素材全長を使う
  （トリム実装時に合わせて見直す）

### インスペクター

- akari-annotations: sfx 選択時に bgm と同じ「フェード」タブ（`fadeIn`/`fadeOut` ノブ）を出す。
  ducking は bgm 概念のため sfx には出さない
- 正本は `packages/edit-store`（edit.json テキスト手術）だが、本追記の実装レーン
  （task 2026-08-18-audio-clip-fades）のファイル境界が `packages/edit-store` を含まないため、
  書き戻りは `apps/shell/extensions/akari-annotations/src/common/sfx-fade-store.ts` に
  境界内で完結する独立実装として置いた（`updateArrayElementByIndex` 等 edit-store の
  export 済みユーティリティは再利用）。将来 edit-store 側の担当タスクが正本へ統合してよい
