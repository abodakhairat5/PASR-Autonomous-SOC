import type { Skill } from '../skills/registry.js';
import type { Target } from '../target/target.js';

export interface DecisionPlan {
  recommendedSkill?: string;
  reason: string;
  risk: 'normal' | 'high';
  checklist: string[];
  guidance: string;
}

const SKILL_KEYWORDS: Record<string, string[]> = {
  recon: [
    'recon',
    'subdomain',
    'subdomains',
    'enumerate',
    'enumeration',
    'attack surface',
    'crt',
    'liveness',
    'fingerprint',
    'fingerprinting',
    'content discovery',
    'apex',
    'domain',
  ],
  webvuln: [
    'web',
    'vuln',
    'vulnerability',
    'hunt',
    'idor',
    'bola',
    'bac',
    'xss',
    'sqli',
    'injection',
    'auth',
    'authorization',
    'ssrf',
    'cve',
    'api',
    'endpoint',
  ],
  jwt: ['jwt', 'token', 'bearer', 'alg', 'kid', 'jku', 'jwks', 'hs256', 'rs256'],
  ssrf: ['ssrf', 'webhook', 'callback', 'url', 'metadata', '169.254.169.254', 'imds'],
  ssti: ['ssti', 'template', 'jinja', 'twig', 'freemarker', 'velocity', 'handlebars'],
  graphql: ['graphql', 'gql', 'introspection', 'query', 'mutation', 'alias', 'schema'],
  race: ['race', 'concurrent', 'parallel', 'coupon', 'redeem', 'balance', 'double spend'],
  takeover: ['takeover', 'dangling', 'cname', 'nxdomain', 'subdomain takeover'],
  supabase: ['supabase', 'rls', 'anon key', 'postgrest', 'storage bucket'],
  deserialize: [
    'deserialize',
    'deserialization',
    'pickle',
    'unserialize',
    'binaryformatter',
    'yaml',
  ],
};

const HIGH_RISK_TERMS = [
  'exploit',
  'rce',
  'sqlmap',
  'nuclei',
  'ffuf',
  'masscan',
  'bruteforce',
  'brute force',
  'delete',
  'dos',
  'ddos',
  'fuzz',
];

const WORKFLOW_TERMS = [
  'test',
  'scan',
  'recon',
  'enumerate',
  'hunt',
  'check',
  'verify',
  'exploit',
  'poc',
  'bug',
  'vuln',
  'vulnerability',
  'endpoint',
  'api',
  'auth',
  'authorization',
  'finding',
];

export function buildDecisionPlan(
  userMsg: string,
  skills: Skill[],
  target: Target,
): DecisionPlan | undefined {
  const text = userMsg.trim();
  if (!text) return undefined;

  const normalized = normalize(text);
  const recommended = recommendSkill(normalized, skills);
  const risk = includesAny(normalized, HIGH_RISK_TERMS) ? 'high' : 'normal';
  const targetKnown = !target.empty() || hasHostLikeText(text);
  if (
    !recommended &&
    risk === 'normal' &&
    !targetKnown &&
    !includesAny(normalized, WORKFLOW_TERMS)
  ) {
    return undefined;
  }
  const checklist = buildChecklist(recommended?.name, targetKnown, risk);
  const reason =
    recommended?.reason ??
    'no specialized skill matched strongly; use the general web testing workflow and ask only for missing scope or credentials';

  return {
    recommendedSkill: recommended?.name,
    reason,
    risk,
    checklist,
    guidance: renderGuidance(recommended?.name, reason, risk, checklist),
  };
}

function recommendSkill(
  normalized: string,
  skills: Skill[],
): { name: string; reason: string } | undefined {
  let best: { skill: Skill; score: number; hits: string[] } | undefined;
  for (const skill of skills) {
    const hits = scoreSkill(normalized, skill);
    const score = hits.length;
    if (score === 0) continue;
    if (!best || score > best.score) best = { skill, score, hits };
  }
  if (!best) return undefined;
  const topHits = best.hits.slice(0, 4).join(', ');
  return { name: best.skill.name, reason: `matched ${best.skill.name} signals: ${topHits}` };
}

function scoreSkill(normalized: string, skill: Skill): string[] {
  const hits = new Set<string>();
  const keywords = [...(SKILL_KEYWORDS[skill.name] ?? []), skill.name];
  for (const keyword of keywords) {
    if (normalized.includes(normalize(keyword))) hits.add(keyword);
  }
  const descTokens = normalize(skill.description)
    .split(/\s+/)
    .filter((t) => t.length >= 5);
  for (const token of descTokens) {
    if (normalized.includes(token)) hits.add(token);
  }
  return [...hits];
}

function buildChecklist(
  skillName: string | undefined,
  targetKnown: boolean,
  risk: string,
): string[] {
  const out: string[] = [];
  if (!targetKnown) {
    out.push('clarify the exact in-scope target before active testing');
  }
  if (skillName) {
    out.push(`load the ${skillName} skill before running other tools`);
  } else {
    out.push('choose the narrowest applicable workflow before acting');
  }
  out.push('use coverage to avoid repeating endpoint/parameter/vulnerability tests');
  out.push('verify with reproducible evidence before confirming a finding');
  if (risk === 'high') {
    out.push('ask before scanner-like, destructive, or high-volume actions');
  }
  return out;
}

function renderGuidance(
  skillName: string | undefined,
  reason: string,
  risk: string,
  checklist: string[],
): string {
  const skillLine = skillName
    ? `Recommended skill: ${skillName} (${reason}).`
    : `Recommended skill: none (${reason}).`;
  return [
    'Decision planner guidance for this turn:',
    `- ${skillLine}`,
    `- Risk level: ${risk}.`,
    '- If the recommended skill is present and not already active, call load_skill before other tools.',
    '- If scope, authorization, credentials, or testing depth is ambiguous, ask one concise question before active testing.',
    '- Use coverage(action="untested") when endpoint/parameter candidates are known, then coverage(action="mark") after meaningful tests.',
    '- Do not call confirm_finding for suspected behavior; require reproduced request/response evidence first.',
    '- Checklist:',
    ...checklist.map((item) => `  - ${item}`),
  ].join('\n');
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[_-]+/g, ' ');
}

function includesAny(s: string, needles: string[]): boolean {
  return needles.some((needle) => s.includes(needle));
}

function hasHostLikeText(s: string): boolean {
  return /https?:\/\/[^\s]+/i.test(s) || /\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/i.test(s);
}
