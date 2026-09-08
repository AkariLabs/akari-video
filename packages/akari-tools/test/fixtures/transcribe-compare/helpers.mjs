import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const fixtureDirectory = path.dirname(fileURLToPath(import.meta.url));
export const now = new Date("2026-09-08T01:00:00Z");
export const probeSpawn = () => ({ status: 0, stdout: JSON.stringify({ format: { duration: "30" }, streams: [{ codec_type: "audio" }] }), stderr: "" });
export const silenceSpans = [{ start: 21, end: 22.4 }, { start: 23, end: 25.4 }, { start: 26, end: 29.7 }];
export async function fixture(t, engines) {
  const project = await mkdtemp(path.join(os.tmpdir(), "akari-compare-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  const directory = path.join(project, ".akari/sidecars/assets/source.wav.analysis");
  await mkdir(path.join(directory, "transcripts"), { recursive: true });
  await mkdir(path.join(project, "assets"), { recursive: true });
  await writeFile(path.join(project, "assets/source.wav"), "fixture audio; probe is injected");
  for (const engine of engines ?? ["cloud-scribe", "speech-analyzer", "whisper-cpp"]) {
    await cp(path.join(fixtureDirectory, "transcripts", `${engine}.json`), path.join(directory, "transcripts", `${engine}.json`));
  }
  return { project, directory, target: "assets/source.wav", options: { cwd: project, now, spawn: probeSpawn, silencesRunner: async () => silenceSpans, ffmpegCommand: "fixture-ffmpeg", ffprobeCommand: "fixture-ffprobe" } };
}
export const json = async (file) => JSON.parse(await readFile(file, "utf8"));
export const putJson = (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
