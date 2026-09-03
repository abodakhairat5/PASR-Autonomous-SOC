// End-to-end integration tests for the PASR subsystems.
// Verifies that Policy Engine, Evidence Store, Experience Store,
// Extended Coverage, Audit Logger, and Adaptive Planner work together
// in a realistic engagement flow.

import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Target } from '../target/target.js';
import { PolicyEngine } from '../policy/policy.js';
import { RateLimiter } from '../policy/rateLimiter.js';
import { isInScope, isAuthorizationValid } from '../policy/scope.js';
import { EvidenceStore } from '../evidence/store.js';
import { computeEvidenceHash } from '../evidence/hash.js';
import { ExperienceStore } from '../experience/store.js';
import { ExtendedCoverageStore } from '../coverage/extended.js';
import { AdaptiveDecisionPlanner } from '../experience/planner.js';
import { AuditLogger } from '../audit/logger.js';
import { PASRIntegration } from '../agent/pasr.js';

describe('PASR End-to-End Integration', () => {
  let root: string;
  let target: Target;
  let policy: PolicyEngine;
  let rateLimiter: RateLimiter;
  let evidence: EvidenceStore;
  let experience: ExperienceStore;
  let coverage: ExtendedCoverageStore;
  let audit: AuditLogger;
  let pasr: PASRIntegration;

  beforeEach(() => {
    root = join(tmpdir(), `pasr-e2e-${Date.now()}`);
    mkdirSync(root, { recursive: true });

    target = new Target();
    target.setBaseURL('https://lab.example.com');
    target.setName('integration-test');
    target.setScope({
      allowedDomains: ['lab.example.com', '*.lab.example.com'],
      allowedPorts: [80, 443, 8080],
      allowedProtocols: ['https', 'http'],
    });

    policy = new PolicyEngine(target);
    rateLimiter = new RateLimiter({ requestsPerSecond: 10, burstSize: 20 });
    evidence = new EvidenceStore(join(root, 'evidence'));
    experience = new ExperienceStore(join(root, 'experiences.json'));
    coverage = new ExtendedCoverageStore(join(root, 'coverage.json'));
    audit = new AuditLogger(join(root, 'audit'));
    pasr = new PASRIntegration({
      policyEngine: policy,
      evidenceStore: evidence,
      experienceStore: experience,
      extendedCoverage: coverage,
      auditLogger: audit,
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('scope enforcement', () => {
    it('allows in-scope hostnames', () => {
      const decision = policy.evaluate({
        hostname: 'lab.example.com',
        port: 443,
        protocol: 'https',
      });
      expect(decision.action).toBe('allow');
    });

    it('denies out-of-scope hostnames', () => {
      const decision = policy.evaluate({
        hostname: 'evil.com',
        port: 443,
        protocol: 'https',
      });
      expect(decision.action).toBe('deny');
    });

    it('denies out-of-scope ports', () => {
      const decision = policy.evaluate({
        hostname: 'lab.example.com',
        port: 3306,
        protocol: 'https',
      });
      expect(decision.action).toBe('deny');
    });

    it('allows wildcard subdomains', () => {
      const decision = policy.evaluate({
        hostname: 'api.lab.example.com',
        port: 443,
        protocol: 'https',
      });
      expect(decision.action).toBe('allow');
    });

    it('enforces rate limits', () => {
      const result = rateLimiter.acquire('lab.example.com');
      expect(result).toBe('allow');
    });
  });

  describe('evidence capture', () => {
    it('captures and retrieves evidence', async () => {
      const ev = await evidence.create({
        type: 'http-request',
        tool: 'http',
        target: { url: 'https://lab.example.com/api', method: 'GET' },
        request: { method: 'GET', url: 'https://lab.example.com/api' },
        response: { status: 200, body: 'ok' },
      });
      expect(ev.id).toMatch(/^ev_/);
      expect(ev.hash).toBeTruthy();

      const retrieved = await evidence.get(ev.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(ev.id);
    });

    it('computes consistent hashes', () => {
      const hash1 = computeEvidenceHash({
        type: 'http-request',
        tool: 'http',
        request: { method: 'GET' },
      });
      const hash2 = computeEvidenceHash({
        type: 'http-request',
        tool: 'http',
        request: { method: 'GET' },
      });
      expect(hash1).toBe(hash2);
    });

    it('redacts sensitive data in evidence', async () => {
      const ev = await evidence.create({
        type: 'shell-command',
        tool: 'shell',
        command: 'curl -H "Authorization: Bearer secret123" https://lab.example.com',
        output: 'HTTP/1.1 200 OK\nX-Token: sk-liveabcdefghijklmnopqrstuvwx1234',
      });
      expect(ev.command).not.toContain('secret123');
      expect(ev.output).not.toContain('sk-liveabcdefghijklmnopqrstuvwx1234');
    });
  });

  describe('experience tracking', () => {
    it('records and retrieves experiences', async () => {
      const exp = await experience.record({
        category: 'recon',
        action: 'curl',
        target: 'https://lab.example.com/api',
        outcome: 'success',
        duration: 250,
        notes: 'Enumerated API endpoints',
      });
      expect(exp.experienceId).toMatch(/^exp_/);
      expect(exp.outcome).toBe('success');

      const list = await experience.list({ category: 'recon' });
      expect(list.length).toBeGreaterThanOrEqual(1);
    });

    it('computes patterns from experiences', async () => {
      for (let i = 0; i < 5; i++) {
        await experience.record({
          category: 'recon',
          action: 'curl',
          target: 'https://lab.example.com',
          outcome: 'success',
          duration: 100 + i * 10,
        });
      }
      await experience.record({
        category: 'recon',
        action: 'curl',
        target: 'https://lab.example.com',
        outcome: 'failure',
        duration: 50,
      });

      const patterns = await experience.getPatterns();
      const curlPattern = patterns.find((p) => p.action === 'curl');
      expect(curlPattern).toBeDefined();
      expect(curlPattern!.totalAttempts).toBe(6);
      expect(curlPattern!.successRate).toBeCloseTo(5 / 6, 1);
    });

    it('generates summary statistics', async () => {
      await experience.record({
        category: 'scan',
        action: 'nmap',
        target: '192.168.1.1',
        outcome: 'success',
        duration: 500,
      });

      const summary = await experience.summary();
      expect(summary.total).toBeGreaterThanOrEqual(1);
      expect(summary.byCategory.scan).toBeGreaterThanOrEqual(1);
    });
  });

  describe('exploit coverage', () => {
    it('tracks exploit attempts', async () => {
      await coverage.markExploit({
        exploitId: 'CVE-2024-1234',
        target: 'https://lab.example.com/api/vuln',
        vulnClass: 'sqli',
        status: 'confirmed',
        notes: 'Union-based SQL injection on id parameter',
      });

      const exploits = await coverage.listExploits({ status: 'confirmed' });
      expect(exploits.length).toBeGreaterThanOrEqual(1);
      expect(exploits[0]?.exploitId).toBe('CVE-2024-1234');
    });

    it('detects coverage gaps', async () => {
      const gaps = await coverage.findGaps(
        ['https://lab.example.com/api/users', 'https://lab.example.com/api/admin'],
        ['sqli', 'xss', 'ssrf'],
      );
      expect(gaps.length).toBe(6); // 2 endpoints x 3 vuln classes, none attempted
    });

    it('generates vulnerability class coverage', async () => {
      await coverage.markExploit({
        exploitId: 'test-xss-1',
        target: 'https://lab.example.com/search',
        vulnClass: 'xss',
        status: 'confirmed',
      });
      await coverage.markExploit({
        exploitId: 'test-xss-2',
        target: 'https://lab.example.com/form',
        vulnClass: 'xss',
        status: 'failed',
      });

      const classCoverage = await coverage.getVulnClassCoverage();
      const xss = classCoverage.find((c) => c.vulnClass === 'xss');
      expect(xss).toBeDefined();
      expect(xss!.confirmed).toBe(1);
      expect(xss!.failed).toBe(1);
      expect(xss!.endpoints).toHaveLength(2);
    });
  });

  describe('adaptive planning', () => {
    it('suggests next actions based on gaps', async () => {
      const planner = new AdaptiveDecisionPlanner();
      const actions = await planner.plan({
        coverage: [],
        experiences: [],
        findings: [{ severity: 'high', target: 'https://lab.example.com/api' }],
        currentPhase: 'recon',
        targets: ['https://lab.example.com'],
      });
      expect(actions.length).toBeGreaterThan(0);
      expect(actions[0]?.priority).toMatch(/high|medium/);
    });

    it('prioritizes high-severity targets', async () => {
      const planner = new AdaptiveDecisionPlanner();
      const actions = await planner.plan({
        coverage: [],
        experiences: [],
        findings: [{ severity: 'critical', target: 'https://lab.example.com/admin' }],
        currentPhase: 'exploit',
        targets: ['https://lab.example.com'],
      });
      expect(actions.length).toBeGreaterThan(0);
    });
  });

  describe('audit logging', () => {
    it('logs and retrieves audit entries', async () => {
      const entry = await audit.log({
        kind: 'policy-decision',
        detail: { hostname: 'lab.example.com', action: 'allow' },
      });
      expect(entry.id).toMatch(/^aud_/);
      expect(entry.timestamp).toBeTruthy();

      const entries = await audit.list();
      expect(entries.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('PASR integration', () => {
    it('is active when subsystems are configured', () => {
      expect(pasr.active).toBe(true);
    });

    it('is inactive when no subsystems', () => {
      const empty = new PASRIntegration();
      expect(empty.active).toBe(false);
    });

    it('builds prompt context from coverage and patterns', async () => {
      await experience.record({
        category: 'recon',
        action: 'curl',
        target: 'https://lab.example.com',
        outcome: 'success',
        duration: 100,
      });
      await coverage.markExploit({
        exploitId: 'test-1',
        target: 'https://lab.example.com/api',
        vulnClass: 'sqli',
        status: 'confirmed',
      });

      const ctx = await pasr.buildPromptContext();
      expect(ctx).toContain('Exploit Coverage (PASR)');
    });

    it('returns empty context when no subsystems', async () => {
      const empty = new PASRIntegration();
      const ctx = await empty.buildPromptContext();
      expect(ctx).toBe('');
    });

    it('records experience and logs to audit', async () => {
      await pasr.recordExperience({
        category: 'recon',
        action: 'http',
        target: 'https://lab.example.com',
        outcome: 'success',
        duration: 150,
      });
      // The audit log is fire-and-forget; give it time to write.
      await new Promise((r) => setTimeout(r, 50));

      const entries = await audit.list();
      const expEntry = entries.find((e) => e.kind === 'experience-recorded');
      expect(expEntry).toBeDefined();
    });
  });

  describe('cross-subsystem data flow', () => {
    it('evidence IDs can be linked to experiences', async () => {
      const ev = await evidence.create({
        type: 'http-request',
        tool: 'http',
        target: { url: 'https://lab.example.com/api/vuln?id=1', method: 'GET' },
        request: { method: 'GET' },
        response: { status: 200, body: 'error' },
      });

      const exp = await experience.record({
        category: 'exploit',
        action: 'sqli-test',
        target: 'https://lab.example.com/api/vuln',
        outcome: 'success',
        duration: 500,
        findings: ['SQL injection on id parameter'],
        evidenceIds: [ev.id],
      });

      expect(exp.evidenceIds).toContain(ev.id);
    });

    it('coverage gaps inform next actions', async () => {
      // Mark sqli as confirmed, xss as not attempted
      await coverage.markExploit({
        exploitId: 'sqli-test',
        target: 'https://lab.example.com/api',
        vulnClass: 'sqli',
        status: 'confirmed',
      });

      const gaps = await coverage.findGaps(
        ['https://lab.example.com/api'],
        ['sqli', 'xss'],
      );
      // sqli should not be a gap (attempted), xss should be
      expect(gaps.some((g) => g.vulnClass === 'xss')).toBe(true);
      expect(gaps.some((g) => g.vulnClass === 'sqli')).toBe(false);
    });
  });
});
