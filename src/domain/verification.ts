import type { Check, CheckStatus } from "./engine";

export function check(
  id: string,
  label: string,
  demand: number,
  capacity: number,
  unit: string,
  formula: string,
  reference: string,
  detail = "",
): Check {
  const finite = Number.isFinite(demand) && Number.isFinite(capacity);
  return {
    id,
    label,
    demand: finite ? demand : null,
    capacity: finite ? capacity : null,
    utilization:
      finite && capacity > 0
        ? demand / capacity
        : demand === 0 && capacity === 0
          ? 0
          : null,
    status:
      finite && demand <= capacity + Math.max(1e-8, Math.abs(capacity) * 1e-10)
        ? "pass"
        : "fail",
    unit,
    formula,
    reference,
    detail,
  };
}
export function note(
  id: string,
  label: string,
  detail: string,
  reference: string,
  status: CheckStatus = "review",
): Check {
  return {
    id,
    label,
    detail,
    reference,
    status,
    demand: null,
    capacity: null,
    utilization: null,
    unit: "",
    formula: "",
  };
}
