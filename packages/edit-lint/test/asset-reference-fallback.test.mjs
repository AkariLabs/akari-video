import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { lintProject } from "../src/edit-lint.mjs";
import { resolveLibraryFallback } from "../src/library-reference.mjs";

const REFERENCE_CASES = [
  {
    name: "declared top-level file",
    declaredPath: "assets/still/card/frame.png",
    references: [{ category: "still", id: "card" }],
    libraryFile: "still/card/frame.png",
    resolves: true,
  },
  {
    name: "declared nested file",
    declaredPath: "assets/audio/theme/stems/main.wav",
    references: [{ category: "audio", id: "theme" }],
    libraryFile: "audio/theme/stems/main.wav",
    resolves: true,
  },
  {
    name: "ledger absent",
    declaredPath: "assets/still/card/frame.png",
    references: [],
    libraryFile: "still/card/frame.png",
    resolves: false,
  },
  {
    name: "ledger entry does not match",
    declaredPath: "assets/still/card/frame.png",
    references: [{ category: "still", id: "other" }],
    libraryFile: "still/card/frame.png",
    resolves: false,
  },
  {
    name: "library file is missing",
    declaredPath: "assets/still/card/frame.png",
    references: [{ category: "still", id: "card" }],
    libraryFile: null,
    resolves: false,
  },
  {
    name: "declared path traversal",
    declaredPath: "assets/still/card/../../../../outside.png",
    references: [{ category: "still", id: "card" }],
    libraryFile: null,
    resolves: false,
  },
];

test("library fallback follows the shared resolution case table", async () => {
  for (const entry of REFERENCE_CASES) {
    const root = await mkdtemp(join(tmpdir(), "edit-lint-reference-cases-"));
    try {
      const projectRoot = join(root, "project");
      const assetsRoot = join(root, "home", "assets");
      await mkdir(projectRoot, { recursive: true });
      if (entry.libraryFile !== null) {
        const file = join(assetsRoot, ...entry.libraryFile.split("/"));
        await mkdir(join(file, ".."), { recursive: true });
        await writeFile(file, entry.name, "utf8");
      }
      const result = resolveLibraryFallback({
        projectRoot,
        declaredPath: entry.declaredPath,
        references: entry.references,
        akariAssetsDir: assetsRoot,
      });
      assert.equal(result.path !== null, entry.resolves, entry.name);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("edit-lint resolves a declared library file and identifies an unfetched reference", async () => {
  const root = await mkdtemp(join(tmpdir(), "edit-lint-library-input-"));
  try {
    const projectRoot = join(root, "project");
    const home = join(root, "home");
    const source = join(home, "assets", "broll", "intro", "clip.mp4");
    await mkdir(join(projectRoot, ".akari"), { recursive: true });
    await mkdir(join(source, ".."), { recursive: true });
    await writeFile(source, "library clip", "utf8");
    const edit = {
      version: 2,
      output: { width: 1280, height: 720, fps: 30 },
      sources: [{ id: "clip", path: "assets/broll/intro/clip.mp4", proxy: null }],
      tracks: [{
        id: "video",
        lane: "visual",
        items: [{
          id: "cut-1",
          at: 0,
          duration: 30,
          source: { kind: "media", src: "clip", in: 0, out: 1 },
        }],
      }],
    };
    await writeFile(join(projectRoot, "edit.json"), `${JSON.stringify(edit, null, 2)}\n`, "utf8");
    await writeFile(
      join(projectRoot, ".akari", "asset-references.json"),
      `${JSON.stringify({ version: 0, references: [{ category: "broll", id: "intro" }] }, null, 2)}\n`,
      "utf8",
    );
    const options = { writeReports: false, env: { AKARI_HOME: home } };

    const resolved = await lintProject(projectRoot, options);
    assert.ok(
      !resolved.findings.some((finding) => finding.check === "references.files"),
      JSON.stringify(resolved.findings, null, 2),
    );

    await rm(source, { force: true });
    const missing = await lintProject(projectRoot, options);
    const finding = missing.findings.find((candidate) => candidate.check === "references.files");
    assert.ok(finding, JSON.stringify(missing.findings, null, 2));
    assert.match(finding.message, /共有ライブラリ参照（未取得）/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('edit-lint uses both roots while migrating and identifies an unfetched reference after migration', async t => {
  const temp=await mkdtemp(join(tmpdir(),'lint-migration-states-'));
  t.after(()=>rm(temp,{recursive:true,force:true}));
  const project=join(temp,'project'),home=join(temp,'home'),library=join(temp,'library');
  const old=join(home,'assets/broll/intro/clip.mp4'),next=join(library,'broll/intro/clip.mp4');
  await mkdir(join(project,'.akari'),{recursive:true}); await mkdir(join(old,'..'),{recursive:true});
  await writeFile(old,'clip');
  await writeFile(join(project,'.akari/asset-references.json'),JSON.stringify({version:0,references:[{category:'broll',id:'intro'}]}));
  await writeFile(join(project,'edit.json'),JSON.stringify({version:2,output:{width:320,height:180,fps:30},sources:[{id:'clip',path:'assets/broll/intro/clip.mp4'}],tracks:[{id:'video',lane:'visual',items:[{id:'cut',at:0,duration:30,source:{kind:'media',src:'clip',in:0,out:1}}]}]}));
  const options={env:{AKARI_HOME:home},writeReports:false};
  for (const phase of ['before','during','after']) {
    if (phase !== 'before') await writeFile(join(home,'library-location.json'),JSON.stringify({version:0,root:library,state:phase==='during'?'migrating':'done'}));
    if (phase==='after') { await mkdir(join(next,'..'),{recursive:true});await writeFile(next,'clip');await rm(old); }
    assert.equal((await lintProject(project,options)).findings.some(x=>x.check==='references.files'),false,phase);
  }
  await rm(next);
  assert.match((await lintProject(project,options)).findings.find(x=>x.check==='references.files').message,/共有ライブラリ参照（未取得）/);
});
