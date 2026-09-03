import { describe, expect, it } from 'vitest';
import { SLASH_ITEMS, filterSlash } from './slashItems.js';

describe('filterSlash', () => {
  it('returns all items when input is just "/"', () => {
    const r = filterSlash('/');
    expect(r.length).toBe(SLASH_ITEMS.length);
  });

  it('returns no items when input does not start with /', () => {
    expect(filterSlash('hello')).toEqual([]);
    expect(filterSlash('')).toEqual([]);
  });

  it('prefix-matches command names', () => {
    expect(filterSlash('/he').map((s) => s.name)).toEqual(['/help']);
    expect(filterSlash('/re').map((s) => s.name)).toEqual(['/reset']);
    expect(
      filterSlash('/t')
        .map((s) => s.name)
        .sort(),
    ).toEqual(['/target', '/thinking']);
    expect(
      filterSlash('/m')
        .map((s) => s.name)
        .sort(),
    ).toEqual(['/maxsteps', '/memory', '/model']);
    expect(filterSlash('/pl').map((s) => s.name)).toEqual(['/plan']);
  });

  it('includes /provider in the catalog', () => {
    expect(SLASH_ITEMS.map((s) => s.name)).toContain('/provider');
    expect(filterSlash('/prov').map((s) => s.name)).toEqual(['/provider']);
  });

  it('hides the menu once the user is typing args (space after command)', () => {
    expect(filterSlash('/target https://')).toEqual([]);
    expect(filterSlash('/maxsteps 20')).toEqual([]);
  });

  it('matches case-insensitively', () => {
    expect(filterSlash('/HELP').map((s) => s.name)).toEqual(['/help']);
  });
});
