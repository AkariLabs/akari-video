import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { lintProject } from "../../src/edit-lint.mjs";
import { migrateFixtureTree } from "./v2-fixture.mjs";

const CHECKED_AT = "2000-01-01T00:00:00.000Z";

function normalizeFinding({ id: _id, ...finding }) {
  return finding;
}

function normalizeExecutionError(error, copiedRoot) {
  return String(error instanceof Error ? error.message : error)
    .split(copiedRoot).join("<fixtures>")
    .split("\\").join("/");
}

export async function collectFixtureDefaultSnapshot(fixtureRoot) {
  const scratchRoot = await mkdtemp(join(tmpdir(), "edit-lint-fixture-snapshot-"));
  const copiedRoot = join(scratchRoot, "fixtures");
  try {
    await cp(fixtureRoot, copiedRoot, { recursive: true });
    await migrateFixtureTree(copiedRoot);
    const fixtureNames = (await readdir(copiedRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right, "en"));
    const fixtures = {};
    for (const fixtureName of fixtureNames) {
      try {
        const result = await lintProject(join(copiedRoot, fixtureName), {
          checkedAt: CHECKED_AT,
          writeReports: false,
        });
        fixtures[fixtureName] = {
          exit_code: result.verdict === "pass" ? 0 : 1,
          verdict: result.verdict,
          findings: result.findings.map(normalizeFinding),
          skipped: result.skipped,
        };
      } catch (error) {
        fixtures[fixtureName] = {
          exit_code: 2,
          verdict: null,
          findings: [],
          skipped: [],
          execution_error: normalizeExecutionError(error, copiedRoot),
        };
      }
    }
    return { version: 1, fixture_count: fixtureNames.length, fixtures };
  } finally {
    await rm(scratchRoot, { recursive: true, force: true });
  }
}
