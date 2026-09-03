// Friendly tool labels and arg previews, shared between the transcript
// view (src/ui/state.ts) and the permission prompt (src/ui/PermissionModal
// + MCP summarize). Display-only: the agent always works with raw tool
// names and args.

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  ask_user: 'Ask User',
  confirm_finding: 'Confirmed Finding',
  load_skill: 'Skill',
  mcp_browser_browser_navigate: 'Browser',
  mcp_browser_browser_click: 'Browser Click',
  web_fetch: 'Web Fetch',
  web_search: 'Web Search',
};

export function displayToolName(name: string): string {
  if (name.startsWith('mcp_browser_browser_')) return browserToolName(name);
  return TOOL_DISPLAY_NAMES[name] ?? name;
}

function browserToolName(name: string): string {
  if (TOOL_DISPLAY_NAMES[name]) return TOOL_DISPLAY_NAMES[name];
  const action = name.replace(/^mcp_browser_browser_/, '').replace(/_/g, ' ');
  return `Browser ${titleCase(action)}`;
}

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (m) => m.toUpperCase());
}

// For tools with a single, obvious argument worth showing bare instead of
// as JSON (e.g. the browser tool's `url`), returns that value as a string.
// Returns null when the tool has no special handling or the field is
// missing/empty — callers fall back to the raw JSON preview.
export function primaryToolArg(name: string, args: Record<string, unknown>): string | null {
  if (name === 'mcp_browser_browser_navigate') {
    const url = args.url;
    if (typeof url === 'string' && url) return url;
  }
  if (name === 'shell' || name === 'bash' || name === 'BashTool') {
    const cmd = args.command;
    if (typeof cmd === 'string' && cmd) return cmd;
  }
  if (name === 'http') {
    const method = typeof args.method === 'string' && args.method ? args.method.toUpperCase() : '';
    const url = typeof args.url === 'string' && args.url ? args.url : '';
    if (method && url) return `${method} ${url}`;
    if (url) return url;
  }
  if (name === 'confirm_finding') {
    const title = typeof args.title === 'string' ? args.title : '';
    const severity = typeof args.severity === 'string' ? args.severity : '';
    if (title) return severity ? `(${severity}) ${title}` : title;
  }
  if (name === 'load_skill') {
    const skillName = args.name;
    if (typeof skillName === 'string' && skillName) return skillName;
  }
  if (name === 'ask_user') {
    return formatAskUserCall(args);
  }
  return null;
}

// For tools whose result is a small JSON object, render a compact one-line
// summary in the transcript instead of a pretty-printed JSON dump. The raw
// JSON result still goes to the model unchanged — this is display-only.
// Returns null to fall back to the default tool-result view.
export function formatToolResult(name: string, result: string): string | null {
  if (name === 'load_skill') {
    return formatLoadSkillResult(result);
  }
  if (name === 'browser_capture_status') {
    try {
      const s = JSON.parse(result) as Record<string, unknown>;
      const n = (k: string): number | string => (typeof s[k] === 'number' ? (s[k] as number) : 0);
      const last = typeof s.lastActivityAt === 'string' ? s.lastActivityAt : 'never';
      return `requests: ${n('requests')} · endpoints: ${n('endpoints')} · snapshots: ${n('snapshots')} · last activity: ${last}`;
    } catch {
      return null; // malformed/partial JSON — use the default view
    }
  }
  if (name === 'ask_user') {
    return formatAskUserResult(result);
  }
  return null;
}

function formatLoadSkillResult(result: string): string | null {
  const skill = result.match(/^# Skill:\s*(.+)$/m)?.[1]?.trim();
  if (!skill) return null;

  const title = result
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('# ') && !line.startsWith('# Skill:'))
    ?.replace(/^#\s+/, '')
    .trim();

  const lines = [`loaded skill: ${skill}`];
  if (title) lines.push(`playbook: ${title}`);
  return lines.join('\n');
}

function formatAskUserCall(args: Record<string, unknown>): string | null {
  const questions = Array.isArray(args.questions) ? args.questions : [];
  if (questions.length === 0) return null;

  const first = questions[0] as Record<string, unknown>;
  const header = typeof first.header === 'string' && first.header ? first.header : '';
  const question = typeof first.question === 'string' && first.question ? first.question : '';
  const count = questions.length;
  const countText = `${count} question${count === 1 ? '' : 's'}`;

  if (header && question) return `${header} · ${countText} · ${question}`;
  if (header) return `${header} · ${countText}`;
  if (question) return `${countText} · ${question}`;
  return countText;
}

function formatAskUserResult(result: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(result);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.answers)) return null;

  const lines = ['answers:'];
  for (const raw of parsed.answers) {
    if (!isRecord(raw)) continue;
    const question = typeof raw.question === 'string' ? raw.question.trim() : '';
    const answer = typeof raw.answer === 'string' ? raw.answer.trim() : '';
    if (!answer && !question) continue;
    if (answer) lines.push(`- ${answer}`);
    if (question) lines.push(`  ${question}`);
  }
  return lines.length > 1 ? lines.join('\n') : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
