import { doctorExitCode, resolveDoctorReport } from './runtime-diagnostics.mjs';

const usage = [
  '使い方: akari doctor [--json]',
  '',
  '必須部品の実在、解決元、PATH を確認します。',
  '  --json  機械可読な診断結果を 1 オブジェクトで出力',
].join('\n');

export async function runDoctorCommand(argv, options = {}) {
  const log = options.log ?? ((line) => process.stdout.write(`${line}\n`));
  const error = options.error ?? ((line) => process.stderr.write(`${line}\n`));
  if (argv.includes('--help') || argv.includes('-h')) {
    log(usage);
    return { exitCode: 0 };
  }
  const unknown = argv.find((argument) => argument !== '--json');
  if (unknown) {
    error(`不明な doctor オプションです: ${unknown}\n${usage}`);
    return { exitCode: 2 };
  }

  const report = options.report ?? await (options.resolveReport ?? resolveDoctorReport)(options);
  if (argv.includes('--json')) log(JSON.stringify(report));
  else log(formatDoctorReport(report));
  return { exitCode: doctorExitCode(report.verdict), report };
}

export function formatDoctorReport(report) {
  const rows = [
    ['cli', 'ok', `v${report.cli.version} — ${report.cli.entry_path}`],
    ['app_managed', report.app_managed.status, detail(report.app_managed.path, report.app_managed.version)],
    ['app_bundle', report.app_bundle.found ? 'found' : 'missing', detail(report.app_bundle.path, report.app_bundle.version)],
    ['render_cut', report.render_cut.origin, report.render_cut.path ?? '見つかりません'],
    ['edit_lint', report.edit_lint.origin, report.edit_lint.path ?? '見つかりません'],
    ['ffmpeg', report.ffmpeg.origin, report.ffmpeg.path ?? '見つかりません'],
    ['ffprobe', report.ffprobe.origin, report.ffprobe.path ?? '見つかりません'],
    ['chrome', report.chrome.found ? 'found' : 'missing', report.chrome.path ?? report.chrome.cache_dir],
    ['path', report.path.on_path ? 'ok' : 'missing', report.path.cli_shim_dir],
  ];
  const widths = [
    Math.max('項目'.length, ...rows.map((row) => row[0].length)),
    Math.max('状態'.length, ...rows.map((row) => row[1].length)),
  ];
  const lines = [
    'AKARI Video doctor',
    '',
    `${'項目'.padEnd(widths[0])}  ${'状態'.padEnd(widths[1])}  詳細`,
    `${'-'.repeat(widths[0])}  ${'-'.repeat(widths[1])}  ${'-'.repeat(20)}`,
    ...rows.map((row) => `${row[0].padEnd(widths[0])}  ${row[1].padEnd(widths[1])}  ${row[2]}`),
    '',
    `判定: ${report.verdict}`,
  ];
  if (report.next_steps.length > 0) {
    lines.push('次の手順:');
    lines.push(...report.next_steps.map((step) => `  - ${step}`));
  }
  return lines.join('\n');
}

function detail(path, version) {
  const location = path ?? '見つかりません';
  return version ? `v${version} — ${location}` : location;
}
