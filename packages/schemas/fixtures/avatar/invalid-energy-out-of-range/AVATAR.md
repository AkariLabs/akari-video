---
description: テスト用フィクスチャアバター。schema/validate-avatar.mjs の正常系検証にのみ使う。
when_to_use: validate-avatar.mjs のテストフィクスチャとして使う。実案件では使わない。
---

# Test Avatar

段階読み出し契約 L1（AVATAR.md）のテスト用ドラフト。

## ペルソナ要約

- 一人称: わたし
- トーン: 親しみ
- 話し口調: テスト用フィクスチャの口調
- 語尾・口癖: 〜だよ
- エネルギー: 50（0-100。ドパ度とは別軸）
- NG: テストNG語
- 既定配役: explainer

## 能力一覧

| rendition | kind | 口パク | 表情 | framing |
|---|---|---|---|---|
| 2d-bustup | 2d | あり | neutral, happy | bustup |
| 2d-fullbody | 2d | あり | neutral, happy | fullbody |

## L2 案内

- 音声詳細: `voice/voice.json`
- rendition 詳細（アセット索引）: `renditions/<id>/rendition.json`
