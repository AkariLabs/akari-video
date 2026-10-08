# 通知の札とベル

Theia の通知マネージャを差し替え、右下にいる時間、停止、未読を一つの時計で管理します。時間切れでは札だけをベルへ移し、一覧とボタンの結果を保持します。描画とステータスバーのベルを同じ状態に接続し、アイコン付きの更新通知も同じ札の意匠へ揃えました。

| 目印 | 意味 |
|---|---|
| `.akari-notification-row[data-kind="info\|warning\|error\|progress"]` | 札と一覧行の種類 |
| `.theia-notifications-overlay .akari-notification-row[data-message-id][data-kind][data-exit="absorbing"]` | 同じ DOM 要素のまま流れから外れ、手前でベルへ吸い込まれている札。終了まで overlay の下に残る |
| `.theia-notifications-overlay .akari-notification-row[data-message-id][data-kind][data-exit="dismissing"]` | 同じ DOM 要素のまま流れから外れ、手前でフェードしている札。終了まで overlay の下に残る |
| `.akari-notification-ring`, `.akari-ring-fg` | 残り時間の輪と前景線 |
| `#status-bar-theia-notification-center .codicon` | 32×24 のベル領域の中央に置く 15px の絵 |
| `#status-bar-theia-notification-center .akari-notification-badge` | ベル右上の未読数 |
| `#status-bar-theia-notification-center[data-unread-error="true"]` | 未読に error があるベル |
| `.akari-bell-ripple`, `.akari-bell-ring` | 吸い込み完了時の輪とベルの動き |

## 再現

隔離したホームで dev shell を `--remote-debugging-port=<PORT>` 付きで起動します。scaffold 済みの AKARI プロジェクトを開き、`node l1-toast-into-bell.mjs --port <PORT> --out <出力先> --akari-home <隔離した AKARI_HOME> [--case 1,2,…]` を実行します。スクリーンショットと計測結果は指定した出力先に保存します。
