import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { IntelligenceStore, formatIntelligenceContext } from './store.js';

const temps: string[] = [];

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pf-intel-'));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('IntelligenceStore', () => {
  it('retrieves the Node/PM2 seed for source exposure context', () => {
    const root = tempRoot();
    const store = new IntelligenceStore({ cwd: join(root, 'project'), home: join(root, 'home') });

    const results = store.search('Node Express server.js package.json source leak', 3);

    expect(results[0]?.scenario.title).toBe(
      'Node source exposure should check PM2 deployment files',
    );
    expect(results[0]?.scenario.recommendedChecks).toContain('ecosystem.config.js');
    expect(results[0]?.score).toBeGreaterThan(10);
  });

  it('does not retrieve unrelated intelligence for unrelated context', () => {
    const root = tempRoot();
    const store = new IntelligenceStore({ cwd: join(root, 'project'), home: join(root, 'home') });

    expect(store.search('wordpress wp-admin plugin nonce csrf', 3)).toHaveLength(0);
  });

  it('appends JSONL scenarios and skips corrupt lines', async () => {
    const root = tempRoot();
    const project = join(root, 'project');
    const home = join(root, 'home');
    const store = new IntelligenceStore({ cwd: project, home });
    await store.append({
      title: 'GraphQL introspection follow-up',
      category: 'recon-gap',
      triggers: ['graphql', 'introspection'],
      technologies: ['GraphQL'],
      lesson: 'When GraphQL is detected, check introspection and common IDE endpoints.',
      recommendedChecks: ['/graphql', '/graphiql', '/playground'],
      avoidMissing: ['GraphQL IDE endpoints'],
      source: 'test',
      confidence: 0.8,
    });
    writeFileSync(store.projectPath, '{bad json}\n', { flag: 'a' });

    const results = store.search('graphql introspection', 3);

    expect(results[0]?.scenario.title).toBe('GraphQL introspection follow-up');
  });

  it('redacts secrets before saving learned scenario content', async () => {
    const root = tempRoot();
    const store = new IntelligenceStore({ cwd: join(root, 'project'), home: join(root, 'home') });

    await store.learnFromText(
      'Node Express server.js package.json leaked api_key=abcdefghijklmnop1234567890',
      'session-1',
    );

    const body = readFileSync(store.projectPath, 'utf8');
    expect(body).toContain('learned-node-pm2-source-exposure');
    expect(body).not.toContain('abcdefghijklmnop1234567890');
  });

  it('learns multiple reusable scenarios from one compaction summary', async () => {
    const root = tempRoot();
    const store = new IntelligenceStore({ cwd: join(root, 'project'), home: join(root, 'home') });
    const summary = [
      '## Findings and evidence',
      '- Confirmed IDOR on GET /api/invoices/200 with USER_A token',
      '## Tested surface',
      '- /admin POST was not tested and needs token validation follow-up',
      '## Open TODOs',
      '- Verify CORS misconfiguration with credentials on /api/profile',
      '## Next best actions',
      '- Retest rate-limit bypass using X-Forwarded-For rotation',
    ].join('\n');

    const learned = await store.learnFromText(summary, 'session-2');

    expect(learned.length).toBeGreaterThanOrEqual(4);
    expect(learned.some((s) => s.category === 'finding-pattern')).toBe(true);
    expect(learned.some((s) => s.category === 'coverage-gap')).toBe(true);
    expect(learned.filter((s) => s.category === 'next-step').length).toBeGreaterThanOrEqual(2);
    expect(store.search('idor invoices api', 3)[0]?.scenario.category).toBe('finding-pattern');
    expect(store.search('rate-limit X-Forwarded-For', 3)[0]?.scenario.title).toContain(
      'Retest rate-limit',
    );
  });

  it('persists learned lessons to both project and personal knowledge bases', async () => {
    const root = tempRoot();
    const store = new IntelligenceStore({ cwd: join(root, 'project'), home: join(root, 'home') });

    const learned = await store.learnFromText(
      '## Open TODOs\n- Verify GraphQL introspection and playground endpoints',
      'session-3',
    );

    expect(learned.some((s) => s.scope === 'project')).toBe(true);
    expect(learned.some((s) => s.scope === 'personal')).toBe(true);
    expect(readFileSync(store.projectPath, 'utf8')).toContain('GraphQL introspection');
    expect(readFileSync(store.personalPath, 'utf8')).toContain('GraphQL introspection');
    expect(store.search('graphql introspection playground', 10)).toHaveLength(1);

    const learnedAgain = await store.learnFromText(
      '## Open TODOs\n- Verify GraphQL introspection and playground endpoints',
      'session-3',
    );
    expect(learnedAgain).toHaveLength(0);
  });

  it('learns preferences, decisions, workflows, mistakes, and tool configs', async () => {
    const root = tempRoot();
    const store = new IntelligenceStore({ cwd: join(root, 'project'), home: join(root, 'home') });
    const summary = [
      '## User preferences',
      '- I prefer concise final answers with verification commands listed.',
      '## Important decisions',
      '- Use local RAG memory instead of external embeddings for v1.',
      '## What worked well',
      '- Running npm run typecheck and npm run lint before build caught issues quickly.',
      '## What failed and why',
      '- The first JSONL parser failed on corrupt lines and needed skip handling.',
      '## Frequently used tools',
      '- `rg` should be used before slower grep searches.',
    ].join('\n');

    const learned = await store.learnFromText(summary, 'session-4');
    const categories = new Set(learned.map((s) => s.category));

    expect(categories).toContain('user-preference');
    expect(categories).toContain('decision');
    expect(categories).toContain('proven-workflow');
    expect(categories).toContain('lesson-learned');
    expect(categories).toContain('tool-config');
    expect(store.search('concise final answers verification', 3)[0]?.scenario.category).toBe(
      'user-preference',
    );
  });

  it('boosts the fresher scenario at equal token overlap', async () => {
    const root = tempRoot();
    const store = new IntelligenceStore({ cwd: join(root, 'project'), home: join(root, 'home') });
    // Same triggers/category/confidence; titles deliberately don't match the
    // query, so token overlap is identical and only recency differs.
    await store.append({
      title: 'Alpha note',
      category: 'recon-gap',
      triggers: ['graphql', 'introspection'],
      technologies: ['GraphQL'],
      lesson: 'lesson one',
      recommendedChecks: ['/graphql'],
      avoidMissing: ['GraphQL IDE'],
      source: 'test',
      confidence: 0.8,
      updatedAt: '2025-01-01T00:00:00.000Z',
    });
    await store.append({
      title: 'Beta note',
      category: 'recon-gap',
      triggers: ['graphql', 'introspection'],
      technologies: ['GraphQL'],
      lesson: 'lesson two',
      recommendedChecks: ['/graphql'],
      avoidMissing: ['GraphQL IDE'],
      source: 'test',
      confidence: 0.8,
      updatedAt: '2026-06-10T00:00:00.000Z',
    });

    const results = store.search('graphql introspection', 5);
    const alpha = results.find((r) => r.scenario.title === 'Alpha note');
    const beta = results.find((r) => r.scenario.title === 'Beta note');
    expect(beta).toBeDefined();
    expect(alpha).toBeDefined();
    // Fresher Beta outranks stale Alpha and carries a strictly higher score.
    expect(results[0]?.scenario.title).toBe('Beta note');
    expect((beta?.score ?? 0) > (alpha?.score ?? 0)).toBe(true);
  });

  it('formats compact model guidance', () => {
    const root = tempRoot();
    const store = new IntelligenceStore({ cwd: join(root, 'project'), home: join(root, 'home') });
    const text = formatIntelligenceContext(store.search('server.js package.json node', 1));

    expect(text).toContain('Local PentesterFlow Intelligence');
    expect(text).toContain('ecosystem.config.js');
    expect(text.length).toBeLessThan(1600);
  });
});
