# Canonical schema documents

`imbc-platform.dbml` owns the field catalogue, relationships, import mappings, and export contract. `imbc-platform.sql` is a generated PostgreSQL 15+ schema snapshot, not a migration or deployment script. Functional rules remain in the technical specification.

Use the isolated development dependencies in this directory:

```sh
npm ci --prefix docs/data-model --ignore-scripts
npm run generate --prefix docs/data-model
npm run check --prefix docs/data-model
```

The generator preserves the nine partial unique indexes, both `NULLS NOT DISTINCT` indexes, check constraints, and deferrable foreign keys that a plain DBML export does not fully express. Generation is deterministic. Do not edit the SQL snapshot separately.

The checker compares the generated SQL, loads it into an in-memory PostgreSQL engine (PGlite), and exercises consent provenance and retry uniqueness, tenant-safe requirements mappings, file ownership, and independent certificate reminder generations. It also verifies the existing partial-index and nullable-key behavior. It does not deploy a database or replace application workflow tests.

Role checks, dictionary kinds, immutable/audited writes, scheduler locking and dispatch, and publication rules described in DBML notes remain application responsibilities. SQL constraints enforce the structural relationships; the notes are not database triggers.
