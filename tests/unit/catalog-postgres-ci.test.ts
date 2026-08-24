/**
 * The guard that keeps the Postgres half of AC7.10 running in CI (§E.3(2)).
 *
 * Before this, `MOVO_CATALOG_TEST_POSTGRES_URL` being unset meant around thirty integration rows
 * skipped, and a skip is invisible to an exit code — the workflow was green while half of AC7.10
 * had not executed since it was written. `.github/workflows/ci.yml` now provides a `postgres`
 * service; this file is what makes deleting it a red build rather than a quiet return to skips.
 *
 * The last case is the load-bearing one: it judges the *real* environment, so the guard is not
 * merely a pure function that is tested and then never consulted.
 */

import { describe, expect, it } from "vitest";
import { POSTGRES_REQUIRED_IN_CI, postgresRequirementFailure } from "../support/catalog-stores.ts";

describe("Postgres is required in CI", () => {
  it("fails when CI is set and no Postgres is configured", () => {
    expect(postgresRequirementFailure({ CI: "true" })).toBe(POSTGRES_REQUIRED_IN_CI);
  });

  it("fails when the URL is present but empty", () => {
    expect(postgresRequirementFailure({ CI: "true", MOVO_CATALOG_TEST_POSTGRES_URL: "" })).toBe(
      POSTGRES_REQUIRED_IN_CI,
    );
  });

  it("passes when CI provides the service", () => {
    expect(
      postgresRequirementFailure({
        CI: "true",
        MOVO_CATALOG_TEST_POSTGRES_URL: "postgres://movo:movo@localhost:5432/movo_catalog_test",
      }),
    ).toBeUndefined();
  });

  it("permits the skip outside CI, where a local Postgres is a convenience", () => {
    expect(postgresRequirementFailure({})).toBeUndefined();
    expect(postgresRequirementFailure({ CI: "false" })).toBeUndefined();
  });

  it("holds for this environment", () => {
    expect(postgresRequirementFailure(process.env)).toBeUndefined();
  });
});
