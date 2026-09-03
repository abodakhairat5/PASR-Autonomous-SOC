# Skills

Skills are pre-authored playbooks the agent loads on demand. The format
follows the **Agent Skills** convention: a directory containing a `SKILL.md`
file with YAML frontmatter and a Markdown body.

```
skills/
  jwt/
    SKILL.md
    payloads/
      alg-none-variants.txt
```

## SKILL.md frontmatter

| Field | Required | Notes |
| --- | --- | --- |
| `name` | yes | Lowercase-kebab (`[a-z0-9-]`), ≤64 chars. Should match the directory name. |
| `description` | yes | ≤1024 chars. **This is the only thing the model sees until it loads the skill** — include explicit "Use when …" trigger conditions so it knows when to invoke it. There is no separate `triggers` list (description-driven). |
| `allowed-tools` | no | List restricting which tools the skill may call (e.g. `http`, `shell`, `file_write`). Omit for no restriction. Legacy alias: `tools`. |
| `disable-model-invocation` | no | `true` = user-only: hidden from the model, invoked only via the `/<name>` slash command. |

Everything after the frontmatter is the playbook body, delivered to the
model verbatim when it calls `load_skill`. `${SKILL_DIR}` in the body is
replaced with the skill's absolute directory path.

## Where skills load from

Discovered automatically, in increasing precedence (later overrides earlier
on a name collision):

1. this built-in `skills/` directory
2. `./.pentesterflow/skills/` (project-local — scoped to the repo)
3. `~/.pentesterflow/builtin-skills/` (installer-managed shipped skills)
4. `~/.pentesterflow/skills/` (personal)
5. any dirs passed via `--skills <dir>` or the `skills_dirs` config

Use `~/.pentesterflow/skills/` for personal skills you want available
everywhere, or the project-local `./.pentesterflow/skills/` for skills
scoped to a single repo.

Just drop a `<name>/SKILL.md` into one of these — no config needed. Skills
**hot-reload** on save. Directories starting with `.` or `_` are ignored
(so `_template/` is not loaded as a skill).

## Creating a skill

- **Scaffold:** run `/skills new <name>` in the TUI — it writes a templated
  `./.pentesterflow/skills/<name>/SKILL.md` and loads it immediately.
- **By hand:** copy [`_template/SKILL.md`](_template/SKILL.md) into
  `<name>/SKILL.md` and edit.

## Managing skills

- `/skills` — interactive enable/disable picker.
- `/skills enable|disable <name>` — toggle from the prompt.
- `/<name>` — invoke a skill explicitly for your next turn.

All shipped skills are validated by `src/skills/conformance.test.ts`
(name/description/allowed-tools), so a malformed skill fails CI.
