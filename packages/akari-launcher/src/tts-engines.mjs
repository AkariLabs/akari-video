// fal TTS の追加点。価格の verified は fal の課金単位を確認できた場合だけ true にする。
const geminiVoices = Object.entries({
  Leda: 'Youthful', Achernar: 'Soft', Achird: 'Friendly', Algenib: 'Gravelly',
  Algieba: 'Smooth', Alnilam: 'Firm', Aoede: 'Breezy', Autonoe: 'Bright',
  Callirrhoe: 'Easy-going', Charon: 'Informative', Despina: 'Smooth',
  Enceladus: 'Breathy', Erinome: 'Clear', Fenrir: 'Excitable', Gacrux: 'Mature',
  Iapetus: 'Clear', Kore: 'Firm', Laomedeia: 'Upbeat', Orus: 'Firm',
  Pulcherrima: 'Forward', Puck: 'Upbeat', Rasalgethi: 'Informative',
  Sadachbia: 'Lively', Sadaltager: 'Knowledgeable', Schedar: 'Even',
  Sulafat: 'Warm', Umbriel: 'Easy-going', Vindemiatrix: 'Gentle',
  Zephyr: 'Bright', Zubenelgenubi: 'Casual',
}).map(([id, description]) => ({ id, label: `${id}（${description}）`, ...(id === 'Leda' ? { default: true } : {}) }));

const price = (unit, value, verified = false, as_of = '2026-09-24') => ({ unit, value, verified, as_of });
const audio = result => result?.audio?.url;
const fixture = endpoint => `${endpoint.replaceAll('/', '_')}.json`;
const row = (id, label, endpoint, details) => ({
  id, label, provider: 'fal', place: 'cloud', endpoint,
  openapi_fixture: fixture(endpoint), ...details, parseAudio: audio,
  request: (payload, key) => ({ url: `https://fal.run/${endpoint}`, options: {
    method: 'POST', headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  } }),
});

export const FAL_TTS_ENGINES = Object.freeze([
  row('gemini-tts', 'Gemini 2.5 Flash TTS', 'fal-ai/gemini-tts', {
    openapi_fixture: 'fal_gemini-tts.json',
    price: price('usd_per_1000_chars', 0.05, false, '2026-09-22'), voices: geminiVoices,
    default_voice: 'Leda', supports: { speed: false, style: true, clone: 'none' },
    buildPayload: ({ text, voice, style }) => ({ prompt: text, voice, model: 'gemini-2.5-flash-tts', output_format: 'mp3',
      language_code: 'Japanese (Japan)', ...(style ? { style_instructions: style } : {}) }),
  }),
  row('fal-qwen3', 'fal Qwen3-TTS', 'fal-ai/qwen-3-tts/text-to-speech/1.7b', {
    price: price('usd_per_1000_chars', 0.09), voices: null,
    default_voice: null, supports: { speed: false, style: false, clone: 'registered' },
    buildPayload: ({ text, profileMeta }) => ({ text, language: 'Japanese',
      speaker_voice_embedding_file_url: profileMeta.embedding_source_url,
      reference_text: profileMeta.reference_text, max_new_tokens: 2048 }),
  }),
  row('gemini-3.1-flash-tts', 'Gemini 3.1 Flash TTS（既製の声）', 'fal-ai/gemini-3.1-flash-tts', {
    price: price(null, null), voices: geminiVoices, default_voice: 'Leda',
    supports: { speed: false, style: true, clone: 'none' },
    buildPayload: ({ text, voice, style }) => ({ prompt: text, voice, output_format: 'mp3',
      language_code: 'Japanese (Japan)', ...(style ? { style_instructions: style } : {}) }),
  }),
  row('elevenlabs-v3', 'ElevenLabs v3（既製の声）', 'fal-ai/elevenlabs/tts/eleven-v3', {
    price: price('usd_per_1000_chars', 0.10),
    voices: ['Rachel', 'Aria', 'Sarah', 'Laura', 'Charlie', 'George', 'River', 'Liam', 'Charlotte', 'Alice']
      .map(id => ({ id, label: id, ...(id === 'Rachel' ? { default: true } : {}) })),
    default_voice: 'Rachel', supports: { speed: false, style: false, clone: 'none' },
    buildPayload: ({ text, voice }) => ({ text, voice, language_code: 'ja' }),
  }),
  row('minimax-2.6-hd', 'MiniMax Speech 2.6 HD（自分の声対応）', 'fal-ai/minimax/speech-2.6-hd', {
    price: price(null, null),
    voices: ['Wise_Woman', 'Friendly_Person', 'Inspirational_girl', 'Deep_Voice_Man',
      'Calm_Woman', 'Casual_Guy', 'Lively_Girl', 'Patient_Man', 'Lovely_Girl', 'Elegant_Man']
      .map(id => ({ id, label: id, ...(id === 'Wise_Woman' ? { default: true } : {}) })),
    default_voice: 'Wise_Woman', supports: { speed: true, style: false, clone: 'registered' },
    buildPayload: ({ text, voice, profileMeta, speed }) => ({ prompt: text, language_boost: 'Japanese',
      output_format: 'url', voice_setting: { voice_id: profileMeta?.engines?.['minimax-2.6-hd']?.custom_voice_id ?? voice,
        ...(speed != null ? { speed } : {}) } }),
  }),
  row('chatterbox', 'Chatterbox 多言語（参照音声対応）', 'fal-ai/chatterbox/text-to-speech/multilingual', {
    price: price('usd_per_1000_chars', 0.025), voices: [{ id: 'japanese', label: '日本語', default: true }], default_voice: 'japanese',
    supports: { speed: false, style: false, clone: 'per-request' },
    buildPayload: ({ text, audioUrl }) => ({ text, voice: audioUrl ?? 'japanese',
      ...(audioUrl ? { custom_audio_language: 'japanese' } : {}) }),
  }),
  row('index-tts-2', 'Index TTS 2（参照音声対応）', 'fal-ai/index-tts-2/text-to-speech', {
    price: price('usd_per_second', 0.002), voices: null, default_voice: null,
    supports: { speed: false, style: false, clone: 'per-request' },
    buildPayload: ({ text, audioUrl }) => ({ prompt: text, audio_url: audioUrl }),
  }),
]);

export const falTtsEngine = id => FAL_TTS_ENGINES.find(engine => engine.id === id);

const fishVoices = [
  ['5161d41404314212af1254556477c17d', '元気な女性'],
  ['46745543e52548238593a3962be77e3a', 'ふうか'],
  ['63bc41e652214372b15d9416a30a60b4', '元気な女性v2'],
  ['0089dce5fefb4c6ba9b9f2f0debe1ddc', '落ち着いた女性'],
  ['45c5d3723c9c42f598e4776dcfd5f02d', '落ち着いた男性'],
].map(([id, label], index) => ({ id, label, ...(index === 0 ? { default: true } : {}) }));

const fishStyle = style => {
  const value = style?.trim();
  if (!value) return '';
  return /^(?:\[[^\[\]]+\])+$/.test(value) ? value : `[${value}]`;
};

// Fish の TTSRequest.references はバイナリ音声を含み、公式 OpenAPI は MessagePack 必須とする。
// 保存済み model ID を作らず正本録音を毎回送るため、声の更新と撤回がローカルの正本に従う。
function msgpack(value) {
  const parts = [];
  const write = (head, data) => { parts.push(Buffer.from(head)); if (data) parts.push(data); };
  const encode = item => {
    if (Buffer.isBuffer(item)) { const head = Buffer.alloc(5); head[0] = 0xc6; head.writeUInt32BE(item.length, 1); write(head, item); }
    else if (typeof item === 'string') { const data = Buffer.from(item); const head = Buffer.alloc(5); head[0] = 0xdb; head.writeUInt32BE(data.length, 1); write(head, data); }
    else if (Array.isArray(item)) { const head = Buffer.alloc(5); head[0] = 0xdd; head.writeUInt32BE(item.length, 1); write(head); item.forEach(encode); }
    else if (item && typeof item === 'object') { const entries = Object.entries(item); const head = Buffer.alloc(5); head[0] = 0xdf; head.writeUInt32BE(entries.length, 1); write(head); for (const [key, value] of entries) { encode(key); encode(value); } }
    else throw new TypeError('MessagePack の値が不正です');
  };
  encode(value);
  return Buffer.concat(parts);
}

export function pcmToWav(pcm) {
  if (pcm.length % 2) throw new Error('PCM のバイト数が不正です');
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28); header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function parseGeminiAudio(result) {
  const content = result?.steps?.filter(step => step.type === 'model_output').flatMap(step => step.content ?? [])
    .find(part => part.type === 'audio' && typeof part.data === 'string');
  if (!content) throw new Error('Gemini API の応答に音声がありません');
  const bytes = Buffer.from(content.data, 'base64');
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE') return bytes;
  if (content.mime_type === 'audio/l16') return pcmToWav(bytes);
  throw new Error(`Gemini API の音声形式に対応していません: ${content.mime_type ?? 'unknown'}`);
}

export const DIRECT_TTS_ENGINES = Object.freeze([
  {
    id: 'fish-s2.1-pro', label: 'Fish Audio S2.1-Pro', provider: 'fish-audio', place: 'cloud',
    endpoint: 'https://api.fish.audio/v1/tts', openapi_fixture: 'direct/fish-audio.md',
    price: price('usd_per_1000_chars', 0.045, true), voices: fishVoices,
    default_voice: fishVoices[0].id, supports: { speed: false, style: true, clone: 'per-request' },
    buildPayload: ({ text, voice, style, referenceAudio, referenceText }) => ({
      text: style?.trim() ? `${fishStyle(style)} ${text}` : text,
      ...(referenceAudio ? { references: [{ audio: referenceAudio, text: referenceText }] } : { reference_id: voice }),
      format: 'mp3',
    }),
    request: (payload, key) => ({ url: 'https://api.fish.audio/v1/tts', options: {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, model: 's2.1-pro',
        'Content-Type': payload.references ? 'application/msgpack' : 'application/json' },
      body: payload.references ? msgpack(payload) : JSON.stringify(payload),
    } }),
  },
  {
    id: 'gemini-3.8-flash-tts', label: 'Gemini 3.8 Flash TTS', provider: 'google-ai', place: 'cloud',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/interactions', openapi_fixture: 'direct/gemini-tts.md',
    price: price('usd_per_second', 9 * 25 / 1_000_000, true), voices: geminiVoices,
    default_voice: 'Leda', supports: { speed: false, style: true, clone: 'none' },
    buildPayload: ({ text, voice, style }) => ({ model: 'gemini-3.8-flash-tts', input: [{ type: 'user_input',
      content: [{ type: 'text', text, ...(style ? { annotations: [{ type: 'speech_metadata', style }] } : {}) }] }],
      response_format: { type: 'audio', mime_type: 'audio/l16', sample_rate: 24000 },
      generation_config: { speech_config: [{ voice }] },
    }),
    request: (payload, key) => ({ url: 'https://generativelanguage.googleapis.com/v1beta/interactions', options: {
      method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    } }),
    parseAudio: parseGeminiAudio,
  },
]);

export const ttsEngine = id => falTtsEngine(id) ?? DIRECT_TTS_ENGINES.find(engine => engine.id === id);

export const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;

export function referenceDataUri(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new Error('参照音声のデータが不正です');
  if (bytes.length > MAX_REFERENCE_BYTES) throw new Error('20 MB 超の参照音声は送信できません');
  return `data:audio/wav;base64,${bytes.toString('base64')}`;
}

export function estimateTtsCost(engine, text) {
  if (engine.id === 'fish-s2.1-pro') return Number((Buffer.byteLength(text, 'utf8') * 15 / 1_000_000).toFixed(6));
  const { unit, value } = engine.price;
  if (value == null) return null;
  if (unit === 'usd_per_1000_chars') return Number((text.length * value / 1000).toFixed(6));
  if (unit === 'usd_per_second') return Number((text.length / 5 * value).toFixed(6)); // 日本語約 5 字/秒の概算
  if (unit === 'usd_per_request') return value;
  return null;
}
