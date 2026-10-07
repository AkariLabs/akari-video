const identity = text => ({ text, applied: [] });

export function createPipeline({ dictionary = identity, classify = () => 'speech' } = {}) {
  let nextId = 1;
  let currentId;
  return {
    push({ text, final, t, confidence }) {
      const raw = String(text ?? '');
      const result = dictionary(raw, { final: final === true });
      currentId ??= `utterance-${nextId++}`;
      const id = currentId;
      if (final === true) currentId = undefined;
      return { id, raw, text: result.text, final: final === true,
        applied: result.applied ?? [], t, kind: classify(result.text),
        ...(Number.isFinite(confidence) ? { confidence } : {}) };
    }
  };
}
