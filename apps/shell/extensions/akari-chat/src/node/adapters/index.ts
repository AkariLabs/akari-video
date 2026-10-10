import type { ChatAdapter } from './adapter';
import { ClaudeStreamJsonAdapter } from './claude-stream-json';
import { CodexAppServerAdapter } from './codex-app-server';
import { AcpAdapter } from './acp';
import { acpAgents } from './acp-agents';

export const chatAdapters: ChatAdapter[] = [
    new ClaudeStreamJsonAdapter(),
    new CodexAppServerAdapter(),
    ...acpAgents.map(agent => new AcpAdapter(agent))
];
