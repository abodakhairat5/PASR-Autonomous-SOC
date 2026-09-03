// The scaffold template must always produce a valid, conformant skill.

import matter from 'gray-matter';
import { describe, expect, it } from 'vitest';
import { KNOWN_TOOL_NAMES } from '../tools/aliases.js';
import { renderSkillTemplate } from './template.js';

describe('renderSkillTemplate', () => {
  it('produces parseable frontmatter with the given name', () => {
    const { data, content } = matter(renderSkillTemplate('my-skill'));
    expect(data.name).toBe('my-skill');
    expect(typeof data.description).toBe('string');
    expect((data.description as string).length).toBeLessThanOrEqual(1024);
    expect(content.trim().length).toBeGreaterThan(0);
  });

  it('uses the allowed-tools key with only known tools', () => {
    const { data } = matter(renderSkillTemplate('x'));
    const tools = data['allowed-tools'] as string[];
    expect(Array.isArray(tools)).toBe(true);
    for (const t of tools) expect(KNOWN_TOOL_NAMES.has(t)).toBe(true);
    expect(data.tools).toBeUndefined(); // CC key, not legacy
  });
});
