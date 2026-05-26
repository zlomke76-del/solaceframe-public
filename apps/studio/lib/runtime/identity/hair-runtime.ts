
import { HairState } from "./types";

export function validateHairContinuity(
  previous: HairState | null,
  next: HairState
) {
  if (!previous) {
    return {
      allowed: true,
      continuityScore: 100,
      reasons: [],
    };
  }

  const reasons: string[] = [];
  let score = 100;

  if (
    previous.moistureState === "dry" &&
    next.moistureState === "wet"
  ) {
    score -= 5;
    reasons.push("wetness transition detected");
  }

  if (
    previous.style === "ponytail" &&
    next.style === "down"
  ) {
    score -= 3;
    reasons.push("hair release transition");
  }

  return {
    allowed: score >= 90,
    continuityScore: score,
    reasons,
  };
}
