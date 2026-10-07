export const DSH_CWD_WORKSPACE_PLUGIN_SOURCE = `import { statSync } from 'node:fs';

export const name = 'akari-cwd-workspace';
export const inject = ['workspaceRegistry'];

function watchParent() {
    const raw = process.env.AKARI_PARTNER_PARENT_PID;
    if (!raw || !/^[1-9][0-9]*$/.test(raw)) return;
    const parentPid = Number(raw);
    if (!Number.isSafeInteger(parentPid)) return;
    const timer = setInterval(() => {
        try { process.kill(parentPid, 0); }
        catch (error) {
            if (error && error.code === 'ESRCH') {
                process.stderr.write('[akari-cwd-workspace] parent process exited; stopping dsh web\\n');
                process.exit(0);
            }
        }
    }, 2000);
    timer.unref();
}

export function apply(ctx) {
    watchParent();
    const run = async () => {
        try {
            const cwd = process.cwd();
            if (!statSync(cwd).isDirectory()) return;
            const registry = ctx.workspaceRegistry;
            const ws = await registry.create(cwd);
            try {
                const first = registry.list()[0];
                if (first && first.id !== ws.id) await registry.insertBefore(ws.id, first.id);
            } catch { /* Registration remains useful when ordering is unavailable. */ }
            process.stderr.write(\`[akari-cwd-workspace] registered \${cwd} as \${ws.id}\\n\`);
        } catch (error) {
            process.stderr.write(\`[akari-cwd-workspace] skipped: \${error instanceof Error ? error.message : String(error)}\\n\`);
        }
    };
    void run();
}

export default { name, inject, apply };
`;
