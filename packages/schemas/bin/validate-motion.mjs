#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const usage = "使い方: node packages/schemas/bin/validate-motion.mjs <motion/*.json>";
const motionArgument = process.argv[2];

if (!motionArgument || process.argv.length !== 3) {
  console.error(usage);
  process.exit(2);
}
if (motionArgument === "--help" || motionArgument === "-h") {
  console.log(usage);
  process.exit(0);
}

const motionPath = path.resolve(motionArgument);
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
let motion;
try {
  motion = JSON.parse(fs.readFileSync(motionPath, "utf8"));
} catch (error) {
  console.error(`NG: ${motionPath}`);
  console.error(`- motion JSON を読めません: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const editSchema = JSON.parse(fs.readFileSync(path.join(packageRoot, "edit.schema.json"), "utf8"));
const motionSchema = JSON.parse(fs.readFileSync(path.join(packageRoot, "motion.schema.json"), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false });
ajv.addSchema(editSchema);
const validate = ajv.compile(motionSchema);

if (!validate(motion)) {
  console.error(`NG: ${motionPath}`);
  for (const error of validate.errors ?? []) {
    console.error(`- ${error.instancePath || "/"}: ${error.message}`);
  }
  process.exit(1);
}

for (const [itemId, keyframes] of Object.entries(motion.items)) {
  let previous = -1;
  for (const [index, keyframe] of keyframes.entries()) {
    if (keyframe.t <= previous) {
      console.error(`NG: ${motionPath}`);
      console.error(`- /items/${itemId}/${index}/t: 昇順かつ重複禁止です`);
      process.exit(1);
    }
    previous = keyframe.t;
  }
}

console.log(`OK: ${motionPath}`);
