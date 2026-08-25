# Transition first-class L1 evidence

実機 Electron + CDP で、実素材をコピーした 2 cut / 1 秒 overlap の v2 fixture を開く。
窓内 1.1 / 1.5 / 1.9 秒と窓後 2.1 秒で、入れ子 webview の実 DOM を採取する。

実行:

```sh
cd apps/shell/extensions/akari-preview/evidence/transition-first-class-l1
./scripts/run-l1.sh <fieldtest の 4 秒以上ある mp4>
```

判定:

- dissolve: 3 時点で 2 video が `display:block` で共存し、opacity が 0.9/0.1 → 0.5/0.5 → 0.1/0.9
- 窓へ入る前: incoming video が非表示のまま `readyState >= 1` となり、source 先頭へ prime 済み
- fade-black / fade-white: 非対称式 `clamp01(min(p/0.18, (1-p)/0.7))` により、p=0.1 / 0.5 / 0.9 の plate opacity が約 0.556 / 0.714 / 0.143、背景色が黒 / 白
- reveal-down / reveal-up: zSwap で incoming を下敷きにし、outgoing が前面のまま中点で高さの 50% ぶん translateY して抜ける
- 全種: incoming source 時刻が 2.1 / 2.5 / 2.9 秒、窓後の primary source 時刻が 3.1 秒
- 音: outgoing / incoming volume を `1-p` / `p` にし、二重無減衰を避ける
- workspace は正規パスに置く（macOS の `$TMPDIR` はシンボリックリンクなので `pwd -P` で解決する）

各種の JSON は観測値、PNG は中点付近の実機画面である。スクリプトは一時 workspace と
user-data-dir を毎回分離し、preview の execution context が現れるまで `ensureVisible` を再試行する。
終了時に起動 PID と一時ディレクトリだけを片付ける。
