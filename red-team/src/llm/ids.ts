// Tool-call ID generation. Some backends omit IDs in streaming responses
// when the model decides to call a tool; we synthesize one so downstream
// message matching stays sane.

import { randomBytes } from 'node:crypto';

let seq = 0;

export function newCallID(): string {
  try {
    return `call_${randomBytes(8).toString('hex')}`;
  } catch {
    seq += 1;
    return `call_${seq}`;
  }
}
