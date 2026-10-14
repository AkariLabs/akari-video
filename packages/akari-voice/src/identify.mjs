import { concatTurnsAudio } from './audio.mjs';
import { cosine, fbankMean } from './embed.mjs';

// 仮置きの境界値。実在の別人の声での較正は後日行う。
export const VOICE_MATCH_LEVELS = Object.freeze({ strong: 0.60, maybe: 0.45 });

export function levelFor(score) {
  return score >= VOICE_MATCH_LEVELS.strong ? 'strong' : score >= VOICE_MATCH_LEVELS.maybe ? 'maybe' : 'none';
}

export function suggestFor(embedding, centroids) {
  if (!centroids.length) return null;
  const best = centroids.map(item => ({ ...item, similarity: cosine(embedding, item.centroid) }))
    .sort((a, b) => b.similarity - a.similarity)[0];
  const score = +best.similarity.toFixed(3);
  const level = levelFor(best.similarity);
  return level === 'none' ? { score, level } : { person: best.person, name: best.name, score, level };
}

export function bundleBySuggestion(suggestions) {
  const first = new Map(), mapping = {};
  for (const [id, suggestion] of Object.entries(suggestions)) {
    if (suggestion?.level !== 'strong' || !suggestion.person) continue;
    if (first.has(suggestion.person)) mapping[id] = first.get(suggestion.person);
    else first.set(suggestion.person, id);
  }
  return mapping;
}

export async function embedSpeakers({ embedder, samples, turns, offsetSeconds = 0 }) {
  const mean = fbankMean(samples);
  const result = {};
  for (const id of new Set(turns.map(turn => turn.speaker))) {
    const audio = concatTurnsAudio(samples, turns.filter(turn => turn.speaker === id), offsetSeconds);
    if (audio.length) result[id] = await embedder.embed(audio, mean);
  }
  return result;
}
