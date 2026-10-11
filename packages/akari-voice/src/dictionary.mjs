import fs from 'node:fs';
import path from 'node:path';

export function dictionaryPathFor(projectRoot) { return path.join(projectRoot, '.akari', 'dictionary.json'); }

export function readSpeakerDictionary(projectRoot) {
  try { return JSON.parse(fs.readFileSync(dictionaryPathFor(projectRoot), 'utf8')).speakers ?? {}; }
  catch { return {}; }
}

export function writeSpeakerEntry(projectRoot, speakerId, value) {
  const file = dictionaryPathFor(projectRoot);
  let root;
  try { root = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { root = {}; }
  if (!root || typeof root !== 'object' || Array.isArray(root)) root = {};
  const speakers = root.speakers && typeof root.speakers === 'object' && !Array.isArray(root.speakers) ? { ...root.speakers } : {};
  if (value === undefined) delete speakers[speakerId];
  else speakers[speakerId] = { name: value.name, ...(value.person ? { person: value.person } : {}) };
  root.speakers = speakers;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(root, null, 2)}\n`);
}
