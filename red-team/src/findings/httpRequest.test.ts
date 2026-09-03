import { describe, expect, it } from 'vitest';
import { findingRequestForBurp } from './httpRequest.js';
import type { Finding } from './store.js';

describe('findingRequestForBurp', () => {
  it('prefers the finding curl so Burp imports the full query and headers', () => {
    const request = findingRequestForBurp({
      title: 'IDOR',
      severity: 'high',
      url: 'https://wuzzuf.net/api/company/employers',
      method: 'GET',
      parameter: 'filter[status]',
      impact: 'Account enumeration.',
      curl: 'curl -ksS -X GET "https://wuzzuf.net/api/company/employers?include=employer.company&filter%5Bstatus%5D=1" -H "Authorization: Bearer <JWT_TOKEN>" -H "Accept: application/vnd.api+json" -H "X-Requested-With: XMLHttpRequest" -H "Referer: https://wuzzuf.net/dashboard"',
      createdAt: '2026-06-02T12:21:02.243Z',
      slug: 'idor',
    } satisfies Finding);

    expect(request).toContain(
      'GET /api/company/employers?include=employer.company&filter%5Bstatus%5D=1 HTTP/1.1',
    );
    expect(request).toContain('Host: wuzzuf.net');
    expect(request).toContain('Authorization: Bearer <JWT_TOKEN>');
    expect(request).toContain('Accept: application/vnd.api+json');
    expect(request).toContain('X-Requested-With: XMLHttpRequest');
    expect(request).toContain('Referer: https://wuzzuf.net/dashboard');
  });

  it('reconstructs POST requests with JSON body and generated length', () => {
    const request = findingRequestForBurp(
      findingWithCurl(
        'curl --json \'{"role":"admin"}\' "https://app.example.com/api/users/42" -H "Authorization: Bearer tok"',
      ),
    );

    expect(request).toContain('POST /api/users/42 HTTP/1.1');
    expect(request).toContain('Host: app.example.com');
    expect(request).toContain('Content-Type: application/json');
    expect(request).toContain('Authorization: Bearer tok');
    expect(request).toContain('Content-Length: 16');
    expect(request.endsWith('\r\n\r\n{"role":"admin"}')).toBe(true);
  });

  it('keeps arbitrary methods from curl option forms', () => {
    const request = findingRequestForBurp(
      findingWithCurl(
        'curl --request=PATCH --url=https://app.example.com/api/profile -H "Content-Type: application/json" --data-raw=\'{"name":"x"}\'',
      ),
    );

    expect(request).toContain('PATCH /api/profile HTTP/1.1');
    expect(request).toContain('Content-Type: application/json');
    expect(request.endsWith('\r\n\r\n{"name":"x"}')).toBe(true);
  });

  it('includes cookie and basic auth headers when curl uses shorthand flags', () => {
    const request = findingRequestForBurp(
      findingWithCurl(
        'curl -XDELETE https://app.example.com/api/session -b "sid=abc; theme=dark" -u alice:secret',
      ),
    );

    expect(request).toContain('DELETE /api/session HTTP/1.1');
    expect(request).toContain('Cookie: sid=abc; theme=dark');
    expect(request).toContain('Authorization: Basic YWxpY2U6c2VjcmV0');
  });

  it('emits the curl user-agent header for space, attached, and equals forms', () => {
    const space = findingRequestForBurp(
      findingWithCurl('curl -A "MyScanner/1.0" https://app.example.com/api/x'),
    );
    expect(space).toContain('User-Agent: MyScanner/1.0');
    expect(space).not.toContain('User-Agent: PentesterFlow');

    const long = findingRequestForBurp(
      findingWithCurl('curl --user-agent "Custom UA" https://app.example.com/api/x'),
    );
    expect(long).toContain('User-Agent: Custom UA');
    expect(long).not.toContain('User-Agent: PentesterFlow');

    const attached = findingRequestForBurp(
      findingWithCurl('curl -AAttachedUA https://app.example.com/api/x'),
    );
    expect(attached).toContain('User-Agent: AttachedUA');

    const eq = findingRequestForBurp(
      findingWithCurl('curl --user-agent=EqualsUA https://app.example.com/api/x'),
    );
    expect(eq).toContain('User-Agent: EqualsUA');
  });

  it('falls back to finding url and method when no curl request can be parsed', () => {
    const request = findingRequestForBurp({
      ...findingWithCurl('echo not-curl'),
      url: 'https://app.example.com/api/items?id=7',
      method: 'OPTIONS',
    });

    expect(request).toBe(
      'OPTIONS /api/items?id=7 HTTP/1.1\r\nHost: app.example.com\r\nUser-Agent: PentesterFlow\r\n\r\n',
    );
  });
});

function findingWithCurl(curl: string): Finding {
  return {
    title: 'Finding',
    severity: 'high',
    url: 'https://app.example.com/fallback',
    impact: 'Impact.',
    curl,
    createdAt: '2026-06-02T12:21:02.243Z',
    slug: 'finding',
  };
}
