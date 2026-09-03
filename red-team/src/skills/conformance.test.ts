// Conformance: every shipped skill must satisfy the Agent-Skills
// schema (valid name matching its dir, a description within the length
// limit, and allowed-tools that are real registered tools). A malformed
// skill fails CI here instead of silently misbehaving at runtime.

import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KNOWN_TOOL_NAMES } from '../tools/aliases.js';
import { parseSkill, validateSkill } from './registry.js';

const here = dirname(fileURLToPath(import.meta.url));
const skillsDir = resolve(here, '..', '..', 'skills');

// Same discovery rule as Registry.loadDir: skip dot/underscore dirs.
const skillDirs = readdirSync(skillsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_'))
  .map((e) => e.name);

describe('shipped skills conform to the schema', () => {
  it('finds the skills directory', () => {
    expect(skillDirs.length).toBeGreaterThan(0);
  });

  for (const name of skillDirs) {
    it(`${name} is valid`, () => {
      const skill = parseSkill(resolve(skillsDir, name, 'SKILL.md'));
      const errors = validateSkill(skill, KNOWN_TOOL_NAMES);
      expect(errors, `${name}: ${errors.join('; ')}`).toEqual([]);
    });
  }
});
