import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { installProjectSkills, installSkillAdapters } from "../../project-scaffold/src/index.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const CHECKOUT_SKILL = path.join(REPO_ROOT, "skills", "edit-plan");
const REQUIRED_SKILL_FILES = [
  "SKILL.md",
  "workflow.md",
  "report-guide.md",
  "execution.md",
  "references/cut-candidate-policy.a4-conversation-v1.json",
  "bin/canonical-json.mjs",
  "bin/errors.mjs",
  "bin/contract-semantics.mjs",
  "bin/candidate-core.mjs",
  "bin/runtime-support.mjs",
  "bin/propose-cut-candidates.mjs",
  "bin/generated/contract-validators.cjs",
  "bin/generated/runtime/ucs2length.cjs",
  "bin/generated/runtime/equal.cjs",
  "bin/generated/runtime/fast-deep-equal-index-9a360c74.cjs",
  "bin/generated/runtime/licenses/ajv.txt",
  "bin/generated/runtime/licenses/fast-deep-equal.txt",
];

function run(executable, args, cwd) {
  return spawnSync(executable, args, { cwd, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
}

async function sha(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function assertSkillParity(root, expected) {
  for (const relative of REQUIRED_SKILL_FILES) {
    assert.equal(await sha(path.join(root, relative)), expected.get(relative), `${relative} drifted`);
  }
  const detached = run(process.execPath, ["-e", [
    "const validator=require(process.argv[1]);",
    "if(!validator.validateAnalysis||!validator.validateSemanticKeepPlan||!validator.validateCutCandidates)process.exit(2);",
    "if(!Array.isArray(validator.contractSchemas)||validator.contractSchemas.length!==3)process.exit(3);",
    "const analysis={version:0,source:'a.mp4',transcript:[],keyframes:[],events:[],tracks:{speakers:[],faces:[],person_matte:null}};",
    "if(!validator.validateAnalysis(analysis)||validator.validateAnalysis({...analysis,extra:true}))process.exit(4);",
    "const keep={version:1,kind:'akari-semantic-keep-plan-v1',intended_edit_version:1,candidate_frame_rate:30,sources:[{id:'s1',path:'assets/a.mp4'}],occurrences:[]};",
    "if(!validator.validateSemanticKeepPlan(keep)||validator.validateSemanticKeepPlan({...keep,extra:true}))process.exit(5);",
    "if(validator.validateCutCandidates({}))process.exit(6);",
  ].join(""), path.join(root, "bin", "generated", "contract-validators.cjs")], root);
  assert.equal(detached.status, 0, detached.stderr || detached.stdout);
  const semantic = run(process.execPath, ["--input-type=module", "-e", [
    "const module=await import(process.argv[1]);",
    "const value={version:1,kind:'akari-semantic-keep-plan-v1',intended_edit_version:1,candidate_frame_rate:30,",
    "sources:[{id:'s1',path:'assets/a.mp4'}],occurrences:[]};",
    "if(module.validateSemanticKeepPlanSemantics(value)!==true)process.exit(4);",
    "let rejected=false;try{module.validateSemanticKeepPlanSemantics({...value,intended_edit_version:0});}catch{rejected=true;}",
    "if(!rejected)process.exit(5);",
  ].join(""), path.join(root, "bin", "contract-semantics.mjs")], root);
  assert.equal(semantic.status, 0, semantic.stderr || semantic.stdout);
  const usage = run(process.execPath, [path.join(root, "bin", "propose-cut-candidates.mjs")], root);
  assert.equal(usage.status, 2, usage.stderr || usage.stdout);
  assert.equal(usage.stdout, "");
  assert.equal(JSON.parse(usage.stderr).code, "USAGE_ERROR");
}

async function listTree(root, prefix = "") {
  const result = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await listTree(root, relative));
    else result.push(relative.split(path.sep).join("/"));
  }
  return result.sort();
}

async function generateAt(root) {
  await mkdir(path.join(root, "scripts"), { recursive: true });
  await mkdir(path.join(root, "packages", "schemas"), { recursive: true });
  await cp(path.join(REPO_ROOT, "scripts", "gen-cut-candidate-validators.mjs"), path.join(root, "scripts", "gen-cut-candidate-validators.mjs"));
  for (const schema of ["analysis.schema.json", "semantic-keep-plan.schema.json", "cut-candidates.schema.json"]) {
    await cp(path.join(REPO_ROOT, "packages", "schemas", schema), path.join(root, "packages", "schemas", schema));
  }
  await symlink(path.join(REPO_ROOT, "node_modules"), path.join(root, "node_modules"), "dir");
  const generated = run(process.execPath, ["--preserve-symlinks", "scripts/gen-cut-candidate-validators.mjs"], root);
  assert.equal(generated.status, 0, generated.stderr || generated.stdout);
  const generatedRoot = path.join(root, "skills", "edit-plan", "bin", "generated");
  const files = await listTree(generatedRoot);
  return Promise.all(files.map(async (relative) => [relative, await sha(path.join(generatedRoot, relative))]));
}

test("cut candidate bridge has byte-identical checkout, npm, scaffold, and copied-plugin surfaces", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "akari-cut-distribution-"));
  try {
    const expected = new Map();
    for (const relative of REQUIRED_SKILL_FILES) expected.set(relative, await sha(path.join(CHECKOUT_SKILL, relative)));
    await assertSkillParity(CHECKOUT_SKILL, expected);

    const scaffold = path.join(temporary, "scaffold");
    await mkdir(scaffold);
    await installProjectSkills(scaffold, path.join(REPO_ROOT, "skills"), path.join(REPO_ROOT, "packages", "schemas"));
    await assertSkillParity(path.join(scaffold, ".claude", "skills", "edit-plan"), expected);
    const adapters = await installSkillAdapters(scaffold);
    assert.equal(adapters.degraded.length, 0);
    for (const adapter of [".agents", ".codex", ".cursor", ".opencode"]) {
      await assertSkillParity(path.join(scaffold, adapter, "skills", "edit-plan"), expected);
    }

    const copiedPlugin = path.join(temporary, "copied-plugin");
    await mkdir(copiedPlugin);
    await cp(path.join(REPO_ROOT, "plugin"), copiedPlugin, { recursive: true, dereference: false });
    await rm(path.join(copiedPlugin, "skills"), { force: true });
    await cp(path.join(REPO_ROOT, "skills"), path.join(copiedPlugin, "skills"), { recursive: true });
    await assertSkillParity(path.join(copiedPlugin, "skills", "edit-plan"), expected);

    const fakeRepo = path.join(temporary, "repo");
    await mkdir(path.join(fakeRepo, "packages"), { recursive: true });
    await cp(path.join(REPO_ROOT, "packages", "akari-launcher"), path.join(fakeRepo, "packages", "akari-launcher"), { recursive: true });
    await cp(path.join(REPO_ROOT, "packages", "schemas"), path.join(fakeRepo, "packages", "schemas"), { recursive: true });
    await cp(path.join(REPO_ROOT, "skills"), path.join(fakeRepo, "skills"), { recursive: true });
    await cp(path.join(REPO_ROOT, "LICENSE"), path.join(fakeRepo, "LICENSE"));
    assert.equal(run("git", ["init", "-q"], fakeRepo).status, 0);
    const added = run("git", ["add", "."], fakeRepo);
    assert.equal(added.status, 0, added.stderr);
    const packed = run("npm", ["pack", "--json", "--pack-destination", temporary], path.join(fakeRepo, "packages", "akari-launcher"));
    assert.equal(packed.status, 0, packed.stderr || packed.stdout);
    const archive = path.join(temporary, JSON.parse(packed.stdout)[0].filename);
    const unpacked = path.join(temporary, "unpacked");
    await mkdir(unpacked);
    const extracted = run("tar", ["-xzf", archive, "-C", unpacked], temporary);
    assert.equal(extracted.status, 0, extracted.stderr);
    await assertSkillParity(path.join(unpacked, "package", "vendor", "skills", "edit-plan"), expected);
    for (const schema of ["analysis.schema.json", "semantic-keep-plan.schema.json", "cut-candidates.schema.json"]) {
      assert.equal(
        await sha(path.join(unpacked, "package", "vendor", "packages", "schemas", schema)),
        await sha(path.join(REPO_ROOT, "packages", "schemas", schema)),
        `${schema} was not distributed byte-identically`,
      );
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("generated validator closure is relocation-reproducible across distinct prefixes", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "akari-cut-relocation-"));
  try {
    const left = await generateAt(path.join(temporary, "prefix-a"));
    const right = await generateAt(path.join(temporary, "different-prefix-b"));
    assert.deepEqual(left, right);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("cut application documentation carries the explicit post-cut human gate", async () => {
  const tokens = [
    "POST_CUT_ASR_REVIEW",
    "POST_CUT_INFORMATION_RETENTION",
    "POST_CUT_UI_TIMING_REVIEW",
    "POST_CUT_AUDIO_BOUNDARY_REVIEW",
    "HUMAN_APPLY_GATE",
  ];
  for (const relative of [
    "docs/contract-2026-08-03-cut-candidate-bridge-v1.md",
    "skills/edit-plan/execution.md",
  ]) {
    const contents = await readFile(path.join(REPO_ROOT, relative), "utf8");
    for (const token of tokens) assert.ok(contents.includes(token), `${relative} is missing ${token}`);
  }
  for (const relative of ["skills/edit-plan/SKILL.md", "skills/edit-plan/workflow.md"]) {
    assert.ok((await readFile(path.join(REPO_ROOT, relative), "utf8")).includes("HUMAN_APPLY_GATE"));
  }
});
