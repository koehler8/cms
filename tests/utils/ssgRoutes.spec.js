import { describe, it, expect } from 'vitest';
import { applyRouteShard, ALWAYS_SHARDED_ROUTES } from '../../src/utils/ssgRoutes.js';

describe('applyRouteShard', () => {
  const routes = ['/', '/404', '/about', '/contact', '/blog', '/blog/a', '/blog/b'];
  const stripAlways = (arr) => arr.filter((r) => !new Set(ALWAYS_SHARDED_ROUTES).has(r));

  it('returns the full list unchanged when the shard spec is absent or malformed', () => {
    expect(applyRouteShard(routes, undefined)).toEqual(routes);
    expect(applyRouteShard(routes, '')).toEqual(routes);
    expect(applyRouteShard(routes, 'garbage')).toEqual(routes);
    expect(applyRouteShard(routes, '2/2')).toEqual(routes); // k must be < n
    expect(applyRouteShard(routes, '3/2')).toEqual(routes); // k >= n → invalid
    expect(applyRouteShard(routes, '0/0')).toEqual(routes); // n = 0 → invalid
  });

  it('keeps /404 in every shard (so each can emit 404.html)', () => {
    for (let k = 0; k < 3; k++) {
      const s = applyRouteShard(routes, `${k}/3`);
      expect(s).toContain('/404');
    }
  });

  it('partitions the non-always routes exactly once each across the N shards', () => {
    const N = 3;
    const shards = Array.from({ length: N }, (_, k) => applyRouteShard(routes, `${k}/${N}`));
    const covered = shards.flatMap(stripAlways);
    expect(covered.slice().sort()).toEqual(stripAlways(routes).slice().sort()); // none dropped
    expect(new Set(covered).size).toBe(covered.length);                          // none duplicated
  });

  it('assigns non-always routes strided by index', () => {
    // non-always order: ['/', '/about', '/contact', '/blog', '/blog/a', '/blog/b']
    expect(stripAlways(applyRouteShard(routes, '0/2'))).toEqual(['/', '/contact', '/blog/a']);
    expect(stripAlways(applyRouteShard(routes, '1/2'))).toEqual(['/about', '/blog', '/blog/b']);
  });

  it('tolerates a shard count larger than the route count', () => {
    // 6 non-always routes (indices 0..5). Shard 5/9 → index 5 only; shard 8/9 → none.
    expect(stripAlways(applyRouteShard(routes, '5/9'))).toEqual(['/blog/b']);
    const empty = applyRouteShard(routes, '8/9');
    expect(empty).toContain('/404');
    expect(stripAlways(empty)).toEqual([]); // empty strided slice is fine
  });

  it('passes non-array input through untouched', () => {
    expect(applyRouteShard(null, '0/2')).toBeNull();
    expect(applyRouteShard(undefined, '0/2')).toBeUndefined();
  });
});
