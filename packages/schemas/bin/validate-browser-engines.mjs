#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

function blockedHost(host) {
  const name = host.toLowerCase().replace(/\.$/u, '');
  const ip = name.split('.').map(Number);
  const privateIpv4 = ip.length === 4 && ip.every(n => Number.isInteger(n) && n >= 0 && n <= 255)
    && (ip[0] === 0 || ip[0] === 10 || ip[0] === 127 || ip[0] === 169 && ip[1] === 254
      || ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31 || ip[0] === 192 && ip[1] === 168);
  if (privateIpv4 || name === 'localhost' || name.endsWith('.localhost') ||
    name.endsWith('.local') || name.endsWith('.internal')) return true;
  if (!name.startsWith('[')) return false;
  const ipv6 = name.slice(1, -1);
  const first = Number.parseInt(ipv6.split(':').find(Boolean) ?? '0', 16);
  if (ipv6 === '::' || ipv6 === '::1' || first >= 0xfc00 && first <= 0xfdff ||
    first >= 0xfe80 && first <= 0xfebf) return true;
  if (ipv6.startsWith('::ffff:')) {
    const words = ipv6.slice(7).split(':');
    if (words.length === 2) {
      const hi = Number.parseInt(words[0], 16); const lo = Number.parseInt(words[1], 16);
      return blockedHost(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
  }
  return false;
}

export function validateBrowserEngines(data, schema) {
  const errors = [];
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  if (!validate(data)) return (validate.errors ?? []).map(error => `${error.instancePath}: ${error.message}`);
  const ids = new Set();
  for (const engine of data.engines) {
    if (ids.has(engine.id)) errors.push(`重複 id: ${engine.id}`);
    ids.add(engine.id);
    if (engine.template.split('{q}').length !== 2) errors.push(`${engine.id}: {q} は 1 回必要です`);
    try {
      const url = new URL(engine.template.replace('{q}', 'query'));
      if (url.protocol !== 'https:' || url.username || url.password || blockedHost(url.hostname))
        errors.push(`${engine.id}: ホストまたは資格情報が不正です`);
    } catch { errors.push(`${engine.id}: URL が不正です`); }
  }
  return errors;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const root = path.resolve(process.argv[2] ?? fileURLToPath(new URL('../../../catalog', import.meta.url)));
  const schema = JSON.parse(fs.readFileSync(new URL('../browser-engines.schema.json', import.meta.url), 'utf8'));
  let data;
  try { data = JSON.parse(fs.readFileSync(path.join(root, 'browser/browser-engines.json'), 'utf8')); }
  catch (error) { console.error(`browser-engines.json: ${error}`); process.exit(1); }
  const errors = validateBrowserEngines(data, schema);
  if (errors.length) { for (const error of errors) console.error(error); process.exit(1); }
  console.log(`OK: ${data.engines.length} browser engines`);
}
