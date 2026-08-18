[English](./faq.md) | **日本語**

# FAQ・トラブルシューティング

## 全般

**Q. アプリが無いと使えない？**
いいえ。headless-first 設計なので、opencode や Claude Code だけで企画から書き出しまで完結します。
アプリ（Theia シェル）は「確認して直す場所」で、現在移行中です。

**Q. 完全自動で最後まで走らせられる？**
`intake.json` の `autonomy: full-auto` で節目の承認を自動化できます。
ただし**課金と外部送信**だけは `connections.json` のコスト承認ポリシーが優先されます。

**Q. 外部 API なしでどこまでできる？**
プロキシ生成・文字起こし（whisper.cpp / macOS SpeechAnalyzer）・編集・テロップ・
VOICEVOX ナレーション・lint・書き出しまで、ローカル無償で一周できます。

**Q. Windows は？**
Windows（WSL2 含む）に対応しています。詳細は [dev/windows-build.md](../dev/windows-build.md) を参照。

## 編集・データ

**Q. edit.json を手で編集していい？**
構いません。テキストなので直接編集も git 管理もできます。編集後は
[edit-lint](../guides/review-and-fix.ja.md) をかけてください。

**Q. カットを並び替えたら字幕や注釈がズレない？**
ズレません。時刻は常に (素材, 素材の原本秒) で永続化する規約で、
タイムライン位置に依存しません。

**Q. 前の状態に戻したい**
プロジェクトを git 管理していれば、セーブデータはすべてテキストなので
`git diff` / revert がそのまま「編集履歴」になります。

## エラー対処

**Q. edit-lint が FAIL する**
`.akari/reports/edit-lint-report.html` に件数と理由が出ます。
「lint の FAIL を直して」で対応まで頼めます。FAIL のままでは書き出しに進めません。

**Q. render-cut の verify が FAIL する**
`.akari/reports/render-report.html` の stderr 要約を確認してください。
「render の失敗を調べて」で診断から頼めます。

**Q. ffmpeg / whisper / Blender が無いと言われる**
各スキルが検出時に導入手順を案内します。まとめて確認したいときは
「セットアップの状態を確認して」（setup-library のツールチェック）。

**Q. API キーを設定したのに使えない**
「doctor かけて」で疎通診断を。キーの実体は `~/.config/akari-video/credentials.env`、
プロジェクト内には参照だけ、が正しい配置です。

**Q. `apps/shell` を自前ビルドした後、`npm start` がウィンドウを出さずに無言終了する（Apple Silicon）**
`apps/shell` のビルドが Electron.app 内蔵の ffmpeg ライブラリを差し替える際にコード署名を壊すことがあります。
`npm run build` は完了後に自動でアドホック再署名（`postbuild`）するため通常は発生しませんが、
再発した場合は手動で次を実行してください: `codesign --force --deep --sign - node_modules/electron/dist/Electron.app`。

## 困ったら

再現手順とともに [GitHub Issues](https://github.com/AkariLabs/akari-video/issues) へ。
`.akari/reports/` 配下のレポート HTML を添えてもらえると原因究明が早くなります。
