import { describe, expect, it } from 'vitest';
import { assertInstallerURL } from './selfUpdate.js';

describe('assertInstallerURL (L10)', () => {
  it('accepts the canonical https githubusercontent installer URL', () => {
    expect(() =>
      assertInstallerURL('https://raw.githubusercontent.com/PentesterFlow/agent/main/install.sh'),
    ).not.toThrow();
    expect(() =>
      assertInstallerURL('https://raw.githubusercontent.com/PentesterFlow/agent/v0.2.0/install.sh'),
    ).not.toThrow();
  });

  it('rejects a non-https scheme', () => {
    expect(() =>
      assertInstallerURL('http://raw.githubusercontent.com/PentesterFlow/agent/main/install.sh'),
    ).toThrow(/non-https/);
    expect(() => assertInstallerURL('file:///etc/passwd')).toThrow(/non-https/);
  });

  it('rejects an unexpected host (tampered PENTESTERFLOW_REPO)', () => {
    expect(() => assertInstallerURL('https://evil.example.com/x/main/install.sh')).toThrow(
      /unexpected host/,
    );
  });

  it('rejects a malformed URL', () => {
    expect(() => assertInstallerURL('not a url')).toThrow(/invalid installer URL/);
  });
});
