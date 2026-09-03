// Skill loader test — verifies that the YAML frontmatter parses into
// name/description/triggers and the body is preserved, matching what the
// Go internal/skills parser produces. Uses the shipped skills/ dir.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Registry, parseSkill } from './registry.js';

// Locate the project-root skills/ dir from this test file.
const here = dirname(fileURLToPath(import.meta.url));
const skillsDir = resolve(here, '..', '..', 'skills');

describe('skills.Registry', () => {
  it('loads recon / webvuln / ssrf', () => {
    const r = new Registry();
    r.loadDir(skillsDir);
    const names = r.list().map((s) => s.name);
    expect(names).toContain('recon');
    expect(names).toContain('webvuln');
    expect(names).toContain('ssrf');
  });

  it('keeps body separate from frontmatter', () => {
    const s = parseSkill(resolve(skillsDir, 'recon', 'SKILL.md'));
    expect(s.name).toBe('recon');
    expect(s.body.length).toBeGreaterThan(100);
    expect(s.body).not.toContain('---\nname:');
  });

  it('list() returns skills sorted by name', () => {
    const r = new Registry();
    r.loadDir(skillsDir);
    const names = r.list().map((s) => s.name);
    expect(names).toEqual([...names].sort());
  });

  it('loadDir on a missing directory is a no-op', () => {
    const r = new Registry();
    r.loadDir('/nonexistent/path/that/does/not/exist');
    expect(r.list()).toEqual([]);
  });

  it('setDisabled / listEnabled filter and toggle correctly', () => {
    const r = new Registry();
    r.loadDir(skillsDir);
    const allBefore = r.list().map((s) => s.name);
    expect(allBefore).toContain('recon');

    // Disabling something not in the registry is fine, returns false.
    expect(r.setDisabled('no-such-skill', true)).toBe(true); // adds to set
    expect(r.setDisabled('recon', true)).toBe(true); // first transition

    // listEnabled hides disabled; list() still returns everything.
    const enabledNames = r.listEnabled().map((s) => s.name);
    expect(enabledNames).not.toContain('recon');
    expect(r.list().map((s) => s.name)).toContain('recon');
    expect(r.isDisabled('recon')).toBe(true);

    // Re-disabling the same skill returns false (no state change).
    expect(r.setDisabled('recon', true)).toBe(false);

    // Re-enable.
    expect(r.setDisabled('recon', false)).toBe(true);
    expect(r.isDisabled('recon')).toBe(false);
    expect(r.listEnabled().map((s) => s.name)).toContain('recon');
  });

  it('setDisabledNames replaces the disabled set wholesale', () => {
    const r = new Registry();
    r.loadDir(skillsDir);
    r.setDisabled('recon', true);
    r.setDisabledNames(['ssrf', 'webvuln']);
    expect(r.isDisabled('recon')).toBe(false);
    expect(r.isDisabled('ssrf')).toBe(true);
    expect(r.isDisabled('webvuln')).toBe(true);
    expect(r.disabledNames()).toEqual(['ssrf', 'webvuln']);
  });
});
