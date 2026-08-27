import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../bin/akari-osr-export.mjs", import.meta.url));

test("akari-osr-export は未知の --encoder を語彙一覧つきで拒否する", () => {
  const result = spawnSync(process.execPath, [cli, "project", "--encoder", "bogus"], {
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /--encoder must be one of auto\|videotoolbox\|nvenc\|qsv\|amf\|mf\|x264, got: bogus/,
  );
});
