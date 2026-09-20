import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/browser/akari-menu-widget.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariMenuWidget');
const method = name => {
    const member = declaration?.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === name);
    assert.ok(member?.body, name);
    return member;
};

for (const name of ['focusSection', 'listSkills']) {
    test(`${name} is public`, () => {
        const modifiers = method(name).modifiers ?? [];
        assert.ok(!modifiers.some(node => node.kind === ts.SyntaxKind.ProtectedKeyword || node.kind === ts.SyntaxKind.PrivateKeyword));
    });
}

test('render marks the sections, headings and skill rows', () => {
    const render = method('render').getText(ast);
    assert.match(render, /<section data-akari-menu-section='open'[^>]*>\s*<h3 data-akari-menu-section-heading[^>]*>ひらく<\/h3>/);
    assert.match(render, /<section data-akari-menu-section='skills'>\s*<h3 data-akari-menu-section-heading[^>]*>やらせる（スキル）<\/h3>/);
    assert.match(render, /<li key=\{skill.name\} data-akari-menu-skill=\{skill.name\}/);
});

test('widget keeps external focus separate from partner actions', () => {
    const forbidden = new RegExp(['inject', 'Prompt'].join('') + '|\u983c\u3080');
    assert.doesNotMatch(source, forbidden);
    assert.doesNotMatch(source, /from\s+['"][^'"]*akari-partner/);
    assert.ok(!declaration.members.some(node => node.name?.getText(ast) === 'requestSkill'));
});

test('stylesheet loading is guarded for node tests', () => {
    assert.match(source, /try\s*\{\s*require\('\.\.\/\.\.\/src\/browser\/style\/menu-focus-pulse\.css'\);\s*\}\s*catch\s*\{/);
});

// Full method from 29e959c4, including its declaration and body.
const baselineExportSection = `protected renderExportSection(): React.ReactNode {
        const status = this.exportSession.snapshot.status;
        const running = status.phase === 'linting' || status.phase === 'rendering';
        const visible = running || status.phase === 'done' || status.phase === 'failed' || status.phase === 'lint-failed';
        const percent = status.progressPercent ?? 0;
        const stage = quickExportStageLabel(status.progressStage);
        const label = running
            ? \`\${stage ?? (status.phase === 'linting' ? 'lint 確認中' : '準備')} · \${percent}%\`
            : status.phase === 'done'
                ? '書き出し完了'
                : status.phase === 'lint-failed' ? 'lint NG' : '書き出し失敗';
        return (
            <section style={{ marginBottom: '22px' }}>
                <h3 style={{ margin: '0 0 8px', fontSize: '0.85em', opacity: 0.6, letterSpacing: '0.05em' }}>書き出し</h3>
                <button
                    className='theia-button secondary'
                    style={{ display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'flex-start', padding: '8px 10px', width: '100%' }}
                    disabled={!this.editJsonExists}
                    title={!this.editJsonExists ? EDIT_JSON_MISSING_TOOLTIP : undefined}
                    onClick={() => void this.openExportDialog()}
                >
                    <span className='codicon codicon-desktop-download' aria-hidden='true' />
                    <span>書き出し…</span>
                </button>
                {!this.editJsonExists && (
                    <p style={{ opacity: 0.6, fontSize: '0.85em', margin: '6px 0 0' }}>{EDIT_JSON_MISSING_TOOLTIP}</p>
                )}
                {visible && (
                    <div data-akari-export-mini-status={status.phase} style={{ marginTop: '8px', border: '1px solid var(--theia-widget-border)', borderRadius: '6px', padding: '7px 9px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82em' }}>
                            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                            <button className='theia-button secondary' style={{ marginLeft: 'auto', padding: '2px 7px', fontSize: '0.82em' }} onClick={() => void this.openExportDialog()}>開く</button>
                        </div>
                        {running && (
                            <div style={{ height: '4px', borderRadius: '2px', background: 'var(--akari-elevated, rgba(128,128,128,0.25))', overflow: 'hidden', marginTop: '5px' }}>
                                <div style={{ height: '100%', width: \`\${percent}%\`, background: 'var(--akari-accent, #f97316)', transition: 'width .2s linear' }} />
                            </div>
                        )}
                    </div>
                )}
                <button
                    className='theia-button secondary'
                    style={{ display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'flex-start', padding: '8px 10px', width: '100%', marginTop: '8px' }}
                    disabled={!this.workspaceOpened || this.cleaningProject}
                    title='書き出しの一時ファイルや再生成できるキャッシュを、一覧で確認してから削除します'
                    onClick={() => void this.cleanProjectData()}
                >
                    <span className={\`codicon \${this.cleaningProject ? 'codicon-loading codicon-modifier-spin' : 'codicon-trash'}\`} aria-hidden='true' />
                    <span>{this.cleaningProject ? '調べています…' : '不要なデータを整理…'}</span>
                </button>
            </section>
        );
    }`;

test('renderExportSection exactly matches 29e959c4', () => {
    assert.equal(method('renderExportSection').getText(ast), baselineExportSection);
});
