---
name: export-nle
description: "BETA（実 NLE 取り込み未確認）: edit.json を Final Cut Pro / DaVinci Resolve（FCPXML）・Premiere Pro（FCP7 XML）・SRT 字幕へ書き出す。「Premiere で開きたい」「Final Cut に持っていきたい」「Resolve 用に書き出して」「SRT がほしい」で使う。移せないフィールドは dropped[] で必ず報告する。"
---

# 編集データを他社 NLE へ書き出す（BETA）

> **Language**: Respond in the user's language — 対話・質問・承認確認・レポートはユーザーの使用言語に合わせる（例: 英語で話しかけられたら英語で応答する）。

> ⚠ **BETA — 実装のみ・実アプリでの動作未確認**
> この機能は「実装だけはしたが、生成物を実際の Final Cut Pro / DaVinci Resolve /
> Premiere Pro に取り込む検証はまだ行っていない」段階で公開している。生成された
> XML が取り込めない・ずれる等の報告は歓迎（issue へ）。ユーザーへ結果を渡すときは
> **必ずこのベータ地位を伝える**こと。

## これは何か

AKARI Video のセーブデータ SSOT（edit.json）には lock-in がない、という証明としての
**片道書き出し**。最後の仕上げをプロツールでやりたい人への出口を用意する。

| 形式 | 対象 | ファイル |
|---|---|---|
| FCPXML 1.11 | Final Cut Pro / DaVinci Resolve | `<project>.fcpxml` |
| FCP7 XML (xmeml v5) | Premiere Pro | `<project>.premiere.xml` |
| SRT | 全 NLE 共通の字幕サイドカー | `<project>.srt`（captions.json があるときのみ） |

**逆方向（NLE で編集した結果を edit.json へ戻す）は非対応**。スコープに含めない。

## ハードルール

1. **決定的であること**: 同一入力 → 同一出力。LLM 判断・乱数・現在時刻を出力に混ぜない
2. **外部 npm 依存ゼロ**（ffprobe は media-bin 経由の本体直叩きのみ）
3. **edit.json を書き換えない**。書き出しは読み取り専用の変換
4. **黙って落とさない**: 交換形式に移せないフィールド（ducking / master / LUT /
   chroma_key / direction 等）は `export-report.json` の `dropped[]` に全件列挙する
5. **ベータ地位の明示**: ユーザーへの報告に「実 NLE での取り込みは未確認」を必ず含める。
   検証済みかのように振る舞わない

## 実行手順

1. 対象プロジェクト（edit.json のあるディレクトリ）に対して実行する。

   ```sh
   node packages/export-nle/bin/export-nle.mjs <project-root|edit.json>
   ```

   既定の出力先は `<project>/exports/nle/`。形式を絞るときは `--format fcpxml`（カンマ区切り可）、
   機械向け出力は `--json`、ffprobe を使わないときは `--no-probe`。

2. exit code を確認する。`0` は書き出し完了（warnings があっても成功）、`2` は入力・実行環境エラー。
3. `exports/nle/export-report.json` を読み、`dropped[]`（移らないフィールド）と `warnings[]`
   （プレースホルダ尺・近似など）をユーザーへの報告に含める。
4. メディアは**参照**で書かれる（絶対パスの file URL）。プロジェクトを移動・共有した場合は
   NLE 側の relink 機能で再接続が必要、と案内する。

## 何が移って何が移らないか（契約の要約）

正本: [contract-2026-08-01-export-nle-beta.md](../../docs/contract-2026-08-01-export-nle-beta.md)

- **移る**: cuts（at / track / in / out / speed / transform / opacity）、transition_out
  （dissolve は素直に、fade-black/white は cross dissolve 近似）、layers（アルファ付き mov は
  ただのクリップとして）、narration / sfx / bgm（配置 + gain。bgm はループ展開 + フェード）、
  beats / emphasis_words（マーカーへ退化）、captions（SRT のプレーンテキストへ）
- **移らない**（dropped[] で報告）: ducking、audio.master（loudnorm / denoise）、
  output.look（LUT）、chroma_key、direction、字幕スタイル（カラオケ演出・座布団）

## 非スコープ

- CapCut の draft 形式（非公式・暗号化進行中・バージョン更新で壊れる前提のため見送り。
  需要が出たら lab/ スパイクから）
- NLE からの逆輸入（インポート）
- 生成 XML の実アプリ取り込み検証の自動化（ベータ卒業の条件。手動検証の結果が集まってから設計する）
