/**
 * Ambient declarations for the two optional store drivers.
 *
 * `better-sqlite3` and `pg` ship no types of their own, and `@types/*` for both would be
 * devDependencies that exist only to describe a handful of methods this package already
 * describes precisely — `SqliteDatabase` in `store/sqlite.ts` and `PgClient` in
 * `store/postgres.ts` are the real contracts, and they are deliberately narrow so the store can
 * be handed a test double.
 *
 * Declaring the modules as `unknown` rather than `any` is the point: it makes the dynamic
 * `import()` resolve without inventing a type, and forces the cast at the call site to be
 * explicit and visible rather than silently inferred. A future reader can see exactly what
 * shape this package believes each driver has, in one place, next to the code that uses it.
 */

declare module "better-sqlite3" {
  const value: unknown;
  export default value;
}

declare module "pg" {
  const value: unknown;
  export default value;
}
