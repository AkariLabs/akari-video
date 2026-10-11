import { t } from '../../i18n/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EMBEDDING_KEY, encodeEmbedding } from './embed.mjs';

export function voicesPathFor(projectRoot, projectRelative) {
  return path.join(projectRoot, '.akari', 'sidecars', `${projectRelative}.analysis`, 'voices.json');
}

export function readVoicesFile(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export function buildVoicesFile({ previous, speakers, requested, fallback, shortSpeakers }) {
  return { schema: 'akari.voices/0', key: EMBEDDING_KEY,
    ...(requested === undefined ? {} : { requested, fallback: !!fallback }),
    ...(shortSpeakers?.length ? { shortSpeakers } : {}),
    speakers: Object.fromEntries(Object.entries(speakers).map(([id, value]) => [id, {
      seconds: value.seconds, embedding: encodeEmbedding(value.embedding),
      ...(value.suggestion ? { suggestion: value.suggestion } : {}),
    }])), decided: previous?.decided ?? {} };
}

export function writeVoicesFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`); fs.renameSync(temporary, file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

export function setDecided(file, speakerId, person) {
  const value = readVoicesFile(file);
  if (!value) throw new Error(t('tools.voice.engine.error.sidecarMissing'));
  value.decided = { ...value.decided };
  if (person === null) delete value.decided[speakerId];
  else value.decided[speakerId] = person;
  writeVoicesFile(file, value);
  return value;
}
