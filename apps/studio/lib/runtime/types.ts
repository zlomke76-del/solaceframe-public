export type Admissibility = "allow" | "conditional" | "blocked";
export type DriftRisk = "low" | "medium" | "high";
export type CausalReversibility = "reversible" | "repairable" | "irreversible";
export type RenderOutputKind = "image" | "video" | "storyboard";

export type RuntimeProject = {
  id: string;
  name: string;
  description: string | null;
  active_branch_id: string | null;
};

export type RuntimeWorld = {
  id: string;
  project_id: string;
  name: string;
  state: Record<string, unknown>;
  pressure: number;
  memory_state?: Record<string, unknown>;
  spatial_state?: Record<string, unknown>;
  object_state?: Record<string, unknown>;
};

export type RuntimeBranch = {
  id: string;
  project_id: string;
  parent_branch_id: string | null;
  name: string;
  divergence_score: number;
  status: string;
  snapshot?: Record<string, unknown> | null;
  fork_reason?: string | null;
  created_at?: string;
};

export type RuntimeCharacter = {
  id: string;
  project_id: string;
  name: string;
  role: string | null;
  appearance_anchor: Record<string, unknown>;
  state: Record<string, unknown>;
  continuity_score: number;
  pressure: number;
  identity_lock?: boolean;
  primary_identity_artifact_id?: string | null;
  identity_state?: Record<string, unknown>;
  wardrobe_state?: Record<string, unknown>;
  hair_state?: Record<string, unknown>;
  body_topology?: Record<string, unknown>;
  motion_signature?: Record<string, unknown>;
  physical_state?: Record<string, unknown>;
  anatomical_state?: Record<string, unknown>;
  recovery_state?: Record<string, unknown>;
};

export type RuntimeScene = {
  id: string;
  project_id: string;
  branch_id: string;
  title: string;
  scene_text: string;
  admissibility: Admissibility;
  drift_risk: DriftRisk;
  compiled_packet: Record<string, unknown>;
  created_at: string;
};

export type RuntimeRenderJob = {
  id: string;
  project_id: string;
  scene_id: string | null;
  branch_id: string | null;
  status: string;
  model_route: string | null;
  prompt: string;
  packet: Record<string, unknown>;
  error: string | null;
  output_url?: string | null;
  output_kind?: RenderOutputKind | string | null;
  execution_mode?: string | null;
  provider?: string | null;
  provider_job_id?: string | null;
  artifact_id?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  progress_status?: string | null;
  progress_percent?: number | null;
  provider_payload?: Record<string, unknown> | null;
  created_at: string;
};

export type RuntimeLineageEvent = {
  id: string;
  project_id: string;
  scene_id: string | null;
  render_job_id: string | null;
  event_type: string;
  summary: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type RuntimeContinuityDiff = {
  id: string;
  project_id: string;
  scene_id: string | null;
  before_state: Record<string, unknown>;
  after_state: Record<string, unknown>;
  preserved: string[];
  mutated: string[];
  violations: string[];
  created_at: string;
};

export type RuntimeCausalEvent = {
  id: string;
  project_id: string;
  branch_id: string | null;
  scene_id: string | null;
  parent_event_id?: string | null;
  repair_event_id?: string | null;
  event_key: string;
  event_type: string;
  subject: string;
  predicate: string;
  object_ref: string | null;
  severity: number;
  reversibility?: CausalReversibility | null;
  repaired?: boolean | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export type RuntimeContradiction = {
  id: string;
  project_id: string;
  branch_id: string | null;
  scene_id: string | null;
  contradiction_type: string;
  summary: string;
  severity: string;
  resolved: boolean;
  resolved_at?: string | null;
  repair_causal_event_id?: string | null;
  repair_note?: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export type RuntimeAdmissibilityReport = {
  decision: Admissibility;
  score: number;
  factors: {
    unresolvedContradictions: number;
    irreversibleOpenEvents: number;
    branchDivergence: number;
    worldPressure: number;
    survivability: number;
  };
  reasons: string[];
  requiredRepairs: string[];
};


export type RuntimeArtifact = {
  id: string;
  project_id: string;
  scene_id: string | null;
  render_job_id: string | null;
  branch_id: string | null;
  artifact_type: RenderOutputKind | string;
  storage_path?: string | null;
  public_url?: string | null;
  mime_type?: string | null;
  provider?: string | null;
  provider_job_id?: string | null;
  duration_seconds?: number | null;
  poster_url?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type RuntimeState = {
  project: RuntimeProject;
  world: RuntimeWorld;
  activeBranch: RuntimeBranch;
  branches: RuntimeBranch[];
  characters: RuntimeCharacter[];
  scenes: RuntimeScene[];
  renderJobs: RuntimeRenderJob[];
  lineageEvents: RuntimeLineageEvent[];
  continuityDiffs: RuntimeContinuityDiff[];
  causalEvents: RuntimeCausalEvent[];
  contradictions: RuntimeContradiction[];
  artifacts: RuntimeArtifact[];
  admissibilityReport: RuntimeAdmissibilityReport;
};
