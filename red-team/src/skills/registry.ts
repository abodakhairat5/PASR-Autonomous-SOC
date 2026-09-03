// Skill registry. Each skill is a markdown file `<name>/SKILL.md` with
// YAML frontmatter, following the Agent Skills format:
//
//   name          required, lowercase-kebab, ≤64 chars (defaults to dir name)
//   description   required, ≤1024 chars — tells the model WHEN to use it
//   allowed-tools optional list restricting which tools the skill may call
//                 (legacy `tools:` is still accepted as an alias)
//
// Invocation is description-driven: the model reads each skill's name +
// description in the system prompt and calls load_skill when the task
// matches — there is no separate `triggers` list. The body holds the
// playbook, loaded on demand. `disable-model-invocation: true` keeps a
// skill user-only (slash-command invoked).

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import matter from 'gray-matter';

export interface Skill {
  name: string;
  description: string;
  /** Tools the skill is allowed to call, from the `allowed-tools`
   *  frontmatter key (alias: legacy `tools`). Empty = no restriction. */
  tools: string[];
  /** When true, the model is not allowed to auto-invoke this skill via
   *  load_skill — it must come from an explicit user gesture (a
   *  /<skill-name> slash command or /skills enable + a follow-up
   *  prompt). Hides the skill from the system prompt entirely. */
  disableModelInvocation: boolean;
  path: string;
  body: string;
}

export class Registry {
  private skills = new Map<string, Skill>();
  // Names the user has explicitly disabled. Disabled skills are still
  // loaded into the map (so /skills can list them) but are hidden from
  // the system prompt and refused by load_skill — the model only sees
  // and uses what's enabled.
  private disabled = new Set<string>();

  add(s: Skill): void {
    this.skills.set(s.name, s);
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  has(name: string): boolean {
    return this.skills.has(name);
  }

  /** All loaded skills (enabled and disabled), name-sorted. */
  list(): Skill[] {
    return Array.from(this.skills.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Skills the agent sees — used by the system prompt and load_skill. */
  listEnabled(): Skill[] {
    return this.list().filter((s) => !this.disabled.has(s.name));
  }

  /** Replace the disabled set wholesale. Used at startup from config. */
  setDisabledNames(names: Iterable<string>): void {
    this.disabled = new Set(names);
  }

  /** Snapshot of currently-disabled names (for persistence). */
  disabledNames(): string[] {
    return [...this.disabled].sort();
  }

  isDisabled(name: string): boolean {
    return this.disabled.has(name);
  }

  /**
   * Drop all loaded skills (does NOT touch the disabled set — that's
   * user state and should survive a live reload). Used by the live-
   * reload path so loadDir() afterwards starts from a clean slate.
   */
  clear(): void {
    this.skills.clear();
  }

  /** Toggle a single skill. Returns true if state actually changed. */
  setDisabled(name: string, on: boolean): boolean {
    const was = this.disabled.has(name);
    if (on && !was) {
      this.disabled.add(name);
      return true;
    }
    if (!on && was) {
      this.disabled.delete(name);
      return true;
    }
    return false;
  }

  /**
   * Walk `dir` for `<name>/SKILL.md` files and add each. Missing dirs
   * are silently ignored — skill directories are optional. Parse errors
   * on a single file are logged to stderr but don't abort the walk.
   */
  loadDir(dir: string): void {
    if (!existsSync(dir)) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      // Skip dotfiles and `_`-prefixed dirs so authoring scaffolding like
      // `_template/` isn't loaded as a real skill.
      if (name.startsWith('.') || name.startsWith('_')) continue;
      const sub = join(dir, name);
      let info: ReturnType<typeof statSync>;
      try {
        info = statSync(sub);
      } catch {
        continue;
      }
      if (!info.isDirectory()) continue;
      const file = join(sub, 'SKILL.md');
      if (!existsSync(file)) continue;
      try {
        this.add(parseSkill(file));
      } catch (err) {
        process.stderr.write(`[skills] skip ${file}: ${(err as Error).message}\n`);
      }
    }
  }
}

export function parseSkill(path: string): Skill {
  const raw = readFileSync(path, 'utf8');
  const parsed = matter(raw);
  const data = (parsed.data ?? {}) as Record<string, unknown>;
  // Accept both kebab-case (the frontmatter convention) and camelCase
  // forms of the flag — YAML allows hyphens, JS literals don't, and we
  // don't want authors stumbling on which spelling works.
  const disableModelInvocation =
    data['disable-model-invocation'] === true || data.disableModelInvocation === true;
  // `allowed-tools` is the canonical key; `tools` is accepted as a
  // back-compat alias.
  const toolsRaw = data['allowed-tools'] ?? data.allowedTools ?? data.tools;
  return {
    name:
      typeof data.name === 'string' && data.name ? (data.name as string) : basename(dirname(path)),
    description: typeof data.description === 'string' ? (data.description as string) : '',
    tools: Array.isArray(toolsRaw)
      ? (toolsRaw as unknown[]).filter((t): t is string => typeof t === 'string')
      : [],
    disableModelInvocation,
    path,
    body: parsed.content.replace(/^\n+/, ''),
  };
}

/** Max description length, matching the Agent Skills limit. */
const MAX_DESCRIPTION = 1024;
const NAME_RE = /^[a-z0-9-]+$/;

/**
 * Validate a parsed skill against the Agent-Skills schema. Returns a
 * list of human-readable problems (empty = valid). `knownTools` is the set
 * of tool names (and aliases) the agent actually registers — an
 * allowed-tools entry outside it is almost always a typo. Used by the
 * conformance test; runtime loading stays lenient.
 */
export function validateSkill(s: Skill, knownTools: ReadonlySet<string>): string[] {
  const errs: string[] = [];
  const dir = basename(dirname(s.path));
  if (!s.name) errs.push('missing `name`');
  else if (!NAME_RE.test(s.name)) errs.push(`name "${s.name}" must be lowercase-kebab ([a-z0-9-])`);
  else if (s.name !== dir) errs.push(`name "${s.name}" does not match its directory "${dir}"`);
  if (!s.description) errs.push('missing `description`');
  else if (s.description.length > MAX_DESCRIPTION)
    errs.push(`description is ${s.description.length} chars (max ${MAX_DESCRIPTION})`);
  for (const t of s.tools) {
    if (!knownTools.has(t)) errs.push(`allowed-tools entry "${t}" is not a known tool`);
  }
  return errs;
}

export function newRegistry(): Registry {
  return new Registry();
}

/**
 * Render a skill body for delivery to the model, with `${SKILL_DIR}`
 * occurrences replaced by the absolute path of the skill's directory.
 * Skill authors use the placeholder so shell snippets in the body
 * resolve correctly regardless of the agent's working directory:
 *
 *   ```sh
 *   ./${SKILL_DIR}/scripts/check.sh https://target.example.com
 *   ```
 *
 * Returned format includes the `# Skill: <name>` heading so the model
 * can tell where the playbook starts in tool-result content.
 */
export function materializeSkillBody(s: Skill): string {
  const dir = dirname(s.path);
  const body = s.body.replace(/\$\{SKILL_DIR\}/g, dir);
  return `# Skill: ${s.name}\n\n${body}`;
}
