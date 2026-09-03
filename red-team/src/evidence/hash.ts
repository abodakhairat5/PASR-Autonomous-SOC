import { createHash } from 'node:crypto';

export function computeEvidenceHash(data: Record<string, unknown>): string {
  const canonical = canonicalize(data);
  return createHash('sha256').update(canonical).digest('hex');
}

function canonicalize(obj: unknown): string {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj === 'string') return JSON.stringify(obj);
  if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalize).join(',')}]`;
  }
  if (typeof obj === 'object') {
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    const pairs = keys.map(
      (k) => `${JSON.stringify(k)}:${canonicalize((obj as Record<string, unknown>)[k])}`,
    );
    return `{${pairs.join(',')}}`;
  }
  return String(obj);
}
