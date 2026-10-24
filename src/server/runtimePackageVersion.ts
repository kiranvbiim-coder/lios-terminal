/**
 * Evaluate only the version grammar used by LiOS's signed managed-runtime manifest.
 *
 * Exact numeric versions, N.x major bands and comma-delimited numeric comparisons
 * are supported. Unknown/PEP 440 variants intentionally fail closed; the release
 * bundle and managed-runtime post-install audit must agree on admissible versions.
 */
function compareNumericVersions(actual: string, expected: string): number {
  const a = actual.split(".").map(Number);
  const b = expected.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

export function satisfiesRuntimePackageVersion(actual: string, requirement: string): boolean {
  if (!/^\d+(?:\.\d+)*$/.test(actual)) return false;
  if (/^\d+(?:\.\d+)*$/.test(requirement)) return actual === requirement;
  const majorSeries = /^(\d+)\.x$/i.exec(requirement);
  if (majorSeries) return actual.split(".")[0] === majorSeries[1];
  return requirement.split(",").every((part) => {
    const match = /^(>=|<=|==|!=|>|<)(\d+(?:\.\d+)*)$/.exec(part);
    if (!match) return false;
    const comparison = compareNumericVersions(actual, match[2]);
    switch (match[1]) {
      case ">=": return comparison >= 0;
      case "<=": return comparison <= 0;
      case ">": return comparison > 0;
      case "<": return comparison < 0;
      case "==": return comparison === 0;
      case "!=": return comparison !== 0;
      default: return false;
    }
  });
}
