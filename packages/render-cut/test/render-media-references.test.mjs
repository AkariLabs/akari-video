import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildRenderMediaReferences, enumerateDeclaredRenderInputs, projectResolvedMediaPaths } from "../src/render-inputs.mjs";
import { withRenderMediaReferences } from "../src/render-cut.mjs";
import { renderMediaReferencesPath } from "../../osr-export/src/static-server.mjs";
import { resolveOsrLauncher } from "../../osr-export/src/index.mjs";

const cli = fileURLToPath(new URL("../bin/render-cut.mjs", import.meta.url));
const videoPath = "assets/broll/intro/clip.mp4";
const audioPath = "assets/audio/theme/tone.wav";

async function put(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

test("reference table recovers stale own-PID files, protects active calls, and cleans up success and failure", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "render-reference-table-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const projectRoot = join(temp, "project"), library = join(temp, "library");
  const still = "assets/still/card/frame.png";
  const edit = {
    sources: [{ id: "clip", path: videoPath }], cuts: [{ src: "clip", in: 0, out: 1 }],
    audio: { bgm: { path: audioPath }, sfx: [{ path: audioPath }], narration: [{ path: audioPath }] },
    layers: [{ id: "still", src: still }],
    overlays: [{ id: "card", html: "overlay.html" }],
  };
  await put(join(projectRoot, "edit.json"), JSON.stringify(edit));
  await put(join(projectRoot, "overlay.html"), `<img src="${still}">`);
  await put(join(projectRoot, ".akari/asset-references.json"), JSON.stringify({ version: 0, references: [
    { category: "broll", id: "intro" }, { category: "audio", id: "theme" }, { category: "still", id: "card" },
  ] }));
  for (const path of [videoPath, audioPath, still]) await put(join(library, path.slice(7)), path);
  const inputs = await enumerateDeclaredRenderInputs({ projectRoot, edit, env: {
    AKARI_HOME: join(temp, "home"), AKARI_LIBRARY_ROOT: library, AKARI_CREATOR_ROOT: join(temp, "creator"),
  } });
  const table = buildRenderMediaReferences(inputs);
  assert.deepEqual(Object.keys(table).sort(), [videoPath, audioPath, still].sort());
  assert.ok(inputs.some(input => input.role === "overlay:card:fragment-asset" && input.scope === "library"));
  for (const [path, entry] of Object.entries(table)) {
    assert.deepEqual(entry, { absolute: await realpath(join(library, path.slice(7))), library_root: await realpath(library) });
  }
  const sidecar = renderMediaReferencesPath(projectRoot, process.pid);
  // クラッシュ時の途中書き込みも、使用中でなければ読み込まず回収する。
  await put(sidecar, '{"stale":');
  const otherSidecar = renderMediaReferencesPath(projectRoot, process.pid + 1);
  await put(otherSidecar, "other process");
  const result = await withRenderMediaReferences(projectRoot, inputs, async () => {
    const envelope = JSON.parse(await readFile(sidecar, "utf8"));
    assert.deepEqual(envelope.references, table);
    assert.match(envelope.token, /^[a-f0-9]{64}$/u);
    assert.equal(envelope.token, process.env.AKARI_RENDER_MEDIA_REFERENCES_TOKEN);
    // Electron と同じ直接の子プロセスで、引数追加なしの受け渡しを確認する。
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { createStaticRequestHandler } from ${JSON.stringify(new URL("../../osr-export/src/static-server.mjs", import.meta.url).href)};
      import { Writable } from 'node:stream';
      import { once } from 'node:events';
      const chunks = [];
      const response = new Writable({ write(chunk, encoding, callback) { chunks.push(chunk); callback(); } });
      response.setHeader = () => {};
      response.writeHead = status => { response.statusCode = status; };
      const finished = once(response, 'finish');
      await createStaticRequestHandler({ projectRoot: ${JSON.stringify(projectRoot)}, pageHtml: '', overlaySheetHtml: '' })(
        { url: '/media/${videoPath}', headers: {} }, response);
      await finished;
      if (response.statusCode !== 200) throw new Error('status ' + response.statusCode);
      process.stdout.write(Buffer.concat(chunks));
    `], { encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, videoPath);
    await assert.rejects(withRenderMediaReferences(projectRoot, [], () => assert.fail("overlapping run")), { code: "EEXIST" });
    assert.deepEqual(JSON.parse(await readFile(sidecar, "utf8")), envelope);
    assert.equal(process.env.AKARI_RENDER_MEDIA_REFERENCES_TOKEN, envelope.token);
    return 42;
  });
  assert.equal(result, 42);
  await assert.rejects(readFile(sidecar), { code: "ENOENT" });
  const error = new Error("export failed");
  await assert.rejects(withRenderMediaReferences(projectRoot, inputs, async () => { throw error; }), value => value === error);
  await assert.rejects(readFile(sidecar), { code: "ENOENT" });
  await withRenderMediaReferences(projectRoot, [], async () => {
    assert.deepEqual(JSON.parse(await readFile(sidecar, "utf8")).references, {});
  });
  assert.equal(await readFile(otherSidecar, "utf8"), "other process");
});

test("reference table releases its active marker when preparation fails", async (t) => {
  const projectRoot = await mkdtemp(join(tmpdir(), "render-reference-prepare-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  const sidecar = renderMediaReferencesPath(projectRoot, process.pid);
  // ファイルではない障害物は再帰削除しない。失敗後の再試行は使用中扱いにしない。
  await mkdir(sidecar, { recursive: true });
  await assert.rejects(withRenderMediaReferences(projectRoot, [], () => assert.fail("must not start")));
  await rm(sidecar, { recursive: true });
  await withRenderMediaReferences(projectRoot, [], async () => {
    assert.deepEqual(JSON.parse(await readFile(sidecar, "utf8")).references, {});
  });
  await assert.rejects(readFile(sidecar), { code: "ENOENT" });
});

test("reference token and sidecar are scoped to run and restored on success and failure", async (t) => {
  const projectRoot = await mkdtemp(join(tmpdir(), "render-reference-token-"));
  const original = process.env.AKARI_RENDER_MEDIA_REFERENCES_TOKEN;
  const restore = value => {
    if (value === undefined) delete process.env.AKARI_RENDER_MEDIA_REFERENCES_TOKEN;
    else process.env.AKARI_RENDER_MEDIA_REFERENCES_TOKEN = value;
  };
  t.after(async () => {
    restore(original);
    await rm(projectRoot, { recursive: true, force: true });
  });
  const sidecar = renderMediaReferencesPath(projectRoot, process.pid);
  const tokens = new Set();
  for (const previous of [undefined, "", "inherited-token"]) {
    for (const fails of [false, true]) {
      restore(previous);
      const failure = new Error("export failed");
      const run = withRenderMediaReferences(projectRoot, [], async () => {
        const envelope = JSON.parse(await readFile(sidecar, "utf8"));
        assert.deepEqual(envelope.references, {});
        assert.match(envelope.token, /^[a-f0-9]{64}$/u);
        assert.equal(process.env.AKARI_RENDER_MEDIA_REFERENCES_TOKEN, envelope.token);
        assert.equal(tokens.has(envelope.token), false);
        tokens.add(envelope.token);
        if (fails) throw failure;
        return 42;
      });
      if (fails) await assert.rejects(run, error => error === failure);
      else assert.equal(await run, 42);
      assert.equal(process.env.AKARI_RENDER_MEDIA_REFERENCES_TOKEN, previous);
      assert.equal(Object.hasOwn(process.env, "AKARI_RENDER_MEDIA_REFERENCES_TOKEN"), previous !== undefined);
      await assert.rejects(readFile(sidecar), { code: "ENOENT" });
    }
  }
});

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024, ...options });
  assert.equal(result.status, 0, `${command}: ${result.error ?? ""}\n${result.stderr}\n${result.stdout}`);
  return result;
}

function measureTones(path, env) {
  const pcm = run("ffmpeg", ["-v", "error", "-i", path, "-ac", "1", "-ar", "48000", "-f", "f32le", "pipe:1"], { env, encoding: null }).stdout;
  const start = 12000, count = 24000;
  assert.ok(pcm.length >= (start + count) * 4);
  return [440, 880].map(frequency => {
    let real = 0, imaginary = 0;
    for (let i = 0; i < count; i++) {
      const value = pcm.readFloatLE((start + i) * 4);
      const phase = 2 * Math.PI * frequency * i / 48000;
      real += value * Math.cos(phase);
      imaginary += value * Math.sin(phase);
    }
    return 2 * Math.hypot(real, imaginary) / count;
  });
}

test("planning projection changes only bound media path fields and leaves declarations intact", () => {
  const projectRoot = join(tmpdir(), "projection-project");
  const absolute = join(tmpdir(), "projection-library", "tone.wav");
  const edit = {
    sources: [{ id: audioPath, path: audioPath }, { id: "local", path: "local.wav" }],
    layers: [{ src: audioPath }], audio: { bgm: audioPath, sfx: [{ path: `./${audioPath}` }],
      narration: [{ path: audioPath }], speech: [{ path: audioPath }] },
    overlays: [{ html: audioPath }], title: audioPath,
  };
  const original = structuredClone(edit);
  const inputs = [{ scope: "library", path: audioPath, absolute_path: absolute }];
  const copy = projectResolvedMediaPaths({ projectRoot, edit, inputs });
  assert.deepEqual(edit, original);
  assert.equal(copy.sources[0].path, absolute);
  assert.equal(copy.sources[0].id, audioPath);
  assert.equal(copy.sources[1].path, "local.wav");
  assert.equal(copy.layers[0].src, absolute);
  assert.equal(copy.audio.bgm, absolute);
  for (const role of ["sfx", "narration", "speech"]) assert.equal(copy.audio[role][0].path, absolute);
  assert.equal(copy.overlays[0].html, audioPath);
  assert.equal(copy.title, audioPath);
});

async function makeFixture(t) {
  const temp = await mkdtemp(join(tmpdir(), "render-library-export-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const projectRoot = join(temp, "project"), home = join(temp, "home"), library = join(temp, "creator/library");
  const env = { ...process.env, AKARI_HOME: home, AKARI_LIBRARY_ROOT: "", AKARI_CREATOR_ROOT: join(temp, "creator"),
    AKARI_EXPORT_ALLOW_DESKTOP: "0" };
  delete env.AKARI_OSR_ELECTRON;
  delete env.AKARI_OSR_SOFT;
  const edit = {
    version: 2, output: { width: 320, height: 180, fps: 30 },
    sources: [{ id: "clip", path: videoPath }, { id: "tone", path: audioPath }],
    tracks: [
      { id: "video", lane: "visual", items: [{ id: "cut", at: 0, duration: 30, source: { kind: "media", src: "clip", in: 0, out: 1 } }] },
      { id: "audio", lane: "audio", items: [{ id: "music", role: "bgm", at: 0, duration: 30, source: { kind: "media", src: "tone", in: 0, out: 1 } }] },
    ],
  };
  await put(join(projectRoot, "edit.json"), JSON.stringify(edit));
  await put(join(projectRoot, ".akari/lint.json"), '{"version":1,"verdict":"pass"}');
  await put(join(projectRoot, ".akari/asset-references.json"), JSON.stringify({ version: 0, references: [
    { category: "broll", id: "intro" }, { category: "audio", id: "theme" },
  ] }));
  for (const path of [videoPath, audioPath]) await mkdir(dirname(join(home, path)), { recursive: true });
  run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=320x180:r=30:d=1", "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", join(home, videoPath)], { env });
  run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1", "-c:a", "pcm_s16le", join(home, audioPath)], { env });
  return { projectRoot, home, library, env };
}

async function placeFixture({ projectRoot, home, library, env }, phase) {
  if (phase !== "legacy") {
    for (const path of [videoPath, audioPath]) {
      const target = phase === "project" ? join(projectRoot, path) : join(library, path.slice(7));
      await mkdir(dirname(target), { recursive: true });
      await cp(join(home, path), target);
    }
    await put(join(home, "library-location.json"), JSON.stringify({ version: 0, root: library, state: phase === "both" ? "migrating" : "done" }));
    if (phase === "new") await rm(join(home, "assets"), { recursive: true });
    // 両方ある場合、旧ルートには異なる画を置いて新ルートの優先も実測する。
    if (phase === "both" || phase === "project") run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=30:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", join(home, videoPath)], { env });
  }
}

for (const engine of ["osr", "gpu"]) for (const phase of ["legacy", "both", "new"]) {
  test(`${engine} plan-only binds all audio roles and layer audio to existing ${phase} files`, async (t) => {
    if (spawnSync("ffmpeg", ["-version"]).status !== 0 || spawnSync("ffprobe", ["-version"]).status !== 0) return t.skip("ffmpeg/ffprobe unavailable");
    const fixture = await makeFixture(t);
    await placeFixture(fixture, phase);
    const { projectRoot, home, library, env } = fixture;
    const winningRoot = phase === "legacy" ? join(home, "assets") : library;
    const video = await realpath(join(winningRoot, videoPath.slice(7)));
    const audio = await realpath(join(winningRoot, audioPath.slice(7)));
    const editPath = join(projectRoot, "edit.json");
    const edit = JSON.parse(await readFile(editPath, "utf8"));
    // 2 枚目の映像をレイヤーとして重ね、cut と layer の両 ffmpeg 入力を検査する。
    edit.tracks.push({ id: "upper", lane: "visual", items: [{
      ...structuredClone(edit.tracks[0].items[0]), id: "pip", transform: { scale: 0.5 },
    }] });
    for (const role of ["bgm", "sfx", "narration", "speech"]) {
      edit.tracks[1].items[0].role = role;
      const originalText = JSON.stringify(edit);
      await writeFile(editPath, originalText);
      run(process.execPath, [cli, projectRoot, "--engine", engine, "--plan-only"], { env });
      const state = JSON.parse(await readFile(join(projectRoot, ".akari/render.json"), "utf8"));
      const { cut_audio: cut, audio_mix: mix } = state.plan.commands;
      const inputPaths = command => command.args.flatMap((arg, index) => arg === "-i" ? [command.args[index + 1]] : []);
      const cutInputs = inputPaths(cut);
      const mixInputs = inputPaths(mix);
      assert.ok(cutInputs.filter(path => path === video).length >= 2, `source cut and layer audio: ${cutInputs}`);
      assert.ok(mixInputs.includes(audio), `${role}: ${mixInputs}`);
      for (const path of [video, audio]) assert.equal((await stat(path)).isFile(), true);
      assert.ok(![...cutInputs, ...mixInputs].includes(join(projectRoot, videoPath)));
      assert.ok(![...cutInputs, ...mixInputs].includes(join(projectRoot, audioPath)));
      assert.equal(state.inputs[audioPath]?.scope, "library");
      assert.equal(state.inputs[videoPath]?.scope, "library");
      assert.equal(await readFile(editPath, "utf8"), originalText);
      assert.deepEqual(state.warnings, []);
      if (role === "bgm") {
        // Electron を要さず、実際の cut と mix コマンドで両音源が開けることも確認する。
        const cutOutput = cut.args.at(-1);
        await mkdir(dirname(cutOutput), { recursive: true });
        run(cut.command, cut.args, { env });
        const composite = mixInputs[0];
        run("ffmpeg", ["-v", "error", "-y", "-i", video, "-i", cutOutput,
          "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", composite], { env });
        run(mix.command, mix.args, { env });
        const tones = measureTones(mix.args.at(-1), env);
        for (const amplitude of tones) assert.ok(amplitude > 0.015, `440/880 Hz: ${tones}`);
        t.diagnostic(`ffmpeg cut + mix: 440/880 Hz amplitudes=${tones}`);
      }
    }
  });
}

for (const engine of ["osr", "gpu"]) for (const phase of ["legacy", "both", "new", "project"]) {
  test(`${engine} exports referenced video and audio with ${phase} files`, { timeout: 180_000 }, async (t) => {
    if (spawnSync("ffmpeg", ["-version"]).status !== 0 || spawnSync("ffprobe", ["-version"]).status !== 0) return t.skip("ffmpeg/ffprobe unavailable");
    const fixture = await makeFixture(t);
    const { projectRoot, home, library, env } = fixture;
    const launcher = await resolveOsrLauncher({ env });
    if (launcher.tier === 3) return t.skip("Electron unavailable");
    assert.equal(launcher.tier, 2, "force npm Electron");
    await placeFixture(fixture, phase);
    const out = join(projectRoot, "output.mp4");
    const started = performance.now();
    run(process.execPath, [cli, projectRoot, "--engine", engine, "--out", out], { env });
    const elapsed = ((performance.now() - started) / 1000).toFixed(2);
    const state = JSON.parse(await readFile(join(projectRoot, ".akari/render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    assert.equal(state.provenance.engine, engine);
    assert.ok([1, 2].includes(state.provenance[engine]?.provenance?.launcher_tier));
    assert.equal(Object.hasOwn(state.provenance, "engine_fallback"), false);
    const receipt = JSON.parse(await readFile(join(projectRoot, state.render_receipt.path), "utf8"));
    for (const declared of [videoPath, audioPath]) {
      assert.ok(receipt.inputs.some(input => input.path.replaceAll("\\", "/") === declared));
    }
    const storedEdit = JSON.parse(await readFile(join(projectRoot, "edit.json"), "utf8"));
    assert.equal(storedEdit.sources.find(source => source.id === "clip").path, videoPath);
    assert.equal(storedEdit.sources.find(source => source.id === "tone").path, audioPath);
    const probe = JSON.parse(run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", out], { env }).stdout);
    assert.ok(probe.streams.some(stream => stream.codec_type === "audio"));
    const video = probe.streams.find(stream => stream.codec_type === "video");
    assert.equal(video.width, 320);
    assert.equal(video.height, 180);
    assert.ok(Math.abs(Number(probe.format.duration) - 1) < 0.1);
    const pixels = run("ffmpeg", ["-v", "error", "-ss", "0.5", "-i", out, "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"], { env, encoding: null }).stdout;
    const offset = (90 * 320 + 160) * 3;
    const rgb = [...pixels.subarray(offset, offset + 3)];
    assert.ok(rgb[0] > 200 && rgb[1] < 40 && rgb[2] < 40, `center RGB ${rgb}`);
    const volume = run("ffmpeg", ["-hide_banner", "-i", out, "-af", "volumedetect", "-f", "null", "-"], { env }).stderr;
    const mean = Number(/mean_volume:\s*(-?[\d.]+) dB/u.exec(volume)?.[1]);
    assert.ok(Number.isFinite(mean) && mean > -40, volume);
    const tones = measureTones(out, env);
    for (const amplitude of tones) assert.ok(amplitude > 0.015, `both source audio and BGM must survive: ${tones}`);
    assert.deepEqual(await readdir(join(projectRoot, ".akari/render-tmp")), []);
    t.diagnostic(`${elapsed}s; ffprobe ${probe.format.duration}s ${video.codec_name} 320x180 + audio; center RGB=${rgb}; mean_volume=${mean} dB; 440/880 Hz amplitudes=${tones}`);
  });
}

test("missing ledger video or audio refuses before export begins", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const { projectRoot, home, env } = await makeFixture(t);
  for (const path of [videoPath, audioPath]) {
    const bytes = await readFile(join(home, path));
    await rm(join(home, path));
    const result = spawnSync(process.execPath, [cli, projectRoot, "--engine", "osr", "--out", join(projectRoot, "output.mp4")], { env, encoding: "utf8", timeout: 60_000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /could not be resolved|ffprobe failed/u);
    assert.doesNotMatch(result.stderr, /Range fetch failed|Electron exited/u);
    await assert.rejects(readFile(join(projectRoot, "output.mp4")), { code: "ENOENT" });
    await assert.rejects(readFile(join(projectRoot, ".akari/osr-run.json")), { code: "ENOENT" });
    await put(join(home, path), bytes);
  }
});
