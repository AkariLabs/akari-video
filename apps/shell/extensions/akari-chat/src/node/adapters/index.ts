import type { ChatAdapter } from './adapter';
import { ClaudeStreamJsonAdapter } from './claude-stream-json';
import { CodexAppServerAdapter } from './codex-app-server';
import { AcpAdapter } from './acp';
import { acpAgents } from './acp-agents';
import { AgyStreamJsonAdapter } from './agy-stream-json';

export const chatAdapters: ChatAdapter[] = [
    new ClaudeStreamJsonAdapter(),
    new CodexAppServerAdapter(),
    new AgyStreamJsonAdapter(),
    ...acpAgents.map(agent => new AcpAdapter(agent))
];
