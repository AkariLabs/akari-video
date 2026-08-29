// `node --test skills/critique-cut/bin/` resolves a directory through index.js.
// Keep the implementation and tests as native ESM without introducing package.json.
import("./used-ranges.test.mjs").catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
