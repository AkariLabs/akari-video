---
description: テスト用フィクスチャアバター（voice-only）。schema/validate-avatar.mjs の renditions:[] 正常系検証にのみ使う。
when_to_use: validate-avatar.mjs のテストフィクスチャとして使う。実案件では使わない。
---

# Test Voice-Only Avatar

段階読み出し契約 L1（AVATAR.md）のテスト用ドラフト。rendition を持たない「声のみ」アバター
（S2 改訂 2026-07-26・renditions minItems 1→0 緩和）の正常系を確認するためのフィクスチャ。

## ペルソナ要約

- 一人称: わたし
- トーン: 親しみ
- 話し口調: テスト用フィクスチャの口調
- 語尾・口癖: なし
- エネルギー: 50（0-100。ドパ度とは別軸）
- NG: なし
- 既定配役: narrator

## 能力一覧

renditions なし（voice-only）。

## L2 案内

- 音声詳細: `voice/voice.json`
- rendition 詳細: なし（本アバターは voice-only）
