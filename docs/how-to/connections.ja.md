[English](./connections.md) | **日本語**

# 接続と API キー

外部サービス（クラウド文字起こし・TTS・生成系 API・SNS 連携）の接続は
`setup-connections` スキルが一元管理します。

## 原則

- **ローカル完結の範囲は接続なしで使える** — プロキシ生成・whisper.cpp 文字起こし・
  編集・lint・書き出しは外部接続不要
- **API キーはチャットに出さない** — キーの実体は
  <!-- F paths.credentials -->`~/.akari/credentials.env`<!-- /F -->（プロジェクト外）に置き、
  connections レジストリは**参照**だけを持つ
- **旧い場所のキーも読める** — まだ移していないキーは旧い場所から読みます。
  新しく登録するキーは <!-- F paths.credentials -->`~/.akari/credentials.env`<!-- /F --> に保存します。
  旧い場所は <!-- F paths.credentials.legacy -->`~/.config/akari-video/credentials.env`<!-- /F --> で、キーがどちらにあるかは
  `akari doctor` に出ます
- **作業場が既定、プロジェクトは上書き** — 既定レジストリは
  `<creator-root>/.akari/connections.json` に置きます。プロジェクトの
  `.akari/connections.json` は任意のオーバーレイで、作業場レジストリが無ければ
  AKARI Video は製品同梱の既定レジストリへフォールバックします
- **有償実行は承認ゲートを通る** — コスト承認ポリシーに従い、
  課金が発生する実行の前に必ず確認が入る

## 状態を確認する（doctor）

**頼み方**: 「接続状態を見せて」「doctor かけて」

読み取り専用の診断が走り、どのプロバイダが使える状態か・何が未設定かを
レポート（`connections-report.html`）で確認できます。キー値は表示されません。
doctor は各 provider の結果を由来レイヤー（project / workspace / 適切な default の書き戻し先）
だけへ書き戻すため、プロジェクト内のコピーが作業場設定から乖離することを防ぎます。

## キーを登録する

**頼み方**: 「◯◯の API キーを設定したい」

エージェントが `credentials.env` への記入手順を案内し、登録後に doctor で疎通を確認します。

アプリからも登録できます。**設定 › つなぐ** に、AKARI の道具と素材を作るサービス
（画像・映像の生成、読み上げ、文字起こし、3D の設定〈v1.5.0 では「3D レシピ」〉）が並びます。カードごとに
「使える」「鍵が必要」「準備中」が分かり、「鍵を追加」でこのパソコンの資格情報ファイルに
保存されます。同じ画面で、生成サービスを使う順番と、失敗したときに次のサービスへ
自動で切り替えるか（既定はオフ）も決められます。キーをチャットに貼る必要はありません。
ターミナルからは `akari connect list [--json]` で同じ状態を見られ、
`akari connect exec <id> -- <コマンド>` はそのサービスの鍵を子プロセスにだけ渡して実行します。

## 許可するモデルと既定を決める

文字起こし・TTS などバックエンドが複数あるものは、`connections.json` で
**許可するモデル**と**既定**を決められます。許可された中からどのモデルをその仕事に使うかは
制作スキルが決めます（モデルの台帳と好みを読みます）。既定は「文字起こしはローカル whisper を
既定にして」のように発話でも変更できます。

## パートナーエージェント（アプリの接続ボタン）

プロジェクトを開くと、そのプロジェクトで前回使った CLI または Web パートナーが自動で開きます。
履歴がなければアプリ全体で最後に使ったパートナーを選びます。
止めるには「設定 > パートナー > 起動したら前回のパートナーを開く」をオフにするか、タブを閉じてください。
未導入のパートナーは自動で導入せず、案内だけを表示します。
CLI 内で `/exit` などを実行しても「タブを閉じた」扱いにはならず、次回も自動で開きます。止めるにはタブを閉じるか設定をオフにしてください。

Claude Code と Codex が最初のおすすめで、ほかは使い慣れているものがあるときのための選択肢です。
パートナーの CLI はアプリから更新もできます。新しい版があると、**設定 › パートナー** の
該当行に「アップデート」ボタンが出ます。自分で更新する CLI はその旨が表示され、
AKARI の外（Homebrew・npm など）で入れたものは、入れた方法で更新してください。

AKARI チャット（お試し）は既定では隠れています。使うには 設定 › パートナー の
「AKARI チャット（お試し）を表示する」をオンにします。

デスクトップシェルの接続ボタンはパートナーカタログを開きます。
現在のカタログには、PTY タブで動く **CLI 11 種** — Claude Code・Codex・
opencode・Command Code・Pi・Devin・Copilot・Cursor（`cursor-agent`）・Antigravity・Grok Build・Muse Code —
と Claude Code / Codex のエディタ拡張 2 種、Web パートナーの DeepSeek Harness があります。
Command Code は Node.js 22 以上が必要で、未導入時は公式の
`npm install -g command-code` パッケージ経路をシェルが使います。
Muse Code は公式のインストールスクリプトで導入します（Windows の導入先は
`%LOCALAPPDATA%\Programs\muse`）。初回の起動では Muse Code が作業フォルダを信頼するかを尋ね、
信頼するとプロジェクトのスキルを読み込みます。Windows では、初回に Muse Code が
サンドボックスの準備のため管理者の確認（ユーザーアカウント制御）を出します。
確認が出ている間、タブには何も表示されません。
DeepSeek Harness は npm 経路（`npm install -g @deepseek-ai/dsh`）で導入し、
ブラウザを開かず右パネルの作業画面に表示します。作業対象は開いている
プロジェクトのフォルダです。OpenCode Go のログインまたは DeepSeek の
API キーを自動検出して接続先を選びます。
プロジェクトを開き直すと、最初に決まるポートが空いていれば、DeepSeek はそのプロジェクトで最後に開いていた会話に戻ります。
そのポートが使用中で別の番号になった回は、前回の会話に戻らない場合があります。
以前のバージョンで作った会話は、初回だけ入力欄からプロジェクトのフォルダを選び直す必要がある場合があります。
DeepSeek の作業画面はアプリの配色（暗い・明るい・システム）に合わせ、
アプリの配色変更にもその場で追従します。
DeepSeek の Settings で配色を明示的に選んだ場合はそちらを優先し、
文字サイズなど DeepSeek 側の設定は変更しません。
カタログはデータ駆動
（`partner-catalog.json`）でリリースごとに増えるため、この一覧はスナップショットです。
どのパートナーから接続しても、最終的に同じ `.akari/` 配下のファイル契約に収束します。

### パートナーの権限

「設定 > パートナー > パートナーの権限」の既定は**自動（おすすめ）**です。
この設定は利用者ごとに保存され、プロジェクトの設定ファイルからは変更できません。
**毎回確認**は各ツールの既定の権限動作、**すべて許可**は確認を省き、対応する
ツールではサンドボックスも解除します。自動では Claude Code と Grok の `auto`、
Codex と Cursor の自動審査、Devin の `smart`、Muse Code の `on-request`（自動審査）を使います。
Muse Code は既定が自動審査（`on-request`）なので、毎回確認でも自動と同じ動きになります。
Muse Code の「すべて許可」には `--yolo` を渡します。起動時の自動モードが無い
Copilot・Antigravity・Command Code・Pi は、自動でもすべて許可の引数で起動します。
Pi には承認の仕組みが無いため、どのモードでもタブには「すべて許可で起動」と表示されます。
opencode は自動ではツールの既定動作を使います。DeepSeek Harness は自動と毎回確認で
Workspace Write、すべて許可で Full access です。CLI の `--help` に指定フラグ、または
モードの指定値が無い場合はそのフラグを付けず、ツールの既定動作で起動します。
パートナーのタブ名には実際に適用したモードを表示し、権限オプションを付けなかった場合は
「ツールの既定で起動」と表示します。起動中の DeepSeek Harness の画面を再利用するときは、
先に起動したモードを維持します。Claude Code・Codex のエディタ拡張形は各拡張の設定に従います。

## 道具の手順と接続

「やりたいこと」と「どのサービスで叩くか」を 2 つの層に分けています。

- **道具の手順**（`akari-recipe`）: 30 秒の BGM を作る・商品を 3D で回す、のような場面です。
  サービスの名前は書かず、要る**能力**（`music-generation`・`image-generation`・
  `video-generation`・`speech-synthesis`・`3d-render`・`transcription`・`publish`）だけを書きます。
  アプリでは、3D のものは「3D の設定」と表示されます（v1.5.0 では「3D レシピ」）。
- **接続**: fal・ElevenLabs・Blender のようなサービスやソフトです。`connections.json` の
  1 件に `provides`（持つ能力）・`adapter`（`official-api` / `local` / `custom`）・
  `terms`（規約を確認した日と商用利用の可否）を宣言できます。

サービスを差し替えても、手順は変わりません。

```sh
akari recipe list [--json] [--project <dir>]
akari recipe plan <id> [--project <dir>] [--json]
```

`list` は棚にある手順（`~/.akari/tool-recipes/<id>/recipe.json`、そのプロジェクトだけなら
`<project>/recipes/<id>/recipe.json`）を並べます。`plan` は、要る能力ごとに使える接続の候補・
認証の状態・止まる**門**（`paid` / `external-send` / `license`。`terms` が確認されていない接続は
`license` で止まります）を出します。`plan` は報告するだけで、何も実行しません。実行はエージェントが
対応するスキルとコマンドで行い、できたファイルはどの手順・どの接続で作ったかとともに
プロジェクトの目録に記録されます。

生成モデルの一覧と価格は [生成モデル](../guides/generation-models.ja.md) にあります。

## AKARI アカウントを連携する（Lab）

`akari store connect` で AKARI アカウントを連携すると、無料の素材パックと Lab で購入した素材が
使えるようになります。ブラウザが開いて確認コードが出るので、承認すれば完了です。
ブラウザを開かないなら `--no-open`、手動なら `--token akst_…` を付けます。
連携の状態は `akari store status`、解除は `akari store disconnect` です。アプリからも案内されます。

## コスト承認ポリシー

おまかせ度（intake.json の `autonomy`）とは独立に、**課金と外部送信**については
`connections.json` のポリシーが優先されます。full-auto で編集を任せていても、
有償生成の前には確認が入る、という構えです。

## 関連

- 最初のセットアップ → [Getting Started](../getting-started.ja.md)
- ナレーション生成の有償 / 無償 → [ナレーションを付ける](../guides/narration.ja.md)

<!-- BEGIN GENERATED facts:stamp -->
この文書は AKARI Video v1.5.1（2026-10-19 公開）時点の説明です。
<!-- END GENERATED facts:stamp -->
