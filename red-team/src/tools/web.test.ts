import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlwaysDeny } from '../permission/permission.js';
import type { Prompter } from '../permission/permission.js';
import { WebFetchTool, WebSearchTool, clearWebCache } from './web.js';

const prompter = {} as Prompter;

afterEach(() => {
  vi.unstubAllGlobals();
  // Clear cross-test cache state so each case exercises the cold network path.
  clearWebCache();
});

describe('WebFetchTool', () => {
  it('returns readable text for successful fetches', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response('<html><body><h1>Hello</h1><script>x()</script></body></html>'),
      ),
    );

    const out = await new WebFetchTool().run(
      { url: 'https://example.com' },
      new AbortController().signal,
      prompter,
    );

    expect(out).toContain('URL: https://example.com');
    expect(out).toContain('Status: 200');
    expect(out).toContain('Hello');
    expect(out).not.toContain('<h1>');
    expect(out).not.toContain('x()');
  });

  it('explains HackerOne platform DNS failures with a public program URL hint', async () => {
    const cause = Object.assign(new Error('getaddrinfo ENOTFOUND platform.hackerone.com'), {
      code: 'ENOTFOUND',
      hostname: 'platform.hackerone.com',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed', { cause });
      }),
    );

    const out = await new WebFetchTool().run(
      { url: 'https://platform.hackerone.com/hackerone/policy_scopes' },
      new AbortController().signal,
      prompter,
    );

    expect(out).toContain('ERROR: fetch failed');
    expect(out).toContain('Code: ENOTFOUND');
    expect(out).toContain('platform.hackerone.com is not a public HackerOne program host');
    expect(out).toContain('https://hackerone.com/hackerone');
  });

  it('rethrows when the caller aborts the request', async () => {
    const ctl = new AbortController();
    ctl.abort();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('aborted');
      }),
    );

    await expect(
      new WebFetchTool().run({ url: 'https://example.com' }, ctl.signal, prompter),
    ).rejects.toThrow('aborted');
  });

  it('prompts before fetching private or local URLs', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    await expect(
      new WebFetchTool().run(
        { url: 'http://127.0.0.1:3000/status' },
        new AbortController().signal,
        new AlwaysDeny(),
      ),
    ).rejects.toThrow(/private\/internal URL denied/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not automatically follow redirects', async () => {
    const fetch = vi.fn(
      async () => new Response('', { status: 302, headers: { location: 'http://127.0.0.1/' } }),
    );
    vi.stubGlobal('fetch', fetch);

    await new WebFetchTool().run(
      { url: 'https://example.com/redirect' },
      new AbortController().signal,
      prompter,
    );

    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/redirect',
      expect.objectContaining({ redirect: 'manual' }),
    );
  });

  it('prompts before fetching IPv4-mapped IPv6 private URLs', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    await expect(
      new WebFetchTool().run(
        { url: 'http://[::ffff:169.254.169.254]/latest/meta-data/' },
        new AbortController().signal,
        new AlwaysDeny(),
      ),
    ).rejects.toThrow(/private\/internal URL denied/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects non-HTTP URL schemes', async () => {
    await expect(
      new WebFetchTool().run({ url: 'file:///etc/passwd' }, new AbortController().signal, prompter),
    ).rejects.toThrow(/unsupported URL scheme/);
  });

  it('serves a second fetch of the same URL from cache without re-hitting the network', async () => {
    const fetch = vi.fn(async () => new Response('<p>cached body</p>'));
    vi.stubGlobal('fetch', fetch);

    const first = await new WebFetchTool().run(
      { url: 'https://example.com/advisory' },
      new AbortController().signal,
      prompter,
    );
    const second = await new WebFetchTool().run(
      { url: 'https://example.com/advisory' },
      new AbortController().signal,
      prompter,
    );

    expect(second).toBe(first);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not cache failed fetches', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    vi.stubGlobal('fetch', fetch);

    await new WebFetchTool().run(
      { url: 'https://example.com/down' },
      new AbortController().signal,
      prompter,
    );
    await new WebFetchTool().run(
      { url: 'https://example.com/down' },
      new AbortController().signal,
      prompter,
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('WebSearchTool', () => {
  it('parses structured DuckDuckGo results', async () => {
    const html = `
      <a class="result__a" href="https://cve.example/CVE-1">Title One</a>
      <a class="result__snippet">Snippet one</a>`;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(html)),
    );

    const out = await new WebSearchTool().run(
      { query: 'CVE-1' },
      new AbortController().signal,
      prompter,
    );
    expect(out).toContain('Title One');
    expect(out).toContain('https://cve.example/CVE-1');
    expect(out).toContain('Snippet one');
  });

  it('falls back to raw anchor extraction when the structured markup changes', async () => {
    // No result__a / result__snippet classes, but real links are present.
    const html = `
      <div><a href="/internal">nav</a></div>
      <a href="https://example.org/post">Interesting Post</a>
      <a href="https://example.org/other">Another Result</a>`;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(html)),
    );

    const out = await new WebSearchTool().run(
      { query: 'anything' },
      new AbortController().signal,
      prompter,
    );
    expect(out).toContain('degraded results');
    expect(out).toContain('https://example.org/post');
    expect(out).toContain('Interesting Post');
    // Relative nav anchors are dropped.
    expect(out).not.toContain('/internal');
  });

  it('returns a structured failure instead of throwing when the search fetch fails', async () => {
    const cause = Object.assign(new Error('getaddrinfo ENOTFOUND html.duckduckgo.com'), {
      code: 'ENOTFOUND',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed', { cause });
      }),
    );

    const out = await new WebSearchTool().run(
      { query: 'whatever' },
      new AbortController().signal,
      prompter,
    );
    expect(out).toContain('ERROR: fetch failed');
    expect(out).toContain('Code: ENOTFOUND');
  });
});
