// Pins the scope guard,
// the OWASP / VRT / PortSwigger playbook markers, the thinking toggle,
// the active-engagement injection, and now the tooling-profile stanza
// so future trims of the prompt can't silently widen the assistant's
// behavior or invert the curl-first default.

import { describe, expect, it } from 'vitest';
import { Registry } from '../skills/registry.js';
import { Target } from '../target/target.js';
import { buildSystemPrompt } from './systemPrompt.js';

describe('buildSystemPrompt', () => {
  it('thinking toggle injects the right directive', () => {
    const on = buildSystemPrompt({ skills: new Registry(), thinkingEnabled: true, target: null });
    expect(on).toContain('Thinking is enabled');
    const off = buildSystemPrompt({ skills: new Registry(), thinkingEnabled: false, target: null });
    expect(off).toContain('Thinking is disabled');
  });

  it('injects active engagement section when target is set', () => {
    const t = new Target();
    t.setBaseURL('https://app.example.com');
    const p = buildSystemPrompt({ skills: new Registry(), thinkingEnabled: false, target: t });
    expect(p).toContain('Active engagement');
    expect(p).toContain('https://app.example.com');
  });

  it('omits engagement section when target is empty', () => {
    const p = buildSystemPrompt({
      skills: new Registry(),
      thinkingEnabled: false,
      target: new Target(),
    });
    expect(p).not.toContain('Active engagement');
  });

  it('enforces the four-domain scope guard', () => {
    const p = buildSystemPrompt({ skills: new Registry(), thinkingEnabled: false, target: null });
    for (const want of [
      'Scope of work',
      'Penetration testing',
      'Bug bounty',
      'Code review',
      'Coding',
      'REFUSE',
    ]) {
      expect(p, `missing scope marker ${want}`).toContain(want);
    }
  });

  it('does not refuse normal authorized tester workflows', () => {
    const p = buildSystemPrompt({ skills: new Registry(), thinkingEnabled: false, target: null });
    expect(p).toContain('Do not refuse normal tester workflows');
    expect(p).toContain('Authorized testing');
    expect(p).toContain('proceed within that scope');
  });

  it('carries the bug bounty + OWASP + VRT + PortSwigger playbook', () => {
    const p = buildSystemPrompt({ skills: new Registry(), thinkingEnabled: false, target: null });
    for (const want of [
      'Bug bounty + web app security playbook',
      'OWASP Top 10',
      'A01 Broken Access Control',
      'A03 Injection',
      'A10 SSRF',
      'Bugcrowd VRT',
      'P1 (critical)',
      'P5 (informational)',
      'HTTP request smuggling',
      'Single-packet race conditions',
      'Server-side prototype pollution',
      'PortSwigger research',
      'James Kettle',
      'Bug bounty discipline',
    ]) {
      expect(p, `missing playbook marker ${want}`).toContain(want);
    }
  });

  it('carries the API Security and LLM OWASP Top 10 frameworks', () => {
    const p = buildSystemPrompt({ skills: new Registry(), thinkingEnabled: false, target: null });
    for (const want of [
      'OWASP API Security Top 10 (2023)',
      'API1 Broken Object Level Authorization',
      'BFLA',
      'API9 Improper Inventory Management',
      'OWASP LLM Top 10 (2025)',
      'LLM01 Prompt Injection',
      'LLM06 Excessive Agency',
      'LLM07 System Prompt Leakage',
      'MCP-specific',
    ]) {
      expect(p, `missing OWASP framework marker ${want}`).toContain(want);
    }
  });

  it("defaults to curl-first ('minimal') with no scanner override stanza", () => {
    const p = buildSystemPrompt({ skills: new Registry(), thinkingEnabled: false, target: null });
    // The base curl-first ban must always be present.
    expect(p).toContain('Tool selection: curl-first');
    expect(p).toContain('Do NOT reach for ffuf');
    // No 'full' override stanza when profile is missing.
    expect(p).not.toContain('Tooling profile: scanners enabled');
  });

  it('warns against GNU-only grep -P in shell commands', () => {
    const p = buildSystemPrompt({ skills: new Registry(), thinkingEnabled: false, target: null });
    expect(p).toContain('macOS/BSD and Linux');
    expect(p).toContain('grep -P');
    expect(p).toContain('grep -E');
  });

  it("appends the scanner-override stanza when tooling profile is 'full'", () => {
    const p = buildSystemPrompt({
      skills: new Registry(),
      thinkingEnabled: false,
      target: null,
      toolingProfile: 'full',
    });
    // Base curl-first stays — it's the dominant guidance.
    expect(p).toContain('Tool selection: curl-first');
    // Override stanza lifts the ban with explicit guardrails.
    expect(p).toContain('Tooling profile: scanners enabled');
    expect(p).toContain('ffuf, nuclei, sqlmap');
  });

  it("does NOT append the scanner override when tooling profile is 'minimal'", () => {
    const p = buildSystemPrompt({
      skills: new Registry(),
      thinkingEnabled: false,
      target: null,
      toolingProfile: 'minimal',
    });
    expect(p).not.toContain('Tooling profile: scanners enabled');
  });

  it('supports a compact profile for small request-budget providers', () => {
    const full = buildSystemPrompt({
      skills: new Registry(),
      thinkingEnabled: false,
      target: null,
    });
    const compact = buildSystemPrompt({
      skills: new Registry(),
      thinkingEnabled: false,
      target: null,
      promptProfile: 'compact',
    });
    expect(compact).toContain('Human-in-the-Loop Agentic AI CLI assistant');
    expect(compact).toContain('OWASP API Top 10');
    expect(compact).toContain('Bugcrowd VRT-style severity');
    expect(compact).not.toContain('Creative hunter mindset');
    expect(compact.length).toBeLessThan(full.length / 3);
  });

  it('carries the creative hunter mindset section with all subheadings', () => {
    // These markers are load-bearing for the model's behavior on
    // engagements — chain thinking, quiet wins, tech-stack hot spots,
    // adversarial inversion. Future trims must keep them intact or the
    // model loses its creative-hunter scaffolding.
    const p = buildSystemPrompt({ skills: new Registry(), thinkingEnabled: false, target: null });
    for (const want of [
      'Creative hunter mindset',
      'Questions to ask of every endpoint',
      'Chain thinking',
      'boring bugs become submission gold when combined',
      'Quiet high-impact categories',
      'Subdomain takeover',
      'Dependency confusion',
      'Tech-stack quick reference',
      'Spring Boot',
      'Rails',
      'Next.js',
      'AWS',
      'Adversarial inversion',
      '2025-2026 attention areas',
      'HTTP/3 desync',
      'WebAuthn / passkey',
    ]) {
      expect(p, `creative-hunter marker ${want} missing`).toContain(want);
    }
  });
});
