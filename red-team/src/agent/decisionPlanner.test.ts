import { describe, expect, it } from 'vitest';
import type { Skill } from '../skills/registry.js';
import { Target } from '../target/target.js';
import { buildDecisionPlan } from './decisionPlanner.js';

const skill = (name: string, description: string): Skill => ({
  name,
  description,
  tools: [],
  disableModelInvocation: false,
  path: `/tmp/${name}/SKILL.md`,
  body: '',
});

describe('buildDecisionPlan', () => {
  it('stays quiet for low-signal greetings', () => {
    const plan = buildDecisionPlan(
      'hello',
      [
        skill('recon', 'External recon playbook for subdomain enumeration'),
        skill('webvuln', 'Web vulnerability hunting playbook'),
      ],
      new Target(),
    );
    expect(plan).toBeUndefined();
  });

  it('recommends recon for subdomain enumeration goals', () => {
    const plan = buildDecisionPlan(
      'enumerate subdomains and fingerprint live hosts for example.com',
      [
        skill('recon', 'External recon playbook for subdomain enumeration'),
        skill('webvuln', 'Web vulnerability hunting playbook'),
      ],
      new Target(),
    );
    expect(plan?.recommendedSkill).toBe('recon');
    expect(plan?.guidance).toContain('load the recon skill');
  });

  it('recommends webvuln for endpoint vulnerability hunting', () => {
    const plan = buildDecisionPlan(
      'hunt IDOR and auth bugs on the orders API',
      [
        skill('recon', 'External recon playbook for subdomain enumeration'),
        skill('webvuln', 'Web vulnerability hunting playbook for IDOR and auth flaws'),
      ],
      new Target(),
    );
    expect(plan?.recommendedSkill).toBe('webvuln');
  });

  it('marks scanner-like requests as high risk', () => {
    const plan = buildDecisionPlan(
      'run nuclei and ffuf against https://example.com',
      [skill('webvuln', 'Web vulnerability hunting playbook')],
      new Target(),
    );
    expect(plan?.risk).toBe('high');
    expect(plan?.checklist).toContain(
      'ask before scanner-like, destructive, or high-volume actions',
    );
  });

  it('asks to clarify target when no host or pinned target exists', () => {
    const plan = buildDecisionPlan(
      'test the orders API for IDOR',
      [skill('webvuln', 'Web vulnerability hunting playbook')],
      new Target(),
    );
    expect(plan?.checklist[0]).toContain('clarify the exact in-scope target');
  });

  it('does not require target clarification when a target is pinned', () => {
    const target = new Target();
    target.setBaseURL('https://example.com');
    const plan = buildDecisionPlan(
      'test the orders API for IDOR',
      [skill('webvuln', 'Web vulnerability hunting playbook')],
      target,
    );
    expect(plan?.checklist.join('\n')).not.toContain('clarify the exact in-scope target');
  });
});
