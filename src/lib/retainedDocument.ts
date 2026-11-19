/** Freeze hidden documents, but retain React.memo's shallow comparison while
 * visible. Reactivation must receive every current value and callback. */
export function retainedDocumentEqual<T extends { active: boolean }>(
  previous: T,
  next: T,
): boolean {
  if (!previous.active && !next.active) return true;
  const keys = Object.keys(previous) as (keyof T)[];
  return (
    keys.length === Object.keys(next).length &&
    keys.every(
      (key) => Object.hasOwn(next, key) && Object.is(previous[key], next[key]),
    )
  );
}
