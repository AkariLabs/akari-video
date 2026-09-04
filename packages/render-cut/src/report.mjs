import { relative } from "node:path";
import { fileURLToPath } from "node:url";

// The helper is an executable module. Resolve its address without importing or copying it.
const REPORT_HELPER_URL = new URL("../../decision-cards/report-helper.mjs", import.meta.url);

export function renderReport(state, reportPath, projectRoot) {
  const helperPath = relative(projectRoot, fileURLToPath(REPORT_HELPER_URL));
  const reportRelativePath = relative(projectRoot, reportPath);
  const attempts = state.provenance?.rasterizer?.attempts ?? [];
  const inputs = Object.entries(state.inputs ?? {});
  const findings = state.verify?.findings ?? [];
  const blankFrames = state.verify?.declared?.blank_frames ?? [];
  const warnings = state.warnings ?? [];

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AKARI render-cut report</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; background: #0b1020; color: #e7ecf7; }
    main { max-width: 1080px; margin: 0 auto; padding: 40px 24px 64px; }
    h1 { margin: 0 0 8px; font-size: 30px; }
    h2 { margin-top: 34px; font-size: 20px; }
    .meta { color: #9eabc9; }
    .summary { display: flex; flex-wrap: wrap; gap: 12px; margin: 24px 0; }
    .badge { padding: 8px 12px; border: 1px solid #334066; border-radius: 999px; background: #151d35; }
    .pass { color: #61d99b; }
    .fail, .error { color: #ff798c; }
    .warning { color: #f5c451; }
    .planned { color: #7fb4ff; }
    table { width: 100%; border-collapse: collapse; background: #11182d; }
    th, td { padding: 11px 12px; border-bottom: 1px solid #293451; text-align: left; vertical-align: top; }
    th { color: #aebada; font-size: 13px; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; overflow-wrap: anywhere; }
    pre { padding: 16px; overflow: auto; border: 1px solid #293451; border-radius: 8px; background: #11182d; }
    li { margin: 8px 0; }
  </style>
</head>
<body>
<main>
  <h1>render-cut report</h1>
  <div class="meta">State version ${escapeHtml(state.version)} · phase ${escapeHtml(state.phase)}</div>
  ${state.gpu_forced === true ? '<p class="warning">検証用（GPU 強制）</p>' : ""}
  <div class="summary">
    <span class="badge ${escapeHtml(state.verify?.verdict ?? "planned")}">${escapeHtml(state.verify?.verdict ?? "planned")}</span>
    <span class="badge">${escapeHtml(state.plan.predicted_duration_seconds)}s predicted</span>
    <span class="badge">${escapeHtml(state.plan.preset.width)}×${escapeHtml(state.plan.preset.height)} @ ${escapeHtml(state.plan.preset.fps)}fps</span>
  </div>

  <h2>Plan</h2>
  <p>Output: <code>${escapeHtml(state.plan.output)}</code></p>
  <p>Rasterizer planned: <code>${escapeHtml(state.plan.rasterizer.selected)}</code>; adopted: <code>${escapeHtml(state.provenance?.rasterizer?.adopted ?? "pending")}</code></p>
  <p>Intermediates: ${state.plan.intermediates.map((path) => `<code>${escapeHtml(path)}</code>`).join(", ")}</p>
  <pre><code>${escapeHtml(JSON.stringify(state.plan.commands, null, 2))}</code></pre>

  <h2>Warnings</h2>
  <ul>${warnings.length ? warnings.map((warning) => `<li class="fail">${escapeHtml(warning)}</li>`).join("") : "<li>None</li>"}</ul>

  <h2>Rasterizer attempts</h2>
  <ul>${attempts.length ? attempts.map((attempt) => `<li><code>${escapeHtml(attempt.method)}</code> — ${escapeHtml(attempt.status)}${attempt.reason ? `: ${escapeHtml(attempt.reason)}` : ""}</li>`).join("") : "<li>Not run</li>"}</ul>

  <h2>Input receipts</h2>
  <table><thead><tr><th>Input</th><th>SHA-256</th></tr></thead><tbody>
    ${inputs.map(([path, receipt]) => `<tr><td><code>${escapeHtml(path)}</code></td><td><code>${escapeHtml(receipt.sha256)}</code></td></tr>`).join("")}
  </tbody></table>

  <h2>Verification</h2>
  <ul>${findings.length ? findings.map((finding) => `<li class="${escapeHtml(finding.severity)}"><code>${escapeHtml(finding.check)}</code> — ${escapeHtml(finding.message)}</li>`).join("") : "<li>Not run</li>"}</ul>
  ${state.artifacts?.length ? `<p>Artifact SHA-256: <code>${escapeHtml(state.artifacts[0].sha256)}</code></p>` : ""}

  <h2>Blank-frame scan</h2>
  <p>Every decoded frame is scanned; the minimum reported continuous interval is 0.3 seconds.</p>
  <table><thead><tr><th>Start</th><th>Duration</th><th>YMAX max</th><th>Active overlays</th><th>Active cuts</th><th>Severity</th></tr></thead><tbody>
    ${blankFrames.length ? blankFrames.map((interval) => `<tr class="${escapeHtml(interval.severity)}"><td>${escapeHtml(interval.start)}s</td><td>${escapeHtml(interval.duration)}s</td><td>${escapeHtml(interval.ymax_max)}</td><td>${formatIds(interval.active_overlays)}</td><td>${formatIds(interval.active_cuts)}</td><td>${escapeHtml(interval.severity)}</td></tr>`).join("") : '<tr><td colspan="6">No intervals reported</td></tr>'}
  </tbody></table>

  ${state.contact_sheet ? `<h2>Contact sheet</h2>
  <p>Deterministic keyframes at (s): ${state.contact_sheet.timestamps_seconds.map((seconds) => escapeHtml(seconds)).join(", ")}</p>
  <img src="contact-sheet.png" alt="contact sheet" style="max-width:100%;border:1px solid #293451;border-radius:8px">` : ""}
  <p class="meta">Serve locally with <code>node ${escapeHtml(helperPath)} ${escapeHtml(reportRelativePath)}</code>.</p>
</main>
</body>
</html>
`;
}

function formatIds(ids) {
  return Array.isArray(ids) && ids.length > 0
    ? ids.map((id) => `<code>${escapeHtml(id)}</code>`).join(", ")
    : "None";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
