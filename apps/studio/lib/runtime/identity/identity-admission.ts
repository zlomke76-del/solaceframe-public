
import { IdentityScores } from "./types";

export function computeAdmission(scores: IdentityScores) {
  const values = Object.values(scores);

  const average =
    values.reduce((a, b) => a + b, 0) / values.length;

  if (average >= 95) {
    return "admitted";
  }

  if (average >= 90) {
    return "review";
  }

  return "rejected";
}
