# package resolver の新版選択再現

`node skills/manage-connections/dev-fixtures/resolve-packages-newest/reproduce.mjs` をリポジトリのルートから実行する。Node.js、git、tar を使う。一時 HOME に旧 CLI（タグ v0.1.40）の最小 packages、shim が指す現行版の一時 Resources を作り、プロジェクトへコピーした 2 スキルを子プロセスから呼ぶ。終了時に一時ファイルは削除する。

期待出力は次の形。現行版の番号はその時点の `packages/akari-launcher/package.json` に従う。両条件で Resources 側が選ばれ、`install-root.mjs` と一致する。

```text
old launcher: 0.1.40; desktop launcher: 0.1.81
old CLI + desktop | manage-connections | creator-root/src/index.mjs | selected=$TMP/Resources/packages/creator-root/src/index.mjs | install-root=$TMP/Resources/packages/creator-root/src/index.mjs | match=yes
old CLI + desktop | manage-connections | media-bin/src/index.mjs | selected=$TMP/Resources/packages/media-bin/src/index.mjs | install-root=$TMP/Resources/packages/media-bin/src/index.mjs | match=yes
old CLI + desktop | analyze-footage | creator-root/src/index.mjs | selected=$TMP/Resources/packages/creator-root/src/index.mjs | install-root=$TMP/Resources/packages/creator-root/src/index.mjs | match=yes
old CLI + desktop | analyze-footage | media-bin/src/index.mjs | selected=$TMP/Resources/packages/media-bin/src/index.mjs | install-root=$TMP/Resources/packages/media-bin/src/index.mjs | match=yes
desktop only | manage-connections | creator-root/src/index.mjs | selected=$TMP/Resources/packages/creator-root/src/index.mjs | install-root=$TMP/Resources/packages/creator-root/src/index.mjs | match=yes
desktop only | manage-connections | media-bin/src/index.mjs | selected=$TMP/Resources/packages/media-bin/src/index.mjs | install-root=$TMP/Resources/packages/media-bin/src/index.mjs | match=yes
desktop only | analyze-footage | creator-root/src/index.mjs | selected=$TMP/Resources/packages/creator-root/src/index.mjs | install-root=$TMP/Resources/packages/creator-root/src/index.mjs | match=yes
desktop only | analyze-footage | media-bin/src/index.mjs | selected=$TMP/Resources/packages/media-bin/src/index.mjs | install-root=$TMP/Resources/packages/media-bin/src/index.mjs | match=yes
```
