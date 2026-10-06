# ベータ列車と更新フィード

`vX.Y.Z-beta.N`（N は 1 以上）をプレリリース、`vX.Y.Z` を安定版として出す。`-rc` などの別接尾辞は版整合ゲートで拒否する。shell / CLI / plugin の `version` はタグから `v` を除いた値にそろえる。npm publish はベータ時 `--tag beta`、安定版時 `--tag latest` を使う。通常のタグ push と workflow_dispatch の `dry_run` は同じタグ判定を通る。

`workflow_dispatch` の旧 `stable` 入力は互換用に残す。ベータタグで `stable: true` はエラー。安定タグでは `stable` の true / false のどちらでも安定版になる。`feed_only` は既存 Release の `isPrerelease` がタグ形と違えばエラーで止める。つまりベータタグで通常 Release、安定タグでプレリリース Release は配信しない。

## 配信ファイル

| updates Release のファイル | 読む人 | 書換条件 |
|---|---|---|
| `latest.json`, `latest.yml`, `latest-mac.yml` | 旧版を含む安定版設定 | 安定タグだけ |
| `stable.yml`, `stable-mac.yml` | 新しい Electron の安定版設定 | 安定タグだけ |
| `prerelease.json`, `prerelease.yml`, `prerelease-mac.yml` | プレリリースを選んだ人 | 現在のプレリリース系列より新しいか同じ版 |

書換対象は `scripts/release/feed-plan.mjs` の純粋関数が決め、`prepare-feed-upload.mjs` がそのファイルだけを作る。安定 `1.1.0` はベータ `1.1.0-beta.3` より新しいためプレリリース系列も更新する。一方、`1.2.0-beta.1` の後の `1.1.1` は安定系列だけを更新する。既存 `prerelease.json` は updates Release から取得する。無ければ初回として書き、存在して壊れていれば失敗させる。古い版の再実行でフィードを巻き戻さない。

`latest.*` を安定版専用にするのは、旧クライアント（≤1.0.3）がこの名前を読むため。移行時には安定版の `feed_only` を先に実行して `latest.*` を安定版で初期化し、その後ベータを配信する。過去の安定タグの Release が旧運用によりプレリリース扱いなら、Release 側のフラグを安定版へ直してから `feed_only` を実行する（タグ形との不一致は意図的に拒否する）。

## ビルド時の版

electron-builder 26 の generic provider は版に `-beta.N` があると channel を `beta` と検出し、`beta.yml` / `beta-mac.yml` を出す。release.yml はビルド時に `detectUpdateChannel=false` を渡し、入力成果物を `latest.yml` / `latest-mac.yml` に固定する。配信側の名前への複製は `prepare-feed-upload.mjs` が行う。

macOS の `CFBundleShortVersionString` と `CFBundleVersion` には数字 3 組の本体版を設定する。プレリリース順序は更新メタデータの semver で判断する。NSIS の `VIProductVersion` は electron-builder が `getVersionInWeirdWindowsForm()` で数値 4 組に変換する。`ProductVersion` と `FileVersion` の表示文字列にはベータ版名を保持できる。

## 受け取る版

`~/.akari/update-preferences.json` の channel は明示的な `prerelease` だけがベータを含む。未設定・破損・それ以外は `stable`。CLI とホームは同じ `update-check.json` を使い、取得元 URL を `feed_url` に記録する。設定切替後に取得元が違うキャッシュは表示しない。古いキャッシュに取得元が無くても、安定版設定では `-` のある版を除外する。`AKARI_UPDATE_FEED_URL` は完全上書きだが、この安定版ガードは外さない。
