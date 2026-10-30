// Upgrade bundled entries once, while preserving explicit edits and later removals.
const migrations = [{ id: "jerry-v1", resolver: "jerry" }];
export function mergeBundledResolvers(config, defaults) {
  const next = structuredClone(config);
  const applied = new Set(
    Array.isArray(next.bundledResolverMigrations)
      ? next.bundledResolverMigrations.filter((id) => typeof id === "string")
      : [],
  );
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    const bundled = defaults.resolvers.find((r) => r.id === migration.resolver);
    if (!bundled) continue;
    if (!next.resolvers.some((r) => r.id === migration.resolver))
      next.resolvers.push(structuredClone(bundled));
    applied.add(migration.id);
  }
  next.bundledResolverMigrations = [...applied];
  return next;
}
