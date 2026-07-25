# ドロップフォルダ監視・登録

[candidate-list.md](candidate-list.md) でユーザーが実際にダウンロードしたあと、
このリーフでファイル単位の照合・登録を行う。

## 1. ドロップフォルダの場所

既定は `~/.akari/audio-drop/`（2026-07-25 第三裁定でプロジェクト外置き場所の基底を
`~/.akari/` に統一。`~/.config/akari-video/credentials.env` や
`~/.config/akari-video/voice-profiles/` は認証情報の置き場として別論点のため現状維持
— いずれも user レベル・git 管理外の置き場である点は共通）。
ユーザーがブラウザでダウンロードしたファイルを、そのままこのフォルダへ移動・保存して
もらう。`~/Downloads` を直接監視しない（無関係なダウンロードと混在し誤登録するリスクを
避けるため、音源専用の場所を切る）。

## 2. まず plan-only で確認する（既定・安全）

```sh
node packages/audio-library-setup/bin/register-drop-folder.mjs \
  --drop-dir ~/.akari/audio-drop
```

`--apply` を付けない限り**ファイルは一切動かず、catalog にも一切書き込まない**。
標準出力の JSON（`matched_candidates` / `quarantined`）をユーザーに見せ、想定通りかを
確認する。

## 3. 問題なければ `--apply` で実行する

```sh
node packages/audio-library-setup/bin/register-drop-folder.mjs \
  --drop-dir ~/.akari/audio-drop --apply
```

- **一致したファイル**: `~/.akari/assets/audio/<candidate-id>/` （user スコープ、
  [setup-library/fetch-and-validate.md](../setup-library/fetch-and-validate.md) と同じ
  スコープ階層）へ実体を移動し、`meta.json`（実体あり・`remote` キーなし）を書く。
  同時に `catalog/audio/<candidate-id>/meta.json`（`remote: true` の参照 SSOT）が
  無ければ作る。**既にあれば上書きしない**（ハードルール 6）。
  `ffmpeg` があれば波形 `preview.png` を生成する（無ければ生成せず理由をログに残す。
  実物と違う mock を作らない）。
- **一致しなかったファイル**: ドロップフォルダ内の `_quarantine/` へ移動し、
  `_quarantine/manifest.json` に「出典不明」として記録する（audio-import レーンと同じ
  規律）。ファイル名からの推測登録はしない。
- **複数候補に一致してしまう場合**: 一意に決定できないため隔離する（推測しない）。

再実行は idempotent（同名ファイルは二重移動しない・`manifest.json` に重複エントリを
増やさない）。

## 4. マッチングの限界（正直に伝える）

ファイル名照合が機能するのは、候補データに `expected_filenames` /
`filename_patterns` が入っている「個別ファイル名まで特定できた候補」（効果音ラボ・
OtoLogic の一部）だけ。DOVA-SYNDROME・Pixabay・Freesound のタグ/検索ページ候補は
ユーザーが保存時に付けるファイル名が予測できないため、自動照合できず `_quarantine/`
に入る。この場合は audio-import レーンの前例にならい、`_quarantine/manifest.json` を
見ながらユーザーに出典を確認し、`catalog/audio/candidates.json` の該当候補に
`expected_filenames` を追記するか、手で `catalog/audio/<id>/meta.json` を作る。

## 5. 検証

```sh
node packages/schemas/bin/validate-asset.mjs ~/.akari/assets/audio/<candidate-id>
```

失敗したら理由（大抵は `preview.png` 未生成 = ffmpeg 不在）をそのまま報告する。

## よくある間違い

- `--apply` を付けずに「登録した」と報告する（plan-only は何も変更しない）。
- 複数候補に一致するファイルをどちらかに決め打ちで登録する。
- 既存の `catalog/audio/<id>/meta.json` を上書きする。
- `_quarantine/` の存在を無視し、出典不明ファイルを放置したまま完了報告する。
