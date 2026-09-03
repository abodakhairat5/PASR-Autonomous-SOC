// Canonical SKILL.md starter, shared by the `/skills new` scaffold command
// and the `skills/_template/` reference file. Agent-Skills frontmatter:
// name + description (when-to-use) + optional allowed-tools.

/** Render a ready-to-edit SKILL.md body for a new skill named `name`. */
export function renderSkillTemplate(name: string): string {
  return `---
name: ${name}
description: One line on what this playbook does, then a "Use when ..." clause so the agent knows when to load it (e.g. "Use when the target exposes X / you see Y"). Max 1024 chars. This text is the ONLY thing the model sees until it loads the skill, so make the trigger conditions explicit.
allowed-tools:
  - http
  - shell
  - file_write
---

# ${name} playbook

State the goal in one or two sentences — what the operator is trying to
achieve, and the scope rules (authorized targets only).

## 1. First step

Concrete, copy-pasteable commands. Default to curl + the \`http\` tool.

\`\`\`sh
curl -ksS "https://TARGET/..."
\`\`\`

## 2. Next step

...

## Reporting

What proves the bug, the concrete impact in one sentence, and remediation.
When you have a reproduced finding with a real request/response, call
\`confirm_finding\`.
`;
}
