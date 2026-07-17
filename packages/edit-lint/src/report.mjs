import { relative } from "node:path";
import { fileURLToPath } from "node:url";

// report-helper is an executable module rather than an importable rendering API. Keep its
// repository-relative module address as the single report-serving mechanism.
const REPORT_HELPER_URL = new URL("../../decision-cards/report-helper.mjs", import.meta.url);

export function renderLintReport(result, reportPath, projectRoot) {
  const counts = result.findings.reduce(
    (value, finding) => {
      value[finding.severity] += 1;
      return value;
    },
    { error: 0, warning: 0 },
  );
  const helperPath = relative(projectRoot, fileURLToPath(REPORT_HELPER_URL));
  const reportRelativePath = relative(projectRoot, reportPath);
  const rows = result.findings.length
    ? result.findings
        .map(
          (finding) => `
            <tr>
              <td><code>${escapeHtml(finding.id)}</code></td>
              <td><span class="severity ${escapeHtml(finding.severity)}">${escapeHtml(finding.severity)}</span></td>
              <td><code>${escapeHtml(finding.check)}</code></td>
              <td>${escapeHtml(finding.message)}</td>
              <td><code>${escapeHtml(finding.path ?? "—")}</code></td>
            </tr>`,
        )
        .join("")
    : '<tr><td colspan="5" class="empty">No findings</td></tr>';
  const skipped = result.skipped.length
    ? result.skipped
        .map(
          (item) =>
            `<li><code>${escapeHtml(item.check)}</code> — ${escapeHtml(item.reason)}</li>`,
        )
        .join("")
    : "<li>None</li>";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AKARI edit-lint report</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; background: #0b1020; color: #e7ecf7; }
    main { max-width: 1080px; margin: 0 auto; padding: 40px 24px 64px; }
    h1 { margin: 0 0 8px; font-size: 30px; }
    h2 { margin-top: 36px; font-size: 20px; }
    .summary { display: flex; gap: 12px; flex-wrap: wrap; margin: 24px 0; }
    .badge { padding: 8px 12px; border: 1px solid #334066; border-radius: 999px; background: #151d35; }
    .verdict { font-weight: 800; text-transform: uppercase; }
    .pass { color: #61d99b; }
    .fail, .error { color: #ff798c; }
    .warning { color: #ffd166; }
    table { width: 100%; border-collapse: collapse; background: #11182d; }
    th, td { padding: 11px 12px; border-bottom: 1px solid #293451; text-align: left; vertical-align: top; }
    th { color: #aebada; font-size: 13px; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }
    .severity { font-weight: 700; text-transform: uppercase; }
    .empty { color: #9eabc9; text-align: center; }
    li { margin: 8px 0; }
    .meta { color: #9eabc9; }
  </style>
</head>
<body>
<main>
  <h1>edit-lint report</h1>
  <div class="meta">Checked at ${escapeHtml(result.checked_at)}</div>
  <div class="summary">
    <span class="badge verdict ${escapeHtml(result.verdict)}">${escapeHtml(result.verdict)}</span>
    <span class="badge error">${counts.error} errors</span>
    <span class="badge warning">${counts.warning} warnings</span>
  </div>
  <h2>Findings</h2>
  <table>
    <thead><tr><th>ID</th><th>Severity</th><th>Check</th><th>Message</th><th>Path</th></tr></thead>
    <tbody>${rows}
    </tbody>
  </table>
  <h2>Skipped checks</h2>
  <ul>${skipped}</ul>
  <p class="meta">Serve locally with <code>node ${escapeHtml(helperPath)} ${escapeHtml(reportRelativePath)}</code>.</p>
</main>
</body>
</html>
`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
