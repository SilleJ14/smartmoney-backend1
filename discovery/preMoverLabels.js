const DISCOVERY_TO_PRE_MOVER = Object.freeze({
  ELITE_DISCOVERY: "ELITE_PRE_MOVER",
  ELITE_PRE_MOVER: "ELITE_PRE_MOVER",
  STRONG_DISCOVERY: "STRONG_PRE_MOVER",
  STRONG_PRE_MOVER: "STRONG_PRE_MOVER",
  DEVELOPING_DISCOVERY: "DEVELOPING_PRE_MOVER",
  DEVELOPING_PRE_MOVER: "DEVELOPING_PRE_MOVER",
  LOW_DISCOVERY: "DEVELOPING_PRE_MOVER",
  INSUFFICIENT_EXTENSION_EVIDENCE: "DEVELOPING_PRE_MOVER",
  LATE_MOVE_NOT_DISCOVERY: "DEVELOPING_PRE_MOVER",
});

export function toPreMoverLabel(tierOrLabel, score) {
  const mapped = DISCOVERY_TO_PRE_MOVER[String(tierOrLabel || "")];
  if (mapped) return mapped;
  const numeric = Number(score);
  if (Number.isFinite(numeric) && numeric >= 82) return "ELITE_PRE_MOVER";
  if (Number.isFinite(numeric) && numeric >= 74) return "STRONG_PRE_MOVER";
  return "DEVELOPING_PRE_MOVER";
}

export function isElitePreMoverLabel(label) {
  const value = String(label || "");
  return value === "ELITE_PRE_MOVER" || value === "ELITE_DISCOVERY";
}

export function isStrongPreMoverLabel(label) {
  const value = String(label || "");
  return value === "STRONG_PRE_MOVER" || value === "STRONG_DISCOVERY";
}
