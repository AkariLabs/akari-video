'use strict';
/*
 * L1 evidence harness for task/2026-07-25-partner-plugin-autowire.
 * Scratch-only script (not part of the repo). Exercises the REAL compiled
 * bootstrapRunner() from apps/shell/extensions/akari-partner/lib/node/bootstrap-runner.js
 * the exact same way AkariPartnerServerImpl#bootstrap does (toString() -> `node -e`),
 * with HOME and AKARI_PARTNER_WORKSPACE_ROOT swapped to scratch directories,
 * and a real or stub `claude` executable depending on the scenario.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFileSync } = require('child_process');

const REPO_ROOT = '<WORKTREE>';
const RUNNER_PATH = path.join(REPO_ROOT, 'apps/shell/extensions/akari-partner/lib/node/bootstrap-runner.js');
const { bootstrapRunner } = require(RUNNER_PATH);
const runnerSource = `(${bootstrapRunner.toString()})()`;

const REAL_CLAUDE = fs.realpathSync(path.join(os.homedir(), '.local/bin/claude'));

const SCRATCH_ROOT = '/tmp/akari-plugin-autowire-l1';
const EVIDENCE_DIR = path.join(REPO_ROOT, 'apps/shell/extensions/akari-partner/evidence/partner-plugin-autowire');

const results = {};

function freshDir(p) {
    fs.rmSync(p, { recursive: true, force: true });
    fs.mkdirSync(p, { recursive: true });
}

function writeJson(p, value) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, `${JSON.stringify(value, null, 2)}\n`);
}

function readJsonOrNull(p) {
    try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
        return null;
    }
}

// Symlinks the real claude binary at <home>/.local/bin/claude so
// runClaudeInstaller()'s detection-first check (F46) reuses it (no network).
function linkRealClaude(home) {
    const dest = path.join(home, '.local', 'bin', 'claude');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.symlinkSync(REAL_CLAUDE, dest);
    return dest;
}

// Installs a stub claude at <home>/.local/bin/claude that records every
// invocation (argv + cwd) to <home>/invocations.jsonl and exits with `exitCode`.
function installStubClaude(home, exitCode) {
    const dest = path.join(home, '.local', 'bin', 'claude');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const invocationsLog = path.join(home, 'invocations.jsonl');
    const script = `#!/bin/sh
printf '%s\\n' "{\\"argv\\":\\"$*\\",\\"cwd\\":\\"$(pwd)\\"}" >> "${invocationsLog}"
exit ${exitCode}
`;
    fs.writeFileSync(dest, script, { mode: 0o755 });
    return { dest, invocationsLog };
}

function registerMarketplaceViaRealClaude(home) {
    execFileSync(REAL_CLAUDE, ['plugin', 'marketplace', 'add', REPO_ROOT], {
        env: { ...process.env, HOME: home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
}

function writeKnownMarketplacesDirectly(home) {
    writeJson(path.join(home, '.claude', 'plugins', 'known_marketplaces.json'), {
        akari: {
            source: { source: 'directory', path: REPO_ROOT },
            installLocation: REPO_ROOT,
            lastUpdated: '2026-07-25T00:00:00.000Z'
        }
    });
}

function runBootstrapRunner(home, projectDir, agent) {
    return new Promise(resolve => {
        const env = {
            ...process.env,
            HOME: home,
            ELECTRON_RUN_AS_NODE: '1',
            ...(projectDir ? { AKARI_PARTNER_WORKSPACE_ROOT: projectDir } : {})
        };
        const child = spawn(process.execPath, ['-e', runnerSource, agent], { env, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', chunk => { stdout += chunk.toString(); });
        child.stderr.on('data', chunk => { stderr += chunk.toString(); });
        child.on('exit', code => resolve({ code, stdout, stderr }));
    });
}

async function scenarioA() {
    // (a) unwired project + marketplace known -> install runs, in project cwd.
    const home = path.join(SCRATCH_ROOT, 'a-home');
    const project = path.join(SCRATCH_ROOT, 'a-project');
    freshDir(home);
    freshDir(project);
    linkRealClaude(home);
    registerMarketplaceViaRealClaude(home);

    const before = readJsonOrNull(path.join(project, '.claude', 'settings.json'));
    const run = await runBootstrapRunner(home, project, 'claude');
    const after = readJsonOrNull(path.join(project, '.claude', 'settings.json'));

    return {
        scenario: 'a) unwired + marketplace known -> install runs in project cwd',
        exitCode: run.code,
        stdout: run.stdout,
        stderr: run.stderr,
        settingsBefore: before,
        settingsAfter: after,
        pass: run.code === 0
            && before === null
            && after?.enabledPlugins?.['akari@akari'] === true
            && /akari プラグインを配線しました（project scope: .*a-project）/.test(run.stdout)
    };
}

async function scenarioB() {
    // (b) already enabled -> install must NOT be called (trap stub proves it).
    const home = path.join(SCRATCH_ROOT, 'b-home');
    const project = path.join(SCRATCH_ROOT, 'b-project');
    freshDir(home);
    freshDir(project);
    const { invocationsLog } = installStubClaude(home, 0);
    writeKnownMarketplacesDirectly(home);
    writeJson(path.join(project, '.claude', 'settings.json'), {
        enabledPlugins: { 'akari@akari': true }
    });

    const before = readJsonOrNull(path.join(project, '.claude', 'settings.json'));
    const run = await runBootstrapRunner(home, project, 'claude');
    const after = readJsonOrNull(path.join(project, '.claude', 'settings.json'));
    const stubInvoked = fs.existsSync(invocationsLog);

    return {
        scenario: 'b) enabledPlugins already present -> install NOT called',
        exitCode: run.code,
        stdout: run.stdout,
        stderr: run.stderr,
        settingsBefore: before,
        settingsAfter: after,
        stubInvoked,
        pass: run.code === 0
            && !stubInvoked
            && JSON.stringify(before) === JSON.stringify(after)
            && run.stdout.includes('akari プラグイン配線済み')
    };
}

async function scenarioC() {
    // (c) marketplace unknown -> install NOT called, warn, bootstrap succeeds.
    const home = path.join(SCRATCH_ROOT, 'c-home');
    const project = path.join(SCRATCH_ROOT, 'c-project');
    freshDir(home);
    freshDir(project);
    const { invocationsLog } = installStubClaude(home, 0);
    // Deliberately no known_marketplaces.json at all.

    const run = await runBootstrapRunner(home, project, 'claude');
    const stubInvoked = fs.existsSync(invocationsLog);
    const settingsAfter = readJsonOrNull(path.join(project, '.claude', 'settings.json'));

    return {
        scenario: 'c) marketplace unknown -> skip install, warn, bootstrap succeeds',
        exitCode: run.code,
        stdout: run.stdout,
        stderr: run.stderr,
        stubInvoked,
        settingsAfter,
        pass: run.code === 0
            && !stubInvoked
            && settingsAfter === null
            && run.stdout.includes('akari マーケットプレイスが未登録のため、スキル配線は手動が必要です')
    };
}

async function scenarioD() {
    // (d) install exits non-zero -> bootstrap still succeeds overall, warning logged.
    const home = path.join(SCRATCH_ROOT, 'd-home');
    const project = path.join(SCRATCH_ROOT, 'd-project');
    freshDir(home);
    freshDir(project);
    const { invocationsLog } = installStubClaude(home, 7);
    writeKnownMarketplacesDirectly(home);

    const run = await runBootstrapRunner(home, project, 'claude');
    const stubInvoked = fs.existsSync(invocationsLog);
    const invocationRecord = stubInvoked ? fs.readFileSync(invocationsLog, 'utf8').trim() : null;

    return {
        scenario: 'd) install exits non-zero -> bootstrap succeeds with a warning',
        exitCode: run.code,
        stdout: run.stdout,
        stderr: run.stderr,
        stubInvoked,
        invocationRecord,
        pass: run.code === 0
            && stubInvoked
            && run.stdout.includes('akari プラグインの配線に失敗しました')
            && run.stdout.includes('接続は続行します')
    };
}

async function scenarioENoWorkspace() {
    // Prerequisite-wiring edge case named in the task instructions: no workspace -> skip, warn, continue.
    const home = path.join(SCRATCH_ROOT, 'noworkspace-home');
    freshDir(home);
    const { invocationsLog } = installStubClaude(home, 0);
    writeKnownMarketplacesDirectly(home);

    const run = await runBootstrapRunner(home, undefined, 'claude');
    const stubInvoked = fs.existsSync(invocationsLog);

    return {
        scenario: '(prereq) no workspace root -> wiring step skipped, bootstrap succeeds',
        exitCode: run.code,
        stdout: run.stdout,
        stderr: run.stderr,
        stubInvoked,
        pass: run.code === 0
            && !stubInvoked
            && run.stdout.includes('workspace が見つからないためスキップします')
    };
}

async function scenarioEMerge() {
    // (e) existing .claude/settings.json with permissions -> non-destructive merge (REAL claude).
    const home = path.join(SCRATCH_ROOT, 'e-home');
    const project = path.join(SCRATCH_ROOT, 'e-project');
    freshDir(home);
    freshDir(project);
    linkRealClaude(home);
    registerMarketplaceViaRealClaude(home);

    const preExisting = {
        permissions: {
            allow: ['Read(./**)', 'Edit(./planning/**)', 'Edit(./exports/**)'],
            deny: ['Edit(/assets/**)']
        }
    };
    writeJson(path.join(project, '.claude', 'settings.json'), preExisting);

    const before = readJsonOrNull(path.join(project, '.claude', 'settings.json'));
    const run = await runBootstrapRunner(home, project, 'claude');
    const after = readJsonOrNull(path.join(project, '.claude', 'settings.json'));

    const permissionsPreserved = JSON.stringify(after?.permissions) === JSON.stringify(preExisting.permissions);
    const pluginEnabled = after?.enabledPlugins?.['akari@akari'] === true;

    return {
        scenario: 'e) pre-existing settings.json (permissions) -> non-destructive merge (REAL claude CLI)',
        exitCode: run.code,
        stdout: run.stdout,
        stderr: run.stderr,
        settingsBefore: before,
        settingsAfter: after,
        pass: run.code === 0 && permissionsPreserved && pluginEnabled
    };
}

async function scenarioFUserScopeUnchanged() {
    // (f) user-scope ~/.claude/settings.json enabledPlugins does not change.
    const home = path.join(SCRATCH_ROOT, 'f-home');
    const project = path.join(SCRATCH_ROOT, 'f-project');
    freshDir(home);
    freshDir(project);
    linkRealClaude(home);
    registerMarketplaceViaRealClaude(home);

    const userScopePath = path.join(home, '.claude', 'settings.json');
    const userScopeBefore = readJsonOrNull(userScopePath); // snapshot AFTER marketplace registration (out-of-band setup), BEFORE our code runs

    const run = await runBootstrapRunner(home, project, 'claude');

    const userScopeAfter = readJsonOrNull(userScopePath);

    return {
        scenario: 'f) user-scope ~/.claude/settings.json enabledPlugins unaffected by --scope project install',
        exitCode: run.code,
        stdout: run.stdout,
        stderr: run.stderr,
        userScopeBefore,
        userScopeAfter,
        pass: run.code === 0
            && !userScopeBefore?.enabledPlugins?.['akari@akari']
            && !userScopeAfter?.enabledPlugins?.['akari@akari']
            && JSON.stringify(userScopeBefore) === JSON.stringify(userScopeAfter)
    };
}

async function main() {
    fs.mkdirSync(SCRATCH_ROOT, { recursive: true });
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

    results.a = await scenarioA();
    results.b = await scenarioB();
    results.c = await scenarioC();
    results.d = await scenarioD();
    results.noWorkspace = await scenarioENoWorkspace();
    results.e = await scenarioEMerge();
    results.f = await scenarioFUserScopeUnchanged();

    fs.writeFileSync(path.join(EVIDENCE_DIR, 'l1-results.json'), `${JSON.stringify(results, null, 2)}\n`);

    let report = '# L1 実測ログ — task/2026-07-25-partner-plugin-autowire\n\n';
    report += `実行日時: ${process.env.AKARI_L1_TIMESTAMP || '(see file mtime)'}\n`;
    report += `claude 実体（実測に使用）: ${REAL_CLAUDE}\n`;
    report += 'REPO_ROOT: ' + REPO_ROOT + '\n\n';
    let allPass = true;
    for (const [key, r] of Object.entries(results)) {
        allPass = allPass && r.pass;
        report += `## ${key} — ${r.scenario}\n\n`;
        report += `- 結果: ${r.pass ? 'PASS' : 'FAIL'}\n`;
        report += `- exitCode: ${r.exitCode}\n`;
        if ('stubInvoked' in r) { report += `- stub claude 呼び出し: ${r.stubInvoked}\n`; }
        if ('invocationRecord' in r && r.invocationRecord) { report += `- stub 呼び出し記録: \`${r.invocationRecord}\`\n`; }
        if ('settingsBefore' in r) { report += `- settings.json (before): \`${JSON.stringify(r.settingsBefore)}\`\n`; }
        if ('settingsAfter' in r) { report += `- settings.json (after): \`${JSON.stringify(r.settingsAfter)}\`\n`; }
        if ('userScopeBefore' in r) { report += `- user-scope settings.json (before): \`${JSON.stringify(r.userScopeBefore)}\`\n`; }
        if ('userScopeAfter' in r) { report += `- user-scope settings.json (after): \`${JSON.stringify(r.userScopeAfter)}\`\n`; }
        report += '- stdout:\n```\n' + r.stdout.trim() + '\n```\n';
        if (r.stderr.trim()) {
            report += '- stderr:\n```\n' + r.stderr.trim() + '\n```\n';
        }
        report += '\n';
    }
    report += `## 総合\n\n全シナリオ ${allPass ? 'PASS' : 'FAIL あり'}\n`;
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'l1-report.md'), report);

    console.log(JSON.stringify({ allPass, results: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.pass])) }, null, 2));
    if (!allPass) {
        process.exitCode = 1;
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
