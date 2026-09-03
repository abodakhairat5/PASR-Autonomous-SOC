import { describe, expect, it } from 'vitest';
import { Target } from '../target/target.js';
import { PolicyEngine } from '../policy/policy.js';
import { EvidenceStore } from '../evidence/store.js';
import { ExperienceStore } from '../experience/store.js';
import { ExtendedCoverageStore } from '../coverage/extended.js';
import { PASRIntegration } from './pasr.js';

function makeTargetWithScope(): Target {
  const t = new Target();
  t.setBaseURL('https://lab.example.com');
  t.setScope({
    inScopeHostnames: ['lab.example.com'],
  });
  return t;
}

describe('PASRIntegration', () => {
  describe('constructor', () => {
    it('creates with no subsystems', () => {
      const pasr = new PASRIntegration();
      expect(pasr.active).toBe(false);
      expect(pasr.policyEngine).toBeUndefined();
      expect(pasr.evidenceStore).toBeUndefined();
      expect(pasr.experienceStore).toBeUndefined();
      expect(pasr.extendedCoverage).toBeUndefined();
    });

    it('creates with all subsystems', () => {
      const target = makeTargetWithScope();
      const pasr = new PASRIntegration({
        policyEngine: new PolicyEngine(target),
        evidenceStore: new EvidenceStore('/tmp/ev'),
        experienceStore: new ExperienceStore('/tmp/exp.json'),
        extendedCoverage: new ExtendedCoverageStore('/tmp/cov.json'),
      });
      expect(pasr.active).toBe(true);
      expect(pasr.policyEngine).toBeDefined();
      expect(pasr.evidenceStore).toBeDefined();
      expect(pasr.experienceStore).toBeDefined();
      expect(pasr.extendedCoverage).toBeDefined();
    });
  });

  describe('recordExperience', () => {
    it('does nothing when no experience store', async () => {
      const pasr = new PASRIntegration();
      // Should not throw
      await pasr.recordExperience({
        category: 'recon',
        action: 'curl',
        target: 'https://lab.example.com',
        outcome: 'success',
        duration: 100,
      });
    });
  });

  describe('buildPromptContext', () => {
    it('returns empty when no subsystems', async () => {
      const pasr = new PASRIntegration();
      const ctx = await pasr.buildPromptContext();
      expect(ctx).toBe('');
    });
  });

  describe('getNextActions', () => {
    it('returns empty when no experience store', async () => {
      const pasr = new PASRIntegration();
      const actions = await pasr.getNextActions({
        coverage: [],
        findings: [],
        currentPhase: 'recon',
        targets: ['https://lab.example.com'],
      });
      expect(actions).toEqual([]);
    });
  });
});
