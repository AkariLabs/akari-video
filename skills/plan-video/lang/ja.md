# 日本語圏の企画・競合調査

## 日本語 SNS 事情（元: competitor.md §4）

## 4. 日本語 SNS 事情（必須調査軸）

`target.japan_sns` は空にできない必須フィールドである（ハードルール）。次を埋める。

- `platforms`: ターゲット層が実際に使っているプラットフォーム（例: X、Instagram、TikTok、YouTube Shorts、LINE VOOM 等）
- `notes`: 日本語圏特有の傾向（プラットフォームごとの温度感、季節性、短尺再編集の需要など）。**無償手段で確認できる範囲**（公開トレンドページ、プラットフォーム公式の急上昇一覧、既存の一般知識）で埋め、有償のソーシャルリスニングツールは [setup-connections](../../setup-connections/SKILL.md) の承認ゲートを経てオプトインで使う。

無償手段でも一切確認できなかった場合は、`notes` に「無償手段で確認できず、理由は〜」と正直に書く。空文字・省略は validate-research-plan.mjs でエラーになる。
