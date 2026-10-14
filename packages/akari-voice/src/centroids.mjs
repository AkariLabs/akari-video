import { t } from '../../i18n/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { decodeEmbedding, EMBEDDING_KEY, encodeEmbedding, meanEmbedding } from './embed.mjs';

export function personRef(channel, id) { return `${channel}/${id}`; }

export function channelPeopleForProject(projectRoot) {
  const normalized = projectRoot.replaceAll('\\', '/').replace(/\/+$/, '');
  const match = /^(.*\/channels\/)([^/]+)\/videos\/[^/]+$/.exec(normalized);
  if (!match) return null;
  const separator = projectRoot.includes('\\') ? '\\' : '/';
  return { channel: match[2], peoplePath: `${match[1]}${match[2]}/people.json`.replaceAll('/', separator) };
}

export function readChannelPeople(peoplePath) {
  const root = JSON.parse(fs.readFileSync(peoplePath, 'utf8'));
  return (Array.isArray(root.entries) ? root.entries : []).flatMap(entry => {
    if (!['person', 'avatar'].includes(entry?.kind) || !entry.id || !entry.name) return [];
    const samples = (Array.isArray(entry.voice?.samples) ? entry.voice.samples : [])
      .filter(sample => sample && typeof sample.file === 'string' && sample.file && ['self', 'subject'].includes(sample.consent));
    return samples.length ? [{ id: entry.id, name: entry.name, samples }] : [];
  });
}

export async function loadCentroids({ peoplePath, channel, embedder, decode }) {
  const people = readChannelPeople(peoplePath);
  const channelDir = path.resolve(path.dirname(peoplePath));
  const cachePath = path.join(channelDir, '.akari', 'voice-centroids.json');
  let cache;
  try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch { cache = null; }
  const validCache = cache?.schema === 'akari.voice-centroids/0' && JSON.stringify(cache.key) === JSON.stringify(EMBEDDING_KEY);
  const persons = {}, centroids = [], compared = [], warnings = [];
  for (const person of people) {
    try {
      const samples = person.samples.map(sample => {
        const absolute = path.resolve(channelDir, sample.file);
        if (!absolute.startsWith(channelDir + path.sep)) throw new Error(t('tools.voice.engine.error.sampleOutsideChannel'));
        return { file: sample.file, absolute, sha256: createHash('sha256').update(fs.readFileSync(absolute)).digest('hex') };
      });
      const signature = samples.map(({ file, sha256 }) => ({ file, sha256 }));
      const previous = validCache ? cache.persons?.[person.id] : null;
      let centroid;
      if (previous && JSON.stringify(previous.samples) === JSON.stringify(signature)) centroid = decodeEmbedding(previous.centroid);
      else {
        const vectors = [];
        for (const sample of samples) vectors.push(await embedder.embed(await decode(sample.absolute)));
        centroid = meanEmbedding(vectors);
      }
      persons[person.id] = { samples: signature, centroid: encodeEmbedding(centroid) };
      const ref = personRef(channel, person.id);
      centroids.push({ person: ref, name: person.name, centroid }); compared.push(ref);
    } catch (error) { warnings.push(`${person.id}: ${error.message}`); }
  }
  const next = { schema: 'akari.voice-centroids/0', key: EMBEDDING_KEY, persons };
  if (JSON.stringify(next) !== JSON.stringify(cache)) {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, `${JSON.stringify(next, null, 2)}\n`);
  }
  return { centroids, compared, warnings };
}
