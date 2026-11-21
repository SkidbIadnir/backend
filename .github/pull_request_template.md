## What and why

<!-- One or two sentences. "Closes #42" if relevant. -->

## Checklist

- [ ] `npm run lint:check`, `npm run build` and `npm test` pass (CI also runs the e2e suite)
- [ ] New `scripts/db` files, if any: <!-- e.g. 003-x.sql, or "none" -->
- [ ] Promotion PR (`dev` → `preprod`, `preprod` → `prod`): those scripts are applied to the target environment (Coolify → backend → Terminal → `node scripts/db/apply-sql.mjs <file> --yes`)
- [ ] `docs/tasteep-api.md` and the README endpoint table updated if endpoints changed
