import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readProjectEvents } from "../src/status-core/events.mjs";

async function withEvents(callback) {
  const root = await mkdtemp(join(tmpdir(), "akari-events-"));
  try {
    await mkdir(join(root, ".akari", "events"), { recursive: true });
    return await callback(root, join(root, ".akari", "events"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function event(directory, filename, payload) {
  await writeFile(join(directory, filename), `${JSON.stringify(payload)}\n`, "utf8");
}

function acceptance(id, occurredAt) {
  return {
    version: 1,
    id,
    type: "final-acceptance",
    occurredAt,
    actor: { kind: "human", id: "owner" },
    issuer: { kind: "akari-cli-tty", version: 1 },
    artifact: "exports/final.mp4",
    artifact_sha256: "a".repeat(64),
    render_receipt: `.akari/reports/render-receipts/${"b".repeat(64)}.json`,
    render_receipt_sha256: "b".repeat(64),
    review_sha256: "c".repeat(64),
    verbatim: "accepted",
  };
}

function revocation(id, acceptanceId, occurredAt) {
  return {
    version: 1,
    id,
    type: "final-acceptance-revoked",
    occurredAt,
    acceptance_id: acceptanceId,
    reason: "superseded",
  };
}

test("legacy type/time variants sort deterministically", async () => {
  await withEvents(async (root, directory) => {
    await event(directory, "4.json", { version: 1, id: "4", event: "report-approved", recorded_at_local: "2026-08-03T09:00:03+09:00" });
    await event(directory, "2.json", { version: 1, id: "2", type: "report-approved", at: "2026-08-03T00:00:01Z" });
    await event(directory, "1.json", { version: 1, id: "1", type: "report-approved", occurredAt: "2026-08-03T00:00:00Z" });
    await event(directory, "3.json", { version: 1, id: "3", event: "report-approved", recorded_at: "2026-08-03T00:00:02Z" });
    const result = readProjectEvents(root, { gateTypes: ["report-approved"] });
    assert.deepEqual(result.problems, []);
    assert.deepEqual(result.events.map((value) => value.id), ["1", "2", "3", "4"]);
  });
});

test("compact filename timestamps require an explicit offset", async () => {
  await withEvents(async (root, directory) => {
    await event(directory, "20260803-090000+0900-report-approved.json", { version: 1, id: "with-offset", type: "report-approved" });
    await event(directory, "20260803-090001-report-approved.json", { version: 1, id: "without-offset", type: "report-approved" });
    const result = readProjectEvents(root, { gateTypes: ["report-approved"] });
    assert.ok(result.events.some((value) => value.id === "with-offset"));
    assert.ok(result.problems.some((value) => value.includes("090001")));
  });
});

test("conflicting duplicate ids and acceptance/revoke ties fail closed", async () => {
  await withEvents(async (root, directory) => {
    await event(directory, "a.json", acceptance("evt-a", "2026-08-03T00:00:00Z"));
    await event(directory, "duplicate-one.json", { version: 1, id: "evt-duplicate", type: "note", occurredAt: "2026-08-03T00:00:00Z", value: 1 });
    await event(directory, "duplicate-two.json", { version: 1, id: "evt-duplicate", type: "note", occurredAt: "2026-08-03T00:00:00Z", value: 2 });
    await event(directory, "revoke.json", revocation("evt-r", "evt-a", "2026-08-03T00:00:00Z"));
    const result = readProjectEvents(root);
    assert.ok(result.problems.some((value) => value.includes("conflicting payloads")));
    assert.ok(result.problems.some((value) => value.includes("must occur after")));
  });
});

test("a revocation earlier than its acceptance fails closed", async () => {
  await withEvents(async (root, directory) => {
    await event(directory, "accept.json", acceptance("evt-a", "2026-08-03T00:00:01Z"));
    await event(directory, "revoke.json", revocation("evt-r", "evt-a", "2026-08-03T00:00:00Z"));
    const result = readProjectEvents(root);
    assert.ok(result.problems.some((value) => value.includes("must occur after")));
  });
});

test("later revocation orders after acceptance without a tie", async () => {
  await withEvents(async (root, directory) => {
    await event(directory, "accept.json", acceptance("evt-a", "2026-08-03T00:00:00Z"));
    await event(directory, "revoke.json", revocation("evt-r", "evt-a", "2026-08-03T00:00:01Z"));
    const result = readProjectEvents(root);
    assert.deepEqual(result.problems, []);
    assert.deepEqual(result.events.map((value) => value.type), ["final-acceptance", "final-acceptance-revoked"]);
  });
});

test("an external events-directory symlink cannot inject acceptance or revocation", async () => {
  await withEvents(async (root, directory) => {
    const external = await mkdtemp(join(tmpdir(), "akari-external-events-"));
    try {
      await event(external, "accept.json", acceptance("evt-a", "2026-08-03T00:00:00Z"));
      await event(external, "revoke.json", revocation("evt-r", "evt-a", "2026-08-03T00:00:01Z"));
      await rm(directory, { recursive: true });
      await symlink(external, directory);
      const result = readProjectEvents(root);
      assert.deepEqual(result.events, []);
      assert.ok(result.problems.some((value) => value.includes("not a regular project directory")));
    } finally {
      await rm(external, { recursive: true, force: true });
    }
  });
});

test("an event-file symlink cannot inject acceptance", async () => {
  await withEvents(async (root, directory) => {
    const external = await mkdtemp(join(tmpdir(), "akari-external-event-file-"));
    try {
      const target = join(external, "accept.json");
      await writeFile(target, `${JSON.stringify(acceptance("evt-a", "2026-08-03T00:00:00Z"))}\n`, "utf8");
      await symlink(target, join(directory, "accept.json"));
      const result = readProjectEvents(root);
      assert.deepEqual(result.events, []);
      assert.ok(result.problems.some((value) => value.includes("not a regular contained project file")));
    } finally {
      await rm(external, { recursive: true, force: true });
    }
  });
});
