import type { Evidence } from './types.js';

export function canReplay(evidence: Evidence): boolean {
  if (evidence.type === 'http') {
    return !!(evidence.request && evidence.target?.url);
  }
  if (evidence.type === 'command') {
    return !!evidence.command;
  }
  return false;
}

export function replayDescription(evidence: Evidence): string {
  if (evidence.type === 'http' && evidence.target?.url) {
    const req = evidence.request as Record<string, unknown> | undefined;
    const method = (req?.method as string) ?? 'GET';
    return `Replay HTTP ${method} ${evidence.target.url}`;
  }
  if (evidence.type === 'command' && evidence.command) {
    return `Replay command: ${evidence.command}`;
  }
  return 'Cannot replay: insufficient evidence data';
}
