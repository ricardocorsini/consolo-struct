import type { CalculationResult } from "../../src/domain/engine";

/** Compare the complete legacy result with its original hash. Only the three
 * added checks and their new intermediate values are excluded; existing values,
 * checks, overall statuses, fingerprints and expectations are preserved. */
export function withoutAddedDuctility(
  result: CalculationResult,
): CalculationResult {
  const ids = new Set(["ductilityXd", "maxSteel", "plasticRotation"]);
  const fields = new Set([
    "ductility_x",
    "ductility_xd",
    "ductility_limit",
    "maxSteel",
    "plastic_fcdCCC",
    "plastic_a1",
    "plastic_aexc",
    "plastic_radicand",
    "plastic_x",
    "plastic_ratio",
  ]);
  return JSON.parse(
    JSON.stringify(result, (key, value) =>
      key === "checks"
        ? value.filter((c: { id: string }) => !ids.has(c.id))
        : key === "values"
          ? Object.fromEntries(
              Object.entries(value).filter(([field]) => !fields.has(field)),
            )
          : value,
    ),
  );
}
