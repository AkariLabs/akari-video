export const GENERATE_USAGE = [
  "使い方: akari generate <still|video|resume> …",
  "  still   ビート表から静止画または文字カードを作る",
  "  video   静止画クリップを動画へ差し替える",
  "  resume  生成中のジョブを再取得する",
].join("\n");

export const STILL_USAGE = [
  "使い方: akari generate still <projectDir> --spec <beats.json> [options]",
  "  --parallel N   Codex の並列数（既定: 4）",
  "  --placeholder  Codex を呼ばず文字カードを作る",
  "  --dry-run      書き込まず配置予定だけを表示する",
  "  --json         結果を JSON で表示する",
  "  --help         このヘルプを表示する",
].join("\n");
