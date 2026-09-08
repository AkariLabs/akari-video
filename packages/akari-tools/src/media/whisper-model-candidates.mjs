import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

/** Ordered search locations shared by the CLI and shell. The override is a file. */
export function whisperModelLocations({ env, homeDir, repoRoot, bin }) {
  return [
    { path: env.WHISPER_CPP_MODEL, recursive: false },
    { path: path.join(homeDir, ".akari", "tools", "models"), recursive: true },
    { path: path.join(repoRoot, "models"), recursive: true },
    { path: path.join(repoRoot, "whisper.cpp", "models"), recursive: true },
    { path: path.join(homeDir, ".cache", "whisper.cpp"), recursive: true },
    { path: path.join(homeDir, "Library", "Caches", "whisper.cpp"), recursive: true },
    { path: path.resolve(path.dirname(bin), "..", "share", "whisper-cpp"), recursive: true },
    { path: "/opt/homebrew/share/whisper-cpp", recursive: true },
    { path: "/usr/local/share/whisper-cpp", recursive: true },
    { path: path.join(homeDir, "Library", "Application Support", "com.prakashjoshipax.VoiceInk", "WhisperModels"), recursive: true },
  ].filter(location => Boolean(location.path));
}

export function isWhisperModelFilename(candidate) {
  return /^ggml-.*\.bin$/i.test(path.basename(candidate));
}

export function isWhisperModelExcluded(candidate) {
  return path.basename(candidate).startsWith("for-tests-") || path.basename(candidate).includes(".en.");
}

function findModels(root) {
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root, { recursive: true })
      .map(entry => path.join(root, String(entry)))
      .filter(isWhisperModelFilename);
  } catch {
    return [];
  }
}

export function whisperModelCandidates(options) {
  return whisperModelLocations(options).flatMap(location => location.recursive ? findModels(location.path) : [location.path]);
}
