import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { renderDecisionCardReport } from "../render-decision-card-report.mjs";
import { renderResearchPlanReport } from "../render-research-plan-report.mjs";
import { renderStoryboardPrint } from "../render-storyboard-print.mjs";
import { auditedReportText, EAST_ASIAN_FIXED_TEXT } from "../../analysis-report/test/report-text-audit.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const sha = (value) => createHash("sha256").update(value).digest("hex");

test("Japanese decision card and storyboard reports keep the original bytes", () => {
  const cards = renderDecisionCardReport({ lang: "ja" });
  assert.equal(sha(cards), "52d6f221f2c2e64bec8f73e16d7ace23096c99e1328cf5dc2ef22dbb99755628");
  const plan = JSON.parse(readFileSync(join(packageRoot, "test/fixtures/research-plan/with-image/research-plan.json")));
  const research = renderResearchPlanReport({ plan, planPath: "research-plan.json", generatedAt: new Date("2026-10-11T00:00:00Z"), lang: "ja" });
  assert.equal(sha(research), "6e99ecb0ef624e13a85b279779eed3c5996cc4ab4ae35595799c39ce498c556e");

  const fixture = join(packageRoot, "test/fixtures/storyboard-print");
  const edit = JSON.parse(readFileSync(join(fixture, "edit.json")));
  const captions = JSON.parse(readFileSync(join(fixture, "captions.json")));
  const frames = ["opening", "middle", "ending"].map((itemId, index) => ({ itemId, time_s: index + 0.25, pngPath: join(fixture, "frames", `${index + 1}.png`) }));
  const sidecars = { opening: { state: "planned", kind: "still" }, middle: { state: "done", kind: "video" }, ending: { state: "done", kind: "still" } };
  const input = { edit, captions, frames, sidecars, generatedAt: "2026-09-13T12:34:56.000Z", title: "Example" };
  const print = renderStoryboardPrint({ ...input, lang: "ja" });
  assert.equal(sha(print), "ece9e3e3ca15337a3af4dc48585cb4b27351a4462254c97675495868d037c4c1");
  const previous = process.env.AKARI_LANG;
  try {
    process.env.AKARI_LANG = "ja";
    assert.equal(renderDecisionCardReport(), cards);
    assert.equal(renderResearchPlanReport({ plan, planPath: "research-plan.json", generatedAt: new Date("2026-10-11T00:00:00Z") }), research);
    assert.equal(renderStoryboardPrint(input), print);
  } finally {
    if (previous === undefined) delete process.env.AKARI_LANG;
    else process.env.AKARI_LANG = previous;
  }
});

test("English decision cards, research plan, and storyboard print have English fixed text", () => {
  const cards = renderDecisionCardReport({ lang: "en" });
  assert.ok(cards.includes('Could not save the answer (${response.status})'));
  assert.ok(cards.includes('Could not confirm (${response.status}).'));
  const answerValue = [..."実写 B ロール"].map((character) => /[\u3040-\u30ff\u3400-\u9fff]/u.test(character) ? `&#${character.codePointAt(0)};` : character).join("");
  assert.ok(cards.includes(`data-array-value="${answerValue}"`));
  const research = renderResearchPlanReport({ plan: { topic: {}, target: {}, structure: { chapters: [], shots: [] }, shot_list: [] }, lang: "en" });
  const print = renderStoryboardPrint({ edit: { fps: 24, tracks: [] }, captions: [], title: "Storyboard", lang: "en" });
  for (const html of [cards, research, print]) {
    assert.match(html, /<html lang="en">/u);
    assert.match(html, /id="akari-report-i18n"/u);
    assert.doesNotMatch(auditedReportText(html), EAST_ASIAN_FIXED_TEXT);
  }
  const authoredPlan = JSON.parse(readFileSync(join(packageRoot, "test/fixtures/research-plan/with-image/research-plan.json")));
  const withAuthoredData = renderResearchPlanReport({ plan: authoredPlan, lang: "en" });
  assert.match(withAuthoredData, /画のあるショット/u);
  assert.match(withAuthoredData, /1\. Ranked topic candidates/u);
});

test("report commands accept --lang en", () => {
  const root = mkdtempSync(join(tmpdir(), "decision-cards-i18n-"));
  try {
    const cards = join(root, "cards.html");
    const research = join(root, "research.html");
    const printDir = join(root, "print");
    const commands = [
      ["render-decision-card-report.mjs", "--out", cards, "--lang", "en"],
      ["render-research-plan-report.mjs", join(packageRoot, "test/fixtures/research-plan/with-image/research-plan.json"), research, "--lang", "en"],
      ["render-storyboard-print.mjs", join(packageRoot, "test/fixtures/storyboard-print"), "--no-capture", "--out", printDir, "--lang", "en"],
    ];
    for (const [script, ...args] of commands) {
      const result = spawnSync(process.execPath, [join(packageRoot, script), ...args], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
    }
    for (const path of [cards, research, join(printDir, "index.html")]) assert.match(readFileSync(path, "utf8"), /<html lang="en">/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
