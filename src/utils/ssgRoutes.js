// Route sharding for `cms-ssg-build` — the opt-in durable memory bound for the
// SSG pre-render. vite-ssg renders every route in one Node process and leaves a
// fixed retained cost per route, so peak heap scales with total routes;
// `cms-ssg-build` runs the render in N separate processes, each handling a slice
// of the routes, so peak heap is bounded by slice size instead. This module is
// the pure partition function so the slicing rules are unit-testable without a
// build. See SSG-MEMORY-PLAN.md.

// Routes every shard renders regardless of its slice. `/404` must be present in
// each shard's output dir so that shard's `onFinished` can copy 404/index.html
// → 404.html.
export const ALWAYS_SHARDED_ROUTES = ['/404'];

/**
 * Return shard `k` of `N` from the full SSG route list.
 *
 * `shardSpec` is a `"k/N"` string (e.g. `"2/5"`). Shard k = the always-present
 * routes + every Nth remaining route offset by k, so the N shards partition the
 * non-always routes exactly once each (no route rendered twice, none dropped).
 *
 * Returns the full list unchanged when `shardSpec` is absent or malformed —
 * this is the normal `vite-ssg build` path and must stay byte-identical.
 */
export function applyRouteShard(allRoutes, shardSpec) {
  if (!Array.isArray(allRoutes)) return allRoutes;
  const match = typeof shardSpec === 'string' ? shardSpec.trim().match(/^(\d+)\/(\d+)$/) : null;
  if (!match) return allRoutes;

  const k = Number(match[1]);
  const n = Number(match[2]);
  if (!(n > 0) || k < 0 || k >= n) return allRoutes;

  const always = new Set(ALWAYS_SHARDED_ROUTES);
  const alwaysRoutes = allRoutes.filter((route) => always.has(route));
  const shardRoutes = allRoutes
    .filter((route) => !always.has(route))
    .filter((_, i) => i % n === k);

  return Array.from(new Set([...alwaysRoutes, ...shardRoutes]));
}
