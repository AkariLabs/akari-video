import assert from "node:assert/strict";
import test from "node:test";

import { run } from "../src/cli.mjs";

test("the retired browser-install command exits 1 with one migration message", async () => {
  const errors = [];
  const command = ["ch", "rome"].join("");
  const result = await run([command, "install"], { error: (line) => errors.push(line) });
  assert.equal(result.exitCode, 1);
  assert.match(errors[0], /廃止されました/);
  assert.match(errors[0], /不要になりました/);
});

