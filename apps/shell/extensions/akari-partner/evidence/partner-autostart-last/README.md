# partner-autostart-last — 前回のパートナーの自動起動の検証手順（2026-10-08）

対象: 設定「起動したら前回のパートナーを開く」（`akari.partner.reopenLast`・既定オン）。これまで画面にスイッチだけがあり、読むコードが無かった。
プロジェクトを開くと、そのプロジェクトで前回使っていたパートナー（履歴が無ければアプリで最後に使ったパートナー）が、何も押さずに右パネルへ開く。
記録物（スクリーンショット・ログ）はこのリポには置かない。ここには手順と観察スクリプトだけを置く。

## 仕組み

- 覚える場所: プロジェクト単位 = ワークスペースの保存領域の `akari.partner.last`（`{ entryId, at }`。利用者がタブを閉じたら `{ entryId: null, closedAt }`）。
  アプリ単位 = 既存の接続マーカー
- いつ: レイアウトの拾い直し（`restorePartnerTerminals`）の後に 1 回。起動フックは待たせない
- やらないこと: 未導入のときの同意ダイアログ・取得、フォーカスの横取り、プロジェクトを開いていないときの起動
- 判定は `src/common/partner-autostart.ts` の純粋関数

## L1（dev shell + CDP。ホームと設定フォルダは隔離）

起動フラグ `--disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding` を付ける
（検証用ウィンドウが裏に回ると埋め込みの renderer が背景優先度に落ち、混んだ機械で読み込みが進まないため）。
`AKARI_SHELL_DIR=<apps/shell> AKARI_CDP_PORT=<port> node cdp-observe.cjs <秒> <待つタブ名>` は何も押さずに右パネルの状態を読む。

| 項目 | 手順 | 実測（2026-10-08・Windows 11） |
|---|---|---|
| 履歴の無いプロジェクト | 新しいプロファイルで未使用のフォルダを開く（接続マーカーは DeepSeek） | 何も押さずに DeepSeek Harness が開く。ダイアログ無し・フォーカスは元のまま |
| 再起動 | 終了 → 同じプロジェクトで起動、を 2 回 | 2 回とも開く（終了時の破棄は「閉じた」扱いにならない） |
| 自分で閉じた | タブを閉じる → 再起動 | 開かない（`akari.partner.last.entryId` が null）。dsh 0 |
| 設定オフ | `akari.partner.reopenLast: false` で起動 → 設定を消して起動 | オフでは開かない / 既定に戻すと開く |
| CLI | opencode CLI を「始める」→ 再起動を 2 回 | 2 回とも PTY タブが開き opencode のプロセス 1 |
| 未導入 | 前回が opencode CLI のプロジェクトで、opencode を見えなくして起動 | ダイアログ無し・取得無し・失敗カード無し。行に「前回のパートナー（opencode CLI）は未導入です」 |
| 起動フック | 起動ログ | 「layout initialization timed out」の警告 0 件 |

起動から開くまでは 10〜35 秒（大半は CLI の確認。機械の混み具合で伸びる）。

## 申し送り

- 接続マーカーは作業画面の読み込み成功前に書かれるため、読み込みに失敗し続けるプロジェクトでも毎回 1 回は試す
- 拡張形（Claude Code 拡張 / Codex 拡張）は対象外（レイアウト復元に任せる）
- 設定オフは自動起動だけを止める。同じ起動の中で生き残った PTY タブの拾い直しは従来どおり
