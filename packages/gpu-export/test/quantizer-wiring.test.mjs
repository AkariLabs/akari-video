import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const electronMainSource = await readFile(new URL("../src/electron-main.mjs", import.meta.url), "utf8");
const parseStart = electronMainSource.indexOf("export function parseElectronArguments(argv) {");
const parseEnd = electronMainSource.indexOf("\nfunction formatEligibilityFailures", parseStart);
const helpersStart = electronMainSource.indexOf("function required(argv, index, option) {");
const helpersEnd = electronMainSource.indexOf("\nfunction normalizeOptionalFrameList", helpersStart);
assert.ok(parseStart >= 0 && parseEnd > parseStart && helpersStart >= 0 && helpersEnd > helpersStart);
const parseElectronArguments = vm.runInNewContext([
  electronMainSource.slice(parseStart, parseEnd).replace("export function", "function"),
  electronMainSource.slice(helpersStart, helpersEnd),
  "parseElectronArguments",
].join("\n"), {});

const baseArguments = ["--render", "/project", "--out", "/tmp/out.mp4", "--duration", "1"];

test("parseElectronArguments accepts an optional WebCodecs quantizer", () => {
  assert.equal(parseElectronArguments(baseArguments).quantizer, undefined);
  assert.equal(parseElectronArguments([...baseArguments, "--quantizer", "26"]).quantizer, 26);
  assert.throws(
    () => parseElectronArguments([...baseArguments, "--quantizer", "52"]),
    /--quantizer must be an integer between 0 and 51/u,
  );
  assert.throws(
    () => parseElectronArguments([...baseArguments, "--quantizer", "x"]),
    /--quantizer must be an integer between 0 and 51/u,
  );
});

test("page runtime resolves rate control once and records visible fallback evidence", async () => {
  const source = await readFile(new URL("../src/page-runtime.js", import.meta.url), "utf8");
  assert.match(source, /rateControlResolution = await FE\.WebCodecsH264Encoder\.resolveRateControl\(encoderOptions\)/u);
  assert.match(source, /fallbackReason: "forced-fixed-bitrate"/u);
  assert.match(source, /await bridge\.log\(`WARN WebCodecs の quantizer レート制御が使えないため固定ビットレート/u);
  assert.equal(
    [...source.matchAll(/rateControlFallbackReason: rateControlResolution\?\.fallbackReason \?\? null/gu)].length,
    2,
  );
  assert.equal(
    [...source.matchAll(/quantizer: rateControlResolution\?\.options\?\.quantizer \?\? null/gu)].length,
    2,
  );
});
