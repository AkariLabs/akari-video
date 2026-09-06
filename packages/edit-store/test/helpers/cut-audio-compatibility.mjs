import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { serializeEdit } from '../../lib/canonical.js';
import { migrateEditToV2, planV2Normalization } from '../../lib/migrate/index.js';

export const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));

export async function compatibilityFixtures() {
  const schema = JSON.parse(await readFile(join(repositoryRoot, 'packages/schemas/edit.schema.json'), 'utf8'));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  const paths = [];
  async function visit(directory, examples = false) {
    for (const entry of await readdir(join(repositoryRoot, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('edit-v2-cut-audio-')) await visit(path, examples);
      } else if (entry.name.endsWith('.json') && (!examples || entry.name === 'edit.json')) {
        const value = JSON.parse(await readFile(join(repositoryRoot, path), 'utf8'));
        if (value && !Array.isArray(value) && (!examples || validate(value))) paths.push(path);
      }
    }
  }
  await visit('packages/edit-store/test/fixtures');
  await visit('packages/schemas/examples', true);
  return paths.sort();
}

// Store only portable output bytes, never proposal paths or timestamps.
export async function compatibilityBytes(path) {
  const fullPath = join(repositoryRoot, path);
  const original = await readFile(fullPath, 'utf8');
  const value = JSON.parse(original);
  const bytes = { canonical: serializeEdit(value) };
  if (value.version === 0 || value.version === 1) {
    const migrated = migrateEditToV2(value);
    bytes.migration = migrated.ok ? serializeEdit(migrated.doc) : null;
  } else if (value.version === 2) {
    const normalized = planV2Normalization(dirname(fullPath), fullPath, original);
    bytes.normalization = 'nextText' in normalized ? normalized.nextText : null;
  }
  return bytes;
}
