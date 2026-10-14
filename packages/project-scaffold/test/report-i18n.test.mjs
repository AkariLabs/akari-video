import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { renderReportHtml } from "../src/index.mjs";
import { auditedReportText, EAST_ASIAN_FIXED_TEXT } from "../../analysis-report/test/report-text-audit.mjs";

const report = {
  createdAt: "2026-10-11T00:00:00.000Z",
  destination: "/project",
  templateDir: "/template",
  copy: { copiedFiles: ["README.md"], skippedSymlinks: [] },
  fallback: { writtenFiles: [] },
  skillsVersion: null,
  git: { action: "skipped", eligibility: "own-root", reason: "このフォルダは既に git リポジトリのため git init を skip", reasonCode: "ownRoot" },
};

test("Japanese project report matches the original byte output", () => {
  const explicit = renderReportHtml(report, { lang: "ja" });
  assert.equal(createHash("sha256").update(explicit).digest("hex"), "8a5431931c23e2883ad5d46e4b05707c3079bbe08cc2b8f869535d5704925f1f");
  const previous = process.env.AKARI_LANG;
  try {
    process.env.AKARI_LANG = "ja";
    assert.equal(renderReportHtml(report), explicit);
  } finally {
    if (previous === undefined) delete process.env.AKARI_LANG;
    else process.env.AKARI_LANG = previous;
  }
});

test("English project report has English fixed text", () => {
  const html = renderReportHtml(report, { lang: "en" });
  assert.match(html, /<html lang="en">/u);
  assert.match(html, /AKARI Video Project Creation Report/u);
  assert.match(html, /id="akari-report-i18n"/u);
  assert.doesNotMatch(auditedReportText(html), EAST_ASIAN_FIXED_TEXT);
});
