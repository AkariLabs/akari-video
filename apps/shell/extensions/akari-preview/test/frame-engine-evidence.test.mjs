import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import {
    createEvidenceRedactor,
    localPathValueKeys
} from '../evidence/frame-engine-boot/scripts/redact.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(here, '..');
const scriptsRoot = join(extensionRoot, 'evidence', 'frame-engine-boot', 'scripts');
const runL1Path = join(scriptsRoot, 'run-l1.mjs');
const runL1 = readFileSync(runL1Path, 'utf8');
const runL1Shell = readFileSync(join(scriptsRoot, 'run-l1.sh'), 'utf8');

function templateText(expression) {
    if (ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
    if (!ts.isTemplateExpression(expression)) return undefined;
    return expression.head.text + expression.templateSpans
        .map(span => `0${span.literal.text}`)
        .join('');
}

test('L1 探針が CDP へ送る全テンプレートは JavaScript として妥当', () => {
    const sourceFile = ts.createSourceFile(
        runL1Path,
        runL1,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS
    );
    const templates = [];
    const visit = node => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
            const argumentIndex = node.expression.text === 'evalOn'
                ? 1
                : node.expression.text === 'vEval'
                    ? 0
                    : -1;
            if (argumentIndex >= 0 && node.arguments[argumentIndex]) {
                const text = templateText(node.arguments[argumentIndex]);
                if (text !== undefined) templates.push(text);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    assert.ok(templates.length >= 8, `CDP JavaScript テンプレートが少なすぎます: ${templates.length}`);
    templates.forEach((text, index) => {
        assert.doesNotThrow(
            () => new vm.Script(text, { filename: `frame-engine-evidence-cdp-${index + 1}.js` }),
            `CDP JavaScript テンプレート ${index + 1} が構文不正です:\n${text}`
        );
    });
});

test('L1 shell は mktemp を実体パス化し JSON options を無改変で渡す', () => {
    assert.match(runL1Shell, /WORKSPACE=\$\(cd "\$\(mktemp -d \/tmp\/[^"]+\)" && pwd -P\)/u);
    assert.match(runL1Shell, /USER_DATA=\$\(cd "\$\(mktemp -d \/tmp\/[^"]+\)" && pwd -P\)/u);
    assert.match(runL1Shell, /OPTIONS=\$\{2:-\}\s+if \[ -z "\$OPTIONS" \]; then\s+OPTIONS='\{\}'/u);
    assert.doesNotMatch(runL1Shell, /OPTIONS=\$\{2:-\{\}\}/u);
});

test('L1 証跡 redaction は raw/realpath と入れ子値を伏せ HTTP URL を保持する', () => {
    const workspaceRaw = mkdtempSync('/tmp/akari-redact-workspace-');
    const outRaw = mkdtempSync(join(tmpdir(), 'akari-redact-out-'));
    try {
        const workspaceReal = realpathSync(workspaceRaw);
        const redact = createEvidenceRedactor({
            repoDir: extensionRoot,
            workspaceDir: workspaceRaw,
            outDir: outRaw,
            homeDir: homedir()
        });
        const httpUrl = 'http://probe.webview.localhost:4567/webview/index.html?id=fixture';
        const result = redact({
            repo: `file://${extensionRoot}/lib/frontend/bundle.js:11:9216`,
            workspace: [
                `${workspaceRaw}/project/edit.json`,
                `${workspaceReal}/project/edit.json`
            ],
            out: `${outRaw}/engine-on-window.png`,
            home: `${homedir()}/Library/Caches/fixture.log`,
            residual: [
                'file:///Users/another/project/bundle.js:2:3',
                '/private/tmp/unrelated/file.txt',
                '/tmp/unrelated/file.txt',
                '/var/folders/aa/cache/file.txt'
            ],
            httpUrl
        });
        assert.equal(result.repo, '<repo>/lib/frontend/bundle.js:11:9216');
        assert.deepEqual(result.workspace, [
            '<workspace>/project/edit.json',
            '<workspace>/project/edit.json'
        ]);
        assert.equal(result.out, '<out>/engine-on-window.png');
        assert.equal(result.home, '<home>/Library/Caches/fixture.log');
        assert.deepEqual(result.residual, ['<path>', '<path>', '<path>', '<path>']);
        assert.equal(result.httpUrl, httpUrl);
        assert.deepEqual(localPathValueKeys(result), []);
        assert.doesNotMatch(JSON.stringify(result), /\/Users\//u);
        assert.ok(Object.hasOwn(redact({ '/Users/key-is-not-a-value': 'safe' }), '/Users/key-is-not-a-value'));
    } finally {
        rmSync(workspaceRaw, { recursive: true, force: true });
        rmSync(outRaw, { recursive: true, force: true });
    }
});

test('L1 探針は書き出し前に payload 全体を伏せ、漏えいキーを stderr 付きで拒否する', () => {
    assert.match(runL1, /const redact = value => redactValue\(value\);/u);
    assert.match(runL1, /const redactedPayload = redact\(payload\);/u);
    assert.match(runL1, /const leakedKeys = localPathValueKeys\(redactedPayload\);/u);
    assert.match(runL1, /payloadJson\.includes\('\/Users\/'\)/u);
    assert.match(runL1, /console\.error\(`\[frame-engine-boot\] local absolute path redaction failed:/u);
});
