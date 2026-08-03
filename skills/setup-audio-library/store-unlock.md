# store-unlock — 購入済み宣言パックの導入

ユーザーが「購入した素材をセットアップして」「宣言パックを入れて」と言ったとき、
または AKARI Store で音源系の購入がある状態でライブラリ整備を頼まれたときの工程。
機械的な部分はすべて `akari store` CLI が持っている — このリーフは配線と検証だけを行う。

## 手順

1. **接続確認**: `akari store status` を実行する
   - 未接続なら `akari store connect` をユーザーに案内する（ブラウザが開き、
     ストアにログイン → 承認ボタンで完了。トークンの手動コピペは不要）
   - 接続済みなら購入済み一覧が出る。`sounds-declaration-pack` が無ければ
     ストアの商品ページを案内して終了（勝手に購入させない）
2. **導入**: `akari store install sounds-declaration-pack`
   - `~/.akari/assets/audio/declarations.json` に置かれる（既存があれば自動退避される）
3. **検証**（完了主張の前に必ず）:
   - `declarations.json` が JSON として読めること
   - 収録トラック数がパックの表示と一致すること（`node -e` で `Object.keys(...).length`）
   - 各エントリに `bpm` / `beat_offset_s` / `hit_points` / `sections` があること
4. **報告**: 収録曲数と「BGM 自動提案（suggest-bgm）が実測 BPM・サビ頭出し付きで
   優先提案するようになった」ことを伝える

## してはいけないこと

- declarations.json を手で書き換えない（宣言データの正本はストア配布物。
  訂正は次版のパックで届く）
- 未購入ユーザーに向けて宣言データの中身（実測値）を貼らない（有料レイヤの漏洩防止）
