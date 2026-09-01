import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(here, '..');
const browserSourceRoot = join(extensionRoot, 'src', 'browser');

function sourceFilesUnder(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return sourceFilesUnder(path);
        return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
    });
}

function templateText(expression) {
    if (ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
    if (!ts.isTemplateExpression(expression)) return undefined;
    return expression.head.text + expression.templateSpans
        .map(span => `0${span.literal.text}`)
        .join('');
}

function returnedTemplates(node) {
    const found = [];
    if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
        const text = templateText(node.body);
        if (text !== undefined) found.push(text);
        return found;
    }
    const body = node.body;
    if (!body) return found;
    const visit = current => {
        if (current !== body && ts.isFunctionLike(current)) return;
        if (ts.isReturnStatement(current) && current.expression) {
            const text = templateText(current.expression);
            if (text !== undefined) found.push(text);
            return;
        }
        ts.forEachChild(current, visit);
    };
    visit(body);
    return found;
}

function scriptTemplates() {
    const found = [];
    for (const path of sourceFilesUnder(browserSourceRoot)) {
        const source = readFileSync(path, 'utf8');
        const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        const visit = node => {
            let name;
            let callable;
            if (ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) {
                name = node.name && ts.isIdentifier(node.name) ? node.name.text : undefined;
                callable = node;
            } else if (ts.isVariableDeclaration(node)
                && ts.isIdentifier(node.name)
                && node.initializer
                && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
                name = node.name.text;
                callable = node.initializer;
            }
            if (name?.endsWith('Script') && callable) {
                returnedTemplates(callable).forEach((text, index) => found.push({
                    name,
                    text,
                    index,
                    source: relative(extensionRoot, path)
                }));
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
    }
    return found;
}

function syntaxFailure(template) {
    const filename = `webview-${template.name}-${template.index + 1}.js`;
    try {
        new vm.Script(template.text, { filename });
        return undefined;
    } catch (error) {
        const stack = error instanceof Error ? error.stack ?? '' : '';
        const match = stack.match(new RegExp(`${filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+)`));
        const lineNumber = Number(match?.[1] ?? 0);
        const line = lineNumber > 0 ? template.text.split('\n')[lineNumber - 1] ?? '' : '';
        const message = error instanceof Error ? error.message : String(error);
        return `${template.source}: ${template.name} のテンプレート ${template.index + 1}`
            + ` / ${lineNumber || '?'} 行目: ${line}\n${message}`;
    }
}

test('Script で終わる webview 生成関数の全テンプレートが JavaScript として妥当', () => {
    const templates = scriptTemplates();
    assert.ok(templates.length >= 4, `検査対象テンプレートが少なすぎます: ${templates.length} 件`);
    const failures = templates.map(syntaxFailure).filter(Boolean);
    assert.deepEqual(failures, [], failures.join('\n\n'));
});
