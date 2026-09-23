#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pty from "node-pty";

const evidence = dirname(fileURLToPath(import.meta.url));
const defaultRepo = resolve(evidence, "../../../..");
const [phase, ...options] = process.argv.slice(2);
if (!["before", "after"].includes(phase) || (options.length !== 0 && (options.length !== 2 || options[0] !== "--repo"))) {
  throw new Error("usage: node measure.mjs before|after [--repo <checkout root>]");
}
const repo = options.length ? resolve(options[1]) : defaultRepo;
const { default: { migrateEditToV2 } } = await import(pathToFileURL(join(repo, "packages/edit-store/lib/migrate/index.js")).href);
const root = mkdtempSync(join(tmpdir(), "fieldreport-audio-qc-pass-verdict-"));
const akariHome = join(root, "fieldreport-audio-qc-pass-verdict-home");
mkdirSync(akariHome);
const env = { ...process.env, AKARI_HOME: akariHome, AKARI_OSR_SOFT: "1" };

function clean(value) {
  return String(value ?? "")
    .replaceAll(root, "<fixture>").replaceAll(repo, "<repo>")
    .replace(/(?:\/Users|\/var|\/tmp|\/private|\/opt)\/[^\s"']+/gu, "<path>");
}
function run(command, args, input, timeout = 600000) {
  const result = spawnSync(command, args, { encoding: "utf8", env, input, timeout, maxBuffer: 4 * 1024 * 1024 });
  return { exit: result.status, error: result.error?.code ?? null, output: clean(`${result.stdout ?? ""}\n${result.stderr ?? ""}`) };
}
function mustRun(command, args) {
  const result = run(command, args);
  if (result.exit !== 0) throw new Error(`${command} failed: ${result.output}`);
}
function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}
function lines(text, pattern) { return text.split(/\r?\n/u).filter(line => pattern.test(line)); }
function runAccept(project, digest) {
  return new Promise(resolveResult => {
    const child = pty.spawn(process.execPath, [join(repo, "packages/akari-launcher/bin/akari.mjs"), "accept", project], {
      name: "xterm", cols: 100, rows: 30, cwd: project, env,
    });
    let output = "", answered = 0;
    const prompts = [
      ["Human identity for this cooperative local record:", "fixture-reviewer"],
      ["Your final acceptance statement for this artifact:", "Fixture acceptance observation."],
      ["to confirm this artifact checksum:", `ACCEPT ${digest ?? "unavailable"}`],
    ];
    const timer = setTimeout(() => child.kill(), 120000);
    child.onData(chunk => {
      output += chunk;
      if (answered < prompts.length && output.includes(prompts[answered][0])) {
        const shown = output.match(/Artifact SHA-256: ([0-9a-f]{64})/u)?.[1];
        child.write(`${answered === 2 && shown ? `ACCEPT ${shown}` : prompts[answered][1]}\r`);
        answered++;
      }
    });
    child.onExit(({ exitCode }) => {
      clearTimeout(timer);
      resolveResult({ exit: exitCode, output: clean(output) });
    });
  });
}

const result = { phase, cases: {} };
try {
  for (const kind of ["in_range", "true_peak_exceeded"]) {
    const project = join(root, kind);
    mkdirSync(join(project, ".akari"), { recursive: true });
    const audioFilter = kind === "in_range"
      ? "sine=frequency=440:sample_rate=48000:duration=3"
      : "aevalsrc=0.97*sin(2*PI*1000*t)*lt(mod(t\\,0.4)\\,0.03):s=48000:d=3";
    mustRun("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", audioFilter,
      ...(kind === "in_range" ? ["-af", "volume=6dB"] : []), "-c:a", "pcm_s16le", join(project, "hot.wav")]);
    mustRun("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=10:duration=3",
      "-i", join(project, "hot.wav"),
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", join(project, "source.mp4")]);
    const edit = {
      version: 0, output: { width: 320, height: 180, fps: 10 },
      source: { path: "source.mp4", proxy: null }, cuts: [{ in: 0, out: 3 }], overlays: [],
      audio: { master: kind === "in_range"
        ? { loudnorm: -14, true_peak_dbtp: -1.5 }
        // Unmargined default true peak (-1.5) + a loud target: the AAC ringing of the gated burst
        // decodes just above the 0.1 dB tolerance (measured -1.37 dBTP on the wrapper's machine).
        : { denoise: "off", loudnorm: -5 } },
    };
    // render-cut rejects version 0; migrate with the measured checkout's own edit-store (same as test/helpers/v2-fixture.mjs).
    const migrated = migrateEditToV2(edit);
    if (!migrated.ok) throw new Error(`fixture edit could not migrate: ${migrated.blockers.join(" / ")}`);
    const editText = `${JSON.stringify(migrated.doc, null, 2)}\n`;
    writeFileSync(join(project, "edit.json"), editText);
    // Minimal scaffold so `akari status --full` reaches acceptance_pending (same files as
    // packages/akari-launcher/test/helpers/integrity-fixture.mjs).
    mkdirSync(join(project, "analysis", "source"), { recursive: true });
    writeFileSync(join(project, "analysis", "source", "analysis.json"), '{"version":0,"source":"../../source.mp4"}\n');
    writeFileSync(join(project, ".akari", "connections.json"), '{"version":1}\n');
    writeFileSync(join(project, ".akari", "workflow.json"), '{"version":1,"roles":[],"events":{}}\n');
    writeFileSync(join(project, ".akari", "intake.json"), '{"version":1,"status":"submitted"}\n');
    writeFileSync(join(project, "plan.json"), '{"version":0,"slots":[]}\n');
    writeFileSync(join(project, "review.json"), '{"version":0,"annotations":[]}\n');
    const sha256File = path => createHash("sha256").update(readFileSync(path)).digest("hex");
    const writeLint = () => writeFileSync(join(project, ".akari", "lint.json"), `${JSON.stringify({
      version: 1, verdict: "pass",
      inputs: { edit_json_sha256: sha256File(join(project, "edit.json")), review_json_sha256: sha256File(join(project, "review.json")) },
    })}\n`);
    const renderOnce = () => run(process.execPath, [join(repo, "packages/render-cut/bin/render-cut.mjs"), project,
      "--engine", "osr", "--out", "exports/final.mp4", "--force", "--no-verify-blank"], undefined, 1800000);

    // The first render appends exports/final.mp4 to edit.json sources; lint again and re-render
    // so the receipt, lint and edit.json agree (a second render to the same --out is byte-stable).
    writeLint();
    const firstRender = renderOnce();
    writeLint();
    const render = firstRender.exit === 0 ? renderOnce() : firstRender;
    const state = readJson(join(project, ".akari", "render.json"));
    const receipt = state?.render_receipt?.path ? readJson(join(project, state.render_receipt.path)) : null;
    const qc = receipt?.audio_qc ?? state?.audio_qc ?? null;
    const status = run(process.execPath, [join(repo, "packages/akari-launcher/bin/akari.mjs"), "status", project, "--full", "--json"]);
    const parsedStatus = (() => { try { return JSON.parse(status.output); } catch { return null; } })();
    const digest = receipt?.output?.sha256;
    const accept = await runAccept(project, digest);
    result.cases[kind] = {
      render_exit: render.exit,
      render_error: render.error,
      ...(render.exit === 0 ? {} : { render_output: render.output }),
      receipt_audio_qc: qc ? {
        verdict: qc.verdict, configured: qc.configured,
        decoded_measurement: qc.decoded_measurement, warnings: qc.warnings ?? [],
      } : null,
      render_audio_qc_warnings: lines(render.output, /^render-cut warning:.*(?:audio_qc|TRUE_PEAK_EXCEEDED)/u),
      status_exit: status.exit,
      status_audio_qc_warnings: (parsedStatus?.warnings ?? lines(status.output, /audio_qc|TRUE_PEAK_EXCEEDED/u)).filter(value => /audio_qc|TRUE_PEAK_EXCEEDED/u.test(value)),
      accept_exit: accept.exit,
      accept_output: accept.output,
      accept_warning_lines: lines(accept.output, /WARNING/u),
    };
  }
  const json = JSON.stringify(result, null, 2);
  writeFileSync(join(evidence, `${phase}.json`), `${json}\n`);
  writeFileSync(join(evidence, `${phase}.md`), `# ${phase.toUpperCase()} audio QC measurement\n\n${Object.entries(result.cases).map(([name, item]) => `## ${name}\n\n- render exit: ${item.render_exit}; verdict: ${item.receipt_audio_qc?.verdict ?? "unavailable"}\n- configured: ${JSON.stringify(item.receipt_audio_qc?.configured ?? null)}\n- decoded: ${JSON.stringify(item.receipt_audio_qc?.decoded_measurement ?? null)}\n- QC warnings: ${JSON.stringify(item.receipt_audio_qc?.warnings ?? [])}\n- render warnings: ${JSON.stringify(item.render_audio_qc_warnings)}\n- status warnings: ${JSON.stringify(item.status_audio_qc_warnings)}\n- accept exit: ${item.accept_exit}; WARNING lines: ${JSON.stringify(item.accept_warning_lines)}\n- accept output:\n\n\`\`\`text\n${item.accept_output}\n\`\`\`\n`).join("\n")}\n`);
  process.stdout.write(`${json}\n`);
  if (Object.values(result.cases).some(item => item.render_exit !== 0 || !item.receipt_audio_qc || item.accept_exit !== 0)) {
    process.exitCode = 1;
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
