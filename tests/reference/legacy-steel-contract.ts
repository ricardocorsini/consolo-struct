import type { CalculationResult } from "../../src/domain/engine";
import { legacyAnchorageContract } from "./legacy-anchorage-contract";

/** Preserve historical CA-50/CA-50 regressions across a storage/engine-id change.
 * No numeric result, demand, capacity, status or check is removed or replaced. */
export function legacySteelContract(
  result: CalculationResult,
): CalculationResult {
  const [geometry, loads, materials, rebar, design] = JSON.parse(
    result.fingerprint,
  );
  const { fykTransverse, ...oldMaterials } = materials;
  if (
    materials.fyk !== 500 ||
    fykTransverse !== 500 ||
    (design.gammaS ?? 1.15) !== 1.15
  )
    throw new Error(
      "Historical parity only applies to CA-50/CA-50, gammaS 1.15.",
    );
  const oldDesign = Object.fromEntries(
    Object.entries(design).flatMap(([key, value]) =>
      key === "inputsConfirmed"
        ? [
            ["fykTransverse", fykTransverse],
            [key, value],
          ]
        : [[key, value]],
    ),
  );
  const old = {
    ...legacyAnchorageContract(result),
    engineVersion: "0.4.0",
    fingerprint: JSON.stringify([
      geometry,
      loads,
      oldMaterials,
      rebar,
      oldDesign,
    ]),
  };
  return JSON.parse(
    JSON.stringify(old, (key, value) =>
      key === "formula" && typeof value === "string"
        ? value.replace("0,9d fywd", "0,9d fy")
        : value,
    ),
  );
}
