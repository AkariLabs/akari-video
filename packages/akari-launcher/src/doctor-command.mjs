import { doctorExitCode, resolveDoctorReport } from './runtime-diagnostics.mjs';
import { cliText, cliLanguage } from './i18n.mjs';

const usage = () => ['usage', 'blank', 'description', 'json'].map((name) => name === 'blank' ? '' : cliText(`cli.doctor.help.${name}`)).join('\n');

export async function runDoctorCommand(argv, options = {}) {
  const log = options.log ?? ((line) => process.stdout.write(`${line}\n`));
  const error = options.error ?? ((line) => process.stderr.write(`${line}\n`));
  if (argv.includes('--help') || argv.includes('-h')) {
    log(usage());
    return { exitCode: 0 };
  }
  const unknown = argv.find((argument) => argument !== '--json');
  if (unknown) {
    error(`${cliText('cli.doctor.error.unknownOption', { option: unknown })}\n${usage()}`);
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
    ['node', report.cli.node?.runtime ?? 'unknown', report.cli.node
      ? `v${report.cli.node.version} — ${report.cli.node.exec_path}${report.cli.node.runtime === 'electron' ? cliText('cli.doctor.detail.electronNode') : ''}`
      : cliText('cli.doctor.detail.noInfo')],
    ['app_managed', report.app_managed.status, detail(report.app_managed.path, report.app_managed.version)],
    ['app_bundle', report.app_bundle.found ? 'found' : 'missing', detail(report.app_bundle.path, report.app_bundle.version)],
    ['render_cut', report.render_cut.origin, report.render_cut.path ?? cliText('cli.doctor.detail.missing')],
    ['edit_lint', report.edit_lint.origin, report.edit_lint.path ?? cliText('cli.doctor.detail.missing')],
    ['ffmpeg', report.ffmpeg.origin, report.ffmpeg.path ?? cliText('cli.doctor.detail.missing')],
    ['ffprobe', report.ffprobe.origin, report.ffprobe.path ?? cliText('cli.doctor.detail.missing')],
    ['gpu_export', report.gpu_export?.available ? 'ok' : 'unavailable', localizeGpuReason(report.gpu_export?.reason) ?? cliText('cli.doctor.detail.noInfo')],
    ['fal_key', report.fal_key?.source ?? 'missing', report.fal_key?.source === 'env'
      ? cliText('cli.doctor.detail.falEnv')
      : report.fal_key?.source === 'credentials.env'
        ? report.fal_key.credentials_path
        : cliText('cli.doctor.detail.falMissing')],
    [cliText('cli.doctor.detail.keyLocation'), cliText(`cli.doctor.location.${({ 新: 'new', 旧: 'old', 両方: 'both', なし: 'none' })[report.fal_key?.location] ?? 'none'}`), cliText('cli.doctor.detail.keyLocationLegend')],
    ['path', report.path.on_path ? 'ok' : 'missing', report.path.cli_shim_dir],
  ];
  const widths = [
    Math.max(cliText('cli.doctor.table.item').length, ...rows.map((row) => row[0].length)),
    Math.max(cliText('cli.doctor.table.status').length, ...rows.map((row) => row[1].length)),
  ];
  const lines = [
    'AKARI Video doctor',
    '',
    `${cliText('cli.doctor.table.item').padEnd(widths[0])}  ${cliText('cli.doctor.table.status').padEnd(widths[1])}  ${cliText('cli.doctor.table.detail')}`,
    `${'-'.repeat(widths[0])}  ${'-'.repeat(widths[1])}  ${'-'.repeat(20)}`,
    ...rows.map((row) => `${row[0].padEnd(widths[0])}  ${row[1].padEnd(widths[1])}  ${row[2]}`),
    '',
    cliText('cli.doctor.table.verdict', { verdict: report.verdict }),
  ];
  const steps = [...report.next_steps];
  if (report.cli.node?.runtime === 'electron' && report.cli.node.exec_path && report.render_cut.path) {
    const quote = (value) => `"${value.replaceAll('"', '\\"')}"`;
    steps.push(cliText('cli.doctor.detail.nodeExport', { node: quote(report.cli.node.exec_path), render: quote(report.render_cut.path) }));
  }
  if (steps.length > 0) {
    lines.push(cliText('cli.doctor.table.nextSteps'));
    lines.push(...steps.map((step) => `  - ${step}`));
  }
  return lines.join('\n');
}

function detail(path, version) {
  const location = path ?? cliText('cli.doctor.detail.missing');
  return version ? `v${version} — ${location}` : location;
}

function localizeGpuReason(reason) {
  if (!reason || cliLanguage() === 'ja') return reason;
  return reason.replace(cliText('cli.doctor.detail.gpuRepoReason', {}, 'ja'), cliText('cli.doctor.detail.gpuRepoReason'));
}
