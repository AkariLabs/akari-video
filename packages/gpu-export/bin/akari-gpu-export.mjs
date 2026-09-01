#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { resolveFfprobe } from "../../media-bin/src/index.mjs";
import { loadAndBuildGpuPage } from "../src/page-builder.mjs";
import { exportWithGpu, resolveGpuRuntimeOptions } from "../src/index.mjs";

export const USAGE = `使い方: akari-gpu-export <project-dir> --out <path> --duration <seconds> [options]

  --out <path>             出力 MP4 のパス（必須）
  --fps <number>           フレームレート（既定: 30）
  --width <pixels>         出力幅（既定: 1920）
  --height <pixels>        出力高さ（既定: 1080）
  --duration <seconds>     出力尺（必須）
  --frames <count>         出力フレーム数（既定: duration × fps）
  --queue-depth <count>    エンコードキュー深度（既定: 4）
  --quality <name>         品質プリセット（既定: high）
  --bitrate <bps>          映像ビットレート
  --audio <path>           コピーする音声ストリームのソース
  --soft                   software preference を使用
  --trap-readback          製品経路の pixel readback を拒否
  --verify-frames          検証用の生フレーム hash を有効化
  --help, -h               この usage を表示

注記: edit.json の音声を混ぜる製品経路は render-cut --engine gpu です。`;

export class CliArgumentError extends Error {
  constructor(message) {
    super(message);
    this.name = "CliArgumentError";
    this.exitCode = 2;
  }
}

export async function runCli(argv = process.argv.slice(2), deps = {}) {
  const io = deps.io ?? console;
  try {
    const options = parse(argv);
    if (options.help) {
      io.log?.(USAGE);
      return 0;
    }
    if (options.audioSourcePath === null) {
      io.error?.("akari-gpu-export: --audio 未指定のため映像のみで書き出します（音声トラックなし）。音声を付けるには --audio <path> を指定してください");
    } else {
      const exists = deps.exists ?? existsSync;
      const audioProbe = deps.probeAudioStream ?? probeAudioStream;
      const ffprobeResolver = deps.resolveFfprobe ?? resolveFfprobe;
      const hasAudio = exists(options.audioSourcePath)
        && await audioProbe({ ffprobeCommand: ffprobeResolver({ env: deps.env ?? process.env }), path: options.audioSourcePath });
      if (!hasAudio) {
        io.error?.("akari-gpu-export: --audio <path> に音声ストリームがありません。無音トラックは作らず中止します");
        return 2;
      }
    }
    const pageBuilder = deps.loadAndBuildGpuPage ?? loadAndBuildGpuPage;
    const exporter = deps.exportWithGpu ?? exportWithGpu;
    const runtimeOptionsResolver = deps.resolveGpuRuntimeOptions ?? resolveGpuRuntimeOptions;
    const built = await pageBuilder(options);
    await exporter({ ...options, ...runtimeOptionsResolver(options), eligibility: built.eligibility });
    return 0;
  } catch (error) {
    if (error instanceof CliArgumentError) {
      io.error?.(`${error.message}\n${USAGE}`);
      return 2;
    }
    io.error?.(String(error?.stack ?? error));
    return 1;
  }
}

export function parse(argv) {
  const result = {
    projectRoot: null,
    out: null,
    audioSourcePath: null,
    fps: 30,
    width: 1920,
    height: 1080,
    duration: null,
    frames: null,
    soft: false,
    queueDepth: 4,
    quality: "high",
    bitrate: undefined,
    trapReadback: false,
    verifyFrames: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      if (index + 1 >= argv.length) throw new CliArgumentError(`${argument} に値を指定してください`);
      return argv[++index];
    };
    if (argument === "--out") result.out = value();
    else if (argument === "--fps") result.fps = positive(value(), "--fps");
    else if (argument === "--width") result.width = positive(value(), "--width");
    else if (argument === "--height") result.height = positive(value(), "--height");
    else if (argument === "--duration") result.duration = positive(value(), "--duration");
    else if (argument === "--frames") result.frames = positive(value(), "--frames");
    else if (argument === "--queue-depth") result.queueDepth = positive(value(), "--queue-depth");
    else if (argument === "--quality") result.quality = value();
    else if (argument === "--bitrate") result.bitrate = positive(value(), "--bitrate");
    else if (argument === "--audio") result.audioSourcePath = value();
    else if (argument === "--soft") result.soft = true;
    else if (argument === "--trap-readback") result.trapReadback = true;
    else if (argument === "--verify-frames") result.verifyFrames = true;
    else if (argument === "--help" || argument === "-h") result.help = true;
    else if (!argument.startsWith("-") && result.projectRoot === null) result.projectRoot = argument;
    else throw new CliArgumentError(`不明な引数です: ${argument}`);
  }
  if (result.help) return result;
  if (!result.projectRoot || !result.out || !(result.duration > 0)) {
    throw new CliArgumentError("project-dir、--out、--duration は必須です");
  }
  if (result.frames === null) result.frames = Math.round(result.duration * result.fps);
  return result;
}

export function probeAudioStream({ ffprobeCommand, path }) {
  const result = spawnSync(ffprobeCommand, [
    "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=index", "-of", "csv=p=0", path,
  ], { encoding: "utf8", windowsHide: true });
  return result.error === undefined && result.status === 0 && result.stdout.trim() !== "";
}

function positive(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new CliArgumentError(`${label} には正の数を指定してください`);
  return number;
}

const invoked = (() => {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
})();
if (invoked) process.exitCode = await runCli();
