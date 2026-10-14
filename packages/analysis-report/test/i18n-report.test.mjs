import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { auditedReportText, EAST_ASIAN_FIXED_TEXT } from "./report-text-audit.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const renderer = resolve(here, "../render-analysis-report.mjs");
const template = resolve(here, "../template.html");
const fixture = resolve(here, "fixtures/fieldtest-safe");

function run(out, lang, akariLang = "ja") {
  const args = [renderer, "--analysis", `talk=${join(fixture, "analysis.json")}`, "--interpretation", join(fixture, "interpretation.json"), "--out", out];
  if (lang) args.push("--lang", lang);
  return spawnSync(process.execPath, args, { encoding: "utf8", env: { ...process.env, AKARI_LANG: akariLang, SOURCE_DATE_EPOCH: "1760000000" } });
}

test("Japanese report bytes match the original template and the default Japanese locale", () => {
  const root = mkdtempSync(join(tmpdir(), "analysis-report-i18n-"));
  try {
    const explicit = join(root, "ja.html");
    const automatic = join(root, "auto.html");
    assert.equal(run(explicit, "ja").status, 0);
    assert.equal(run(automatic).status, 0);
    const html = readFileSync(explicit, "utf8");
    assert.equal(html, readFileSync(automatic, "utf8"));
    const originalTemplate = readFileSync(template, "utf8").replace(/ data-i18n="[^"]+"/gu, "");
    assert.equal(createHash("sha256").update(originalTemplate).digest("hex"), "c2a31c88d9f540974d92b7c9292028b1bc1446bb1d99a9241b09563f09d13b69");
    const data = html.match(/id="akari-analysis-report-data">([\s\S]*?)<\/script>/u)?.[1];
    const blocks = html.match(/id="akari-analysis-report-blocks">([\s\S]*?)<\/script>/u)?.[1];
    assert.ok(data && blocks);
    assert.equal(html.replace(data.trim(), '{"__AKARI_ANALYSIS_REPORT_DATA__": true}').replace(blocks.trim(), '{"__AKARI_ANALYSIS_REPORT_BLOCKS__": true}'), originalTemplate);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("English report has English fixed text and an English HTML language", () => {
  const root = mkdtempSync(join(tmpdir(), "analysis-report-i18n-"));
  try {
    const out = join(root, "en.html");
    const result = run(out, "en");
    assert.equal(result.status, 0, result.stderr);
    const html = readFileSync(out, "utf8");
    assert.match(html, /<html lang="en">/u);
    assert.match(html, /1\. Asset timeline/u);
    assert.match(html, /id="akari-report-i18n"/u);
    assert.ok(html.includes('Multi-asset project (${assets.length})'));
    assert.ok(html.includes('JSON parsing failed (" + error.message + ")'));
    assert.ok(html.includes('.join(" / ")'));
    const fixed = auditedReportText(html, { dataIds: ["akari-analysis-report-data", "akari-analysis-report-blocks"] });
    assert.doesNotMatch(fixed, EAST_ASIAN_FIXED_TEXT);
    assert.match(auditedReportText('<script>const separator = "\\u30fb";</script>'), EAST_ASIAN_FIXED_TEXT);
    assert.doesNotMatch(auditedReportText('<!-- 日本語 --><script>// 日本語\nconst text = "English";</script>'), EAST_ASIAN_FIXED_TEXT);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
