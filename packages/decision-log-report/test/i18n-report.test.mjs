import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { settleDecisionLog } from "../../akari-tools/src/decision-log/settle.mjs";
import { INTAKE_ROOT_FIELDS, lintDecisionLogPredict, validateIntake } from "../../edit-lint/src/lint/intake.mjs";
import { auditedReportText, EAST_ASIAN_FIXED_TEXT } from "../../analysis-report/test/report-text-audit.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const renderer = resolve(here, "../render-decision-log-report.mjs");
const template = resolve(here, "../template.html");
const fixture = resolve(here, "fixtures/bilingual");

function render(log, out, root, lang) {
  const args = [renderer, "--log", log, "--out", out, "--project", root];
  if (lang) args.push("--lang", lang);
  return spawnSync(process.execPath, args, { encoding: "utf8", env: { ...process.env, AKARI_LANG: "ja" } });
}

function bundle(html) {
  const match = html.match(/id="akari-decision-log-report-data">([\s\S]*?)<\/script>/u);
  assert.ok(match);
  return JSON.parse(match[1]);
}

test("Japanese decision report preserves the original HTML bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "decision-report-i18n-"));
  try {
    const log = join(fixture, "decision-log.ja.md");
    const explicit = join(root, "ja.html");
    const automatic = join(root, "auto.html");
    assert.equal(render(log, explicit, root, "ja").status, 0);
    assert.equal(render(log, automatic, root).status, 0);
    const html = readFileSync(explicit, "utf8");
    assert.equal(html, readFileSync(automatic, "utf8"));
    const originalTemplate = readFileSync(template, "utf8").replace(/ data-i18n="[^"]+"/gu, "");
    assert.equal(createHash("sha256").update(originalTemplate).digest("hex"), "ea045455d1aabe2619402dfae7b1c8999385da64d9eae0d68c1ac4f528903314");
    const data = html.match(/id="akari-decision-log-report-data">([\s\S]*?)<\/script>/u)?.[1];
    assert.ok(data);
    assert.equal(html.replace(data, '{"__AKARI_DECISION_LOG_REPORT_DATA__":true}'), originalTemplate);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("English and Japanese seven-column headings settle, lint, and render equivalently", async () => {
  const results = [];
  for (const lang of ["ja", "en"]) {
    const root = mkdtempSync(join(tmpdir(), "decision-report-bilingual-"));
    try {
      const log = join(root, "decision-log.md");
      copyFileSync(join(fixture, `decision-log.${lang}.md`), log);
      const edit = { version: 2, tracks: [{ lane: "visual", items: [{ id: "clip-1", at: 0, duration: 24 }] }] };
      writeFileSync(join(root, "edit.json"), JSON.stringify(edit));
      const intake = { version: 1, language: "en", tasks: [], target: { duration_s: null, keep_length: false, taste: null }, autonomy: "checkpoint", status: "submitted", submitted_at: "2026-10-10T15:57:33Z" };
      const findings = [];
      validateIntake(intake, findings, { projectRoot: root, intakePath: join(root, ".akari", "intake.json") });
      await lintDecisionLogPredict({ projectRoot: root, intake, edit, findings });
      assert.deepEqual(findings, []);
      assert.ok(INTAKE_ROOT_FIELDS.includes("language"));

      const settled = await settleDecisionLog({ projectRoot: root, now: new Date("2026-10-11T00:00:00Z"), lang });
      assert.equal(settled.settled, 1);
      assert.equal(settled.results[0].subject, "clip-1");
      const out = join(root, "report.html");
      const response = render(log, out, root, "en");
      assert.equal(response.status, 0, response.stderr);
      const html = readFileSync(out, "utf8");
      assert.match(html, /<html lang="en">/u);
      const fixed = auditedReportText(html, {
        dataIds: ["akari-decision-log-report-data"],
        allowedDataPatterns: ["/Checkpoint\\s*1|方針/iu", "/Checkpoint\\s*2|素材計画/iu", "/Checkpoint\\s*3|実行/iu"],
      });
      assert.doesNotMatch(fixed, EAST_ASIAN_FIXED_TEXT);
      const data = bundle(html);
      assert.equal(data.stats.decisionRows, 2);
      assert.equal(data.decisions[0].subject, "clip-1");
      assert.equal(data.decisions[0].checkpoint, "Checkpoint 1");
      results.push({ settled: settled.settled, rows: data.stats.decisionRows, first: data.decisions[0].decision, checkpoint: data.decisions[0].checkpoint });
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
  assert.deepEqual(results[0], results[1]);
});

test("--lang en localizes report command errors", () => {
  const root = mkdtempSync(join(tmpdir(), "decision-report-error-"));
  try {
    const result = render(join(root, "missing.md"), join(root, "report.html"), root, "en");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Could not read decision-log\.md/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
