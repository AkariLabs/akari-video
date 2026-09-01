import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const HTTP_URL = /https?:\/\/[^\s"'<>]+/giu;
const LOCAL_FILE_URL = /file:\/\/\/(?:Users|private\/tmp|tmp|var\/folders|private\/var\/folders)\/[^\s"'<>)]*/gu;
const LOCAL_ABSOLUTE_PATH = /\/(?:Users|private\/tmp|tmp|var\/folders|private\/var\/folders)\/[^\s"'<>)]*/gu;

function withoutTrailingSlash(value) {
  return value.length > 1 ? value.replace(/\/+$/u, '') : value;
}

function pathVariants(value) {
  if (typeof value !== 'string' || !value) return [];
  const paths = new Set([withoutTrailingSlash(value)]);
  try {
    paths.add(withoutTrailingSlash(realpathSync(value)));
  } catch {}
  const variants = [];
  for (const candidate of paths) {
    if (candidate.startsWith('/')) {
      variants.push(withoutTrailingSlash(pathToFileURL(candidate).href));
      variants.push(`file://${candidate}`);
    }
    variants.push(candidate);
  }
  return [...new Set(variants)].sort((left, right) => right.length - left.length);
}

function redactString(value, rules) {
  const urls = [];
  let output = value.replace(HTTP_URL, url => {
    const marker = `\u0000AKARI_HTTP_${urls.length}\u0000`;
    urls.push(url);
    return marker;
  });
  for (const { variants, replacement } of rules) {
    for (const variant of variants) output = output.split(variant).join(replacement);
  }
  output = output.replace(LOCAL_FILE_URL, '<path>');
  output = output.replace(LOCAL_ABSOLUTE_PATH, '<path>');
  return output.replace(/\u0000AKARI_HTTP_(\d+)\u0000/gu, (_, index) => urls[Number(index)]);
}

export function createEvidenceRedactor({ repoDir, workspaceDir, outDir, homeDir }) {
  const rules = [
    { variants: pathVariants(repoDir), replacement: '<repo>' },
    { variants: pathVariants(workspaceDir), replacement: '<workspace>' },
    { variants: pathVariants(outDir), replacement: '<out>' },
    { variants: pathVariants(homeDir), replacement: '<home>' }
  ];
  const redact = value => {
    if (typeof value === 'string') return redactString(value, rules);
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item)]));
    }
    return value;
  };
  return redact;
}

export function localPathValueKeys(value) {
  const found = [];
  const visit = (item, keyPath) => {
    if (typeof item === 'string') {
      const withoutHttp = item.replace(HTTP_URL, '');
      if (LOCAL_FILE_URL.test(withoutHttp) || LOCAL_ABSOLUTE_PATH.test(withoutHttp)) found.push(keyPath);
      LOCAL_FILE_URL.lastIndex = 0;
      LOCAL_ABSOLUTE_PATH.lastIndex = 0;
      return;
    }
    if (Array.isArray(item)) {
      item.forEach((entry, index) => visit(entry, `${keyPath}[${index}]`));
      return;
    }
    if (item && typeof item === 'object') {
      Object.entries(item).forEach(([key, entry]) => visit(entry, `${keyPath}.${key}`));
    }
  };
  visit(value, '$');
  return found;
}
