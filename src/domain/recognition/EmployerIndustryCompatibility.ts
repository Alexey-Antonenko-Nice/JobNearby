export function areEmployerIndustriesIncompatible(
  leftIndustry: string,
  rightIndustry: string,
): boolean {
  const leftClass = classifyIndustry(leftIndustry);
  const rightClass = classifyIndustry(rightIndustry);

  return leftClass !== null && rightClass !== null && leftClass !== rightClass;
}

function classifyIndustry(
  value: string,
): "FOOD" | "CONCRETE" | "RAILWAY" | null {
  const normalized = value.trim().replace(/\s+/gu, " ").toLocaleLowerCase();
  if (
    normalized.includes("food solutions") ||
    normalized.includes("food manufacturing")
  ) {
    return "FOOD";
  }
  if (normalized.includes("concrete manufacturing")) return "CONCRETE";
  if (
    normalized.includes("railway rolling-stock manufacturing") ||
    normalized.includes("railway rolling stock manufacturing")
  ) {
    return "RAILWAY";
  }
  return null;
}
