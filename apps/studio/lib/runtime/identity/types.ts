
export type HairStyle =
  | "down"
  | "ponytail"
  | "bun"
  | "braided"
  | "wet"
  | "messy"
  | "styled";

export type MoistureState = "dry" | "damp" | "wet";

export type IdentityAdmission =
  | "admitted"
  | "review"
  | "rejected";

export interface HairState {
  style: HairStyle;
  length: "short" | "medium" | "long";
  texture: "straight" | "wavy" | "curly";
  partDirection: "left" | "right" | "center";
  moistureState: MoistureState;
  continuityLocked: boolean;
}

export interface WardrobeState {
  outerwear: string[];
  midlayer: string[];
  baselayer: string[];
  undergarments: string[];
  accessories: string[];
  continuityLocked: boolean;
}

export interface IdentityScores {
  identity_score: number;
  geometry_score: number;
  body_score: number;
  motion_score: number;
  wardrobe_score: number;
  hair_score: number;
  chronology_score: number;
  environment_score: number;
}

export interface IdentityArtifactMetadata {
  identity: {
    characterId: string;
    identityLocked: boolean;
    anchorType: string;
    canonical: boolean;
  };

  continuity: IdentityScores & {
    admission: IdentityAdmission;
    reasons: string[];
  };
}
