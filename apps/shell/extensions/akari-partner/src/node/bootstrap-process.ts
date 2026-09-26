import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { PartnerAgentId } from '../common/akari-partner-protocol';

/** Run the self-contained bootstrap source without putting it on the command line. */
export function spawnBootstrapProcess(
    runtimePath: string,
    runnerSource: string,
    agent: PartnerAgentId,
    env: NodeJS.ProcessEnv
): ChildProcessWithoutNullStreams {
    const child = spawn(runtimePath, ['-', agent], {
        env,
        stdio: ['pipe', 'pipe', 'pipe']
    });
    child.stdin.on('error', error => child.emit('error', error));
    child.stdin.end(runnerSource);
    return child;
}
