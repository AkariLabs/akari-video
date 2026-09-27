# L1 node 結合

| モデル | 色 | 指定 MP4 尺 (秒) | 設定処理 ms | 実測処理 ms | 実 MP4 尺 (秒) | 候補 elapsed_s | queue_status の推移 |
|---|---|---:|---:|---:|---:|---:|---|
| fal:h3-i2v | red | 0.5 | 450 | 462 | 0.52 | 0.577 | IN_QUEUE → IN_PROGRESS → COMPLETED |
| fal:kling-v3-standard-i2v | green | 0.75 | 650 | 653 | 0.76 | 0.77 | IN_QUEUE → IN_PROGRESS → COMPLETED |
| fal:seedance-2.0-i2v | blue | 1 | 850 | 851 | 1 | 0.976 | IN_QUEUE → IN_PROGRESS → COMPLETED |

- 3 モデルのスタブ受信間隔: 4 ms。成功回は 3 候補。
- 失敗回: Kling を固定で失敗させ、2 候補完了・1 失敗。詳細の elapsed_s と queue_status は JSON に記録。
- approved 無し: スタブ受信 0。
- edit.json sha256: f45d29091b4e35d8a82631cabbb75f0c7b393cde13ccafe53a29e5b9fdc0f438 → f45d29091b4e35d8a82631cabbb75f0c7b393cde13ccafe53a29e5b9fdc0f438。
