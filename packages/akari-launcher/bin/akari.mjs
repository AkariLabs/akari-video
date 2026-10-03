#!/usr/bin/env node
import { run, runUpdateCommand } from '../src/cli.mjs';
import { runInitCommand } from '../src/init-command.mjs';
import { runNewCommand } from '../src/new-command.mjs';
import { runNarrationCommand } from '../src/narration-command.mjs';
import { runVoiceCommand } from '../src/voice-command.mjs';
import { runInternalCommand } from '../src/internal-command.mjs';
import { runSoundsCommand } from '../src/sounds-setup.mjs';
import { runStatusCommand } from '../src/status-command.mjs';
import { runAcceptCommand } from '../src/accept-command.mjs';
import { runCapabilityCommand } from '../src/capability-command.mjs';
import { runStoreCommand } from '../src/store-command.mjs';
import { runAssetsCommand } from '../src/assets-command.mjs';
import { runMigrateCommand } from '../src/migrate-command.mjs';
import { runCleanCommand } from '../src/clean-command.mjs';
import { runDoctorCommand } from '../src/doctor-command.mjs';
import { runGenerateCommand } from '../src/generate-command.mjs';
import { runStoryboardCommand } from '../src/storyboard-command.mjs';
import { runWorldCommand } from '../src/world-command.mjs';
import { runSkillsCommand, refreshEntrySkillOnLaunch } from '../src/skills-command.mjs';
import { resolveRuntimePaths } from '../src/runtime-diagnostics.mjs';
import { maybeApplyPendingUpdateOnLaunch, resolveInstalledVersionInfo } from '../src/update-check.mjs';
import { describeCliHelp, describeInstalledVersions, firstArgumentTypoError } from '../src/messages.mjs';
import { suggestFirstArgument } from '../src/first-arg-guard.mjs';
import { runDecisionLogCommand } from '../src/decision-log-command.mjs';
import { runCaptionsCommand } from '../src/captions-command.mjs';
import { runCaptureCommand } from '../src/capture-command.mjs';
import { runMediaCommand } from '../src/media-command.mjs';
import { runWordBookCommand } from '../src/word-book-command.mjs';

// `akari --version` / `-v`: インストール済みの版を表示するだけの最小コマンド
// （タスク契約 2026-08-11-update-u4-cli-self-update の受け入れ条件 —
// `akari update` / `--rollback` 後にインストール先の版を観測する手段として必要）。
async function printVersion() {
  const versionInfo = resolveInstalledVersionInfo({ env: process.env });
  // 1 行目は update / rollback の既存機械観測契約として CLI 版だけを維持する。
  console.log(`v${versionInfo.cliVersion}`);
  for (const line of describeInstalledVersions(versionInfo, resolveRuntimePaths({ env: process.env }))) {
    console.log(line);
  }
  return { exitCode: 0 };
}

// `akari --help` / `-h`: 引数なしのトップレベル一覧を表示するだけの最小コマンド
// （タスク契約 2026-08-11-onboarding-o3-firstrun-plain §4。それ以前はこの分岐が無く、
// `--help` は claude/opencode へそのまま転送されてしまっていた — AKARI Video 自身の
// コマンド一覧が一度も出ない行き止まりだったため新設した）。
async function printCliHelp() {
  for (const line of [...describeCliHelp(), '  world                    ワールド地図を検査・生成・プレビュー・停留所移動',
    '  skills                   入口スキルを配置・削除・確認（install/remove --entry, status --json）']) {
    console.log(line);
  }
  return { exitCode: 0 };
}

// `akari update` / `akari init` / `akari new` / `akari narration` / `akari internal` /
// `akari sounds` / `akari status` / `akari accept` / `akari capability` / `akari store` /
// `akari assets` / `akari clean` は claude へ転送せず、専用のサブコマンドとして扱う（契約 §4-1 /
// タスク契約 launcher-init（内部リポ）/ 音源カタログ既定化のオーナー裁定 2026-08-03 /
// AKARI Store 連携 / タスク契約 2026-08-09-agent-assets-discovery）。
// それ以外の引数はすべて従来どおり claude へ転送する。
// 候補一覧は、この振り分け表のキーから作る。run を直接呼ぶ利用者のため、
// cli.mjs 側にある 5 コマンドの分岐は残す。入口では同じ引数で直接呼ぶ。
const commands = {
  doctor: runDoctorCommand,
  update: runUpdateCommand,
  init: runInitCommand,
  new: runNewCommand,
  skills: runSkillsCommand,
  narration: runNarrationCommand,
  voice: runVoiceCommand,
  internal: runInternalCommand,
  sounds: runSoundsCommand,
  status: runStatusCommand,
  accept: runAcceptCommand,
  capability: runCapabilityCommand,
  store: runStoreCommand,
  assets: runAssetsCommand,
  migrate: runMigrateCommand,
  clean: runCleanCommand,
  generate: runGenerateCommand,
  storyboard: runStoryboardCommand,
  world: runWorldCommand,
  'decision-log': runDecisionLogCommand,
  captions: runCaptionsCommand,
  capture: runCaptureCommand,
  media: runMediaCommand,
  'word-book': runWordBookCommand,
};

async function main(argv) {
  const suggestion = suggestFirstArgument(argv[0], Object.keys(commands));
  if (suggestion) {
    console.error(firstArgumentTypoError(argv[0], suggestion));
    return { exitCode: 2 };
  }

  // 起動の頭で保留中の自動適用があれば適用する（契約 §11・タスク契約
  // 2026-08-11-update-u5-cli-auto-update）。すべてのサブコマンド分岐より前に置く —
  // 「起動」＝ akari バイナリの実行そのものであり、`--version` や `akari update` の
  // 入口でも既に新版へ切り替わっている必要がある（受け入れ条件: 2 回目の起動で
  // `akari --version` が新版を返す。スワップは rename ベースで `~/.akari/app` の
  // 実体を差し替えるだけなので、このプロセス自身がこの後 `readOwnVersion()` を
  // 読み直せば新版の内容を観測できる — 同一 argv での re-exec はしない設計判断
  // （理由は report.md 参照）)。失敗は他の起動時副作用と同じく握りつぶし、
  // claude/opencode 起動やサブコマンド実行を止めない。
  const doctorJson = argv[0] === 'doctor' && argv.includes('--json');
  try {
    maybeApplyPendingUpdateOnLaunch({ env: process.env, log: doctorJson ? () => {} : (line) => console.log(line) });
  } catch (error) {
    console.error(`自動更新の適用確認でエラーが発生しました（続行します）: ${error instanceof Error ? error.message : String(error)}`);
  }
  refreshEntrySkillOnLaunch({ env: process.env });

  if (argv[0] === '--version' || argv[0] === '-v') return printVersion();
  if (argv[0] === '--help' || argv[0] === '-h') return printCliHelp();
  if (Object.hasOwn(commands, argv[0])) return commands[argv[0]](argv.slice(1));
  return run(argv);
}

const result = await main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  return { exitCode: 1 };
});

process.exitCode = result.exitCode ?? 0;
