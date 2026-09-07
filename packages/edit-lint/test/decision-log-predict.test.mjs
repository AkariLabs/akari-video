import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { lintProject } from "../src/edit-lint.mjs";

const check = "decision-log.predict-missing";
const message = "decision-log.md に機械の予測行（決定者 machine:director）がありません。提案つき / そのままモードでは、入れた物 1 件ごとに予測 1 行を追記してください（判子は一回 契約 §10）（decision-log.md が見つかりません）";

async function lint({ status = "submitted", autonomy = "checkpoint", itemCount = 1, decisionLog } = {}) {
  const root = await mkdtemp(join(tmpdir(), "decision-log-predict-"));
  try {
    const edit = {
      version: 2,
      output: { width: 640, height: 360, fps: 30 },
      sources: [],
      tracks: [{
        id: "visual",
        lane: "visual",
        items: itemCount === 0 ? [] : [{
          id: "group", at: 0, duration: 30, source: { kind: "group" }, items: [],
        }],
      }],
    };
    const intake = {
      version: 1,
      tasks: [],
      target: { duration_s: null, keep_length: true },
      autonomy,
      status,
      submitted_at: status === "submitted" ? "2026-09-06T00:00:00Z" : null,
    };
    await writeFile(join(root, "edit.json"), `${JSON.stringify(edit, null, 2)}\n`);
    await mkdir(join(root, ".akari"));
    await writeFile(join(root, ".akari", "intake.json"), `${JSON.stringify(intake, null, 2)}\n`);
    if (decisionLog !== undefined) {
      await writeFile(join(root, "decision-log.md"), decisionLog);
    }
    const result = await lintProject(root, { writeReports: false });
    assert.deepEqual(result.findings.filter(finding => finding.severity === "error"), []);
    assert.deepEqual(
      result.findings.filter(finding => finding.check.startsWith("intake.")).map(finding => finding.check),
      status === "draft" ? ["intake.status"] : [],
    );
    return result.findings.filter(finding => finding.check === check);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function assertMissing(findings) {
  assert.equal(findings.length, 1);
  assert.equal(findings[0].check, check);
  assert.equal(findings[0].severity, "warning");
  assert.equal(findings[0].path, "decision-log.md");
  assert.equal(findings[0].message, message);
}

test("(a) submitted checkpoint with an item and no decision log warns once", async () => {
  assertMissing(await lint());
});

test("(b) a machine:director prediction row suppresses the warning", async () => {
  assert.deepEqual(await lint({
    decisionLog: "| 2026-09-06 | proposal | b-roll-1 | 図解を挿入 | 発話の空白 | machine:director | s1 |\n",
  }), []);
});

test("(c) submitted collaborative with an item needs no prediction row", async () => {
  assert.deepEqual(await lint({ autonomy: "collaborative" }), []);
});

test("(d) draft checkpoint needs no prediction row", async () => {
  assert.deepEqual(await lint({ status: "draft" }), []);
});

test("(e) submitted full-auto with zero items needs no prediction row", async () => {
  assert.deepEqual(await lint({ autonomy: "full-auto", itemCount: 0 }), []);
});

test("(f) submitted full-auto with an item and no decision log warns once", async () => {
  assertMissing(await lint({ autonomy: "full-auto" }));
});
