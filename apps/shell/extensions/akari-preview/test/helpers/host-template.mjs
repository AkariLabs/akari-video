import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);

export function evaluateHostTemplate(text, fragment) {
    const bindings = {};
    const imports = new Map();
    for (const match of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*'([^']+)'/gu)) {
        for (const specifier of match[1].split(',')) {
            const item = specifier.trim();
            if (!item || item.startsWith('type ')) continue;
            const [exported, local = exported] = item.split(/\s+as\s+/u);
            imports.set(local, { exported, module: match[2] });
        }
    }
    for (const match of fragment.matchAll(/\$\{(?:JSON\.stringify\()?([A-Za-z_$][\w$]*)(?:\)|\.toString\(\))?\}/gu)) {
        const name = match[1];
        if (Object.hasOwn(bindings, name)) continue;
        const imported = imports.get(name);
        assert.ok(imported, `missing host import for template binding: ${name}`);
        const modulePath = imported.module === '@akari-video/edit-store'
            ? fileURLToPath(new URL('../../../../../../packages/edit-store/lib/index.js', import.meta.url))
            : imported.module.startsWith('.')
                ? fileURLToPath(new URL(imported.module.endsWith('.mjs') ? imported.module : `${imported.module}.js`, new URL('../../lib/browser/', import.meta.url)))
                : imported.module;
        const module = require(modulePath);
        assert.ok(Object.hasOwn(module, imported.exported), `missing host export: ${name}`);
        bindings[name] = module[imported.exported];
    }
    return vm.runInNewContext('`' + fragment + '`', bindings);
}
