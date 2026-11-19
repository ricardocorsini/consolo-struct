import type { CalculationResult, Check } from "../../src/domain/engine";

// Keep the pre-#65 snapshots testing every existing numeric result and check.
export const isFamilyAnchorage = (key: string) =>
  /^anchor(?:N[1-6]|P1|PINO)/.test(key);

export const legacyAnchorageValues = (values: Record<string, number>) =>
  Object.fromEntries(
    Object.entries(values).filter(([key]) => !isFamilyAnchorage(key)),
  );

const legacyChecks = (checks: Check[]) =>
  checks.filter((check) => !isFamilyAnchorage(check.id));
const status = (checks: Check[]): "pass" | "fail" | "review" =>
  checks.some((check) => check.status === "fail")
    ? "fail"
    : checks.some((check) => check.status === "review")
      ? "review"
      : "pass";

export function legacyAnchorageContract(
  result: CalculationResult,
): CalculationResult {
  const checks = legacyChecks(result.checks);
  return {
    ...result,
    engineVersion: "0.5.0",
    fingerprint: JSON.stringify(JSON.parse(result.fingerprint).slice(0, 5)),
    status: result.combinations.length ? status(checks) : result.status,
    values: legacyAnchorageValues(result.values),
    checks,
    combinations: result.combinations.map((c) => {
      const caseChecks = legacyChecks(c.checks);
      return {
        ...c,
        status: status(caseChecks),
        values: legacyAnchorageValues(c.values),
        checks: caseChecks,
      };
    }),
  };
}
