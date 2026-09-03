// Sensitive-path classification test cases.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isSensitivePath } from './sensitive.js';

const home = homedir();
const isWin = process.platform === 'win32';

describe('isSensitivePath', () => {
  const cases: Array<{ path: string; want: boolean; skipOnWin?: boolean }> = [
    { path: join(home, '.ssh', 'id_rsa'), want: true },
    { path: join(home, '.aws', 'credentials'), want: true },
    { path: join(home, '.kube', 'config'), want: true },
    { path: join(home, '.bash_history'), want: true },
    { path: '/etc/shadow', want: true, skipOnWin: true },
    { path: '/etc/sudoers', want: true, skipOnWin: true },

    { path: join(home, 'Documents', 'notes.txt'), want: false },
    { path: '/etc/passwd', want: false, skipOnWin: true },
    { path: join(home, '.ssh_other'), want: false },
    { path: join(home, '.aws-not'), want: false },
  ];

  for (const tc of cases) {
    const testFn = tc.skipOnWin && isWin ? it.skip : it;
    testFn(`${tc.path} → ${tc.want}`, () => {
      expect(isSensitivePath(tc.path)).toBe(tc.want);
    });
  }
});
