"use client";

import { useEffect, useMemo, useState } from "react";
import type { RuntimeArtifact, RuntimeContradiction, RuntimeState } from "@/lib/runtime/types";

type ScenarioDraft = {
  title: string;
  worldName: string;
  location: string;
  tone: string;
  style: string;
  primaryCharacterName: string;
  primaryCharacterRole: string;
  primaryCharacterDescription: string;
  continuityRules: string;
  initialSceneText: string;
  resetReason: string;
};

const SCENARIO_PRESETS: ScenarioDraft[] = [
  {
    title: "Realistic Identity Continuity Test",
    worldName: "Same Person / New Worlds",
    location: "apartment mirror, city sidewalk, boutique hotel lobby, warm evening street",
    tone: "realistic, intimate, editorial, same-person verification",
    style: "8k ultra-realistic cinematic stills, shallow depth of field, natural candid emotion",
    primaryCharacterName: "Mara Vale",
    primaryCharacterRole: "Persistent synthetic actor",
    primaryCharacterDescription: "same recognizable adult woman across different outfits and locations; face, age, hair identity, body proportions, and natural expression must remain stable",
    continuityRules: [
      "Preserve the same face, age, body structure, and core appearance markers across every output.",
      "Allow wardrobe, location, weather, lighting, camera angle, and mood to vary.",
      "Reject or flag any output where the person appears to become a different individual.",
    ].join("\n"),
    initialSceneText: "Mara Vale stands in front of a softly lit apartment mirror, phone partially covering her face, wearing a neutral winter outfit that can become the baseline identity reference.",
    resetReason: "Operator cleared the board to start a realistic same-person image set.",
  },
  {
    title: "Cinematic Street Continuity",
    worldName: "Rainline District",
    location: "rainy downtown streets, transit platforms, neon storefronts, quiet alleys",
    tone: "cinematic, grounded, restrained tension",
    style: "film still, natural motion blur, realistic lensing, no fantasy exaggeration",
    primaryCharacterName: "Elena Voss",
    primaryCharacterRole: "Primary continuity protagonist",
    primaryCharacterDescription: "same adult protagonist with stable face, dark hair identity, practical wardrobe silhouette, and guarded expression",
    continuityRules: [
      "The yellow courier case remains persistent unless explicitly removed by a governed scene.",
      "Left-arm injury remains visible unless repaired through lineage.",
      "Weather and location may change only when the scene establishes the transition.",
    ].join("\n"),
    initialSceneText: "Elena Voss waits under a transit awning in cold rain, holding the yellow courier case close while her left arm remains guarded but visible.",
    resetReason: "Operator reset into a cinematic continuity scenario.",
  },
  {
    title: "Professional Avatar Identity Set",
    worldName: "Executive Brand Studio",
    location: "studio portrait space, modern office, conference lobby, outdoor business district",
    tone: "polished, trusted, professional, human",
    style: "high-end corporate editorial photography, realistic skin texture, natural posture",
    primaryCharacterName: "Avery Stone",
    primaryCharacterRole: "Brand-consistent digital representative",
    primaryCharacterDescription: "same professional adult across polished business environments, preserving face, age, build, hairstyle, and calm direct presence",
    continuityRules: [
      "Preserve identity across business wardrobe variants.",
      "Do not overbeautify or stylize into a different person.",
      "Keep professional trust cues consistent across locations.",
    ].join("\n"),
    initialSceneText: "Avery Stone sits in a modern office beside a window, wearing a simple professional outfit, facing camera with calm credibility for a baseline avatar reference.",
    resetReason: "Operator reset into a professional avatar continuity scenario.",
  },
];

const DEFAULT_SCENARIO = SCENARIO_PRESETS[0];

type ApiRuntimeResponse = {
  ok: boolean;
  state?: RuntimeState;
  error?: string;
  message?: string;
};

function decisionLabel(decision?: string) {
  if (!decision) return "loading";
  return decision.toUpperCase();
}

export default function Page() {
  const [runtime, setRuntime] = useState<RuntimeState | null>(null);
  const [sceneText, setSceneText] = useState(DEFAULT_SCENARIO.initialSceneText);
  const [scenarioDraft, setScenarioDraft] = useState<ScenarioDraft>(DEFAULT_SCENARIO);
  const [forkName, setForkName] = useState("Continuity Repair Fork");
  const [repairNote, setRepairNote] = useState("Resolved through governed repair lineage; prior state remains visible in ancestry.");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadRuntime() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/runtime", { cache: "no-store" });
      const data = (await response.json()) as ApiRuntimeResponse;

      if (!data.ok || !data.state) {
        throw new Error(data.error || data.message || "Unable to load runtime");
      }

      setRuntime(data.state);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown load error");
    } finally {
      setLoading(false);
    }
  }

  async function runRuntimeAction(body: Record<string, unknown>, busyState: string) {
    setBusy(busyState);
    setError(null);

    try {
      const response = await fetch("/api/runtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      const data = (await response.json()) as ApiRuntimeResponse;

      if (!data.ok || !data.state) {
        throw new Error(data.error || data.message || "Runtime action failed");
      }

      setRuntime(data.state);
      if (body.action === "compile_scene") setSceneText("");
      if (body.action === "bootstrap_scenario" || body.action === "reset_world") {
        const nextSceneText = typeof body.initialSceneText === "string" ? body.initialSceneText : "";
        setSceneText(nextSceneText);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown runtime action error");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    void loadRuntime();
  }, []);

  const worldState = useMemo(() => runtime?.world?.state ?? {}, [runtime]);
  const latestDiff = runtime?.continuityDiffs?.[0] ?? null;
  const latestJob = runtime?.renderJobs?.[0] ?? null;
  const mediaArtifacts = useMemo(
    () =>
      runtime?.artifacts?.filter(
        (artifact: RuntimeArtifact) =>
          Boolean(artifact.public_url) &&
          (artifact.mime_type?.startsWith("image/") || artifact.mime_type?.startsWith("video/")),
      ) ?? [],
    [runtime],
  );
  const latestArtifact = mediaArtifacts[0] ?? null;
  const unresolvedContradictions = runtime?.contradictions?.filter((item: RuntimeContradiction) => !item.resolved) ?? [];
  const report = runtime?.admissibilityReport;
  const activeBranch = runtime?.activeBranch;
  const scenarioTitle =
    typeof worldState.scenarioTitle === "string"
      ? worldState.scenarioTitle
      : runtime?.world?.name ?? "Prime Continuity";

  function updateScenarioDraft<K extends keyof ScenarioDraft>(key: K, value: ScenarioDraft[K]) {
    setScenarioDraft((current: ScenarioDraft) => ({ ...current, [key]: value }));
  }

  function runScenarioAction(action: "bootstrap_scenario" | "reset_world") {
    const payload = {
      action,
      ...scenarioDraft,
      continuityRules: scenarioDraft.continuityRules
        .split(/\n|,/)
        .map((item: string) => item.trim())
        .filter(Boolean),
    };

    return runRuntimeAction(payload, action === "reset_world" ? "reset-world" : "bootstrap-scenario");
  }

  return (
    <main className="sf-shell">
      <aside className="sf-sidebar">
        <div className="sf-eyebrow">Moral Clarity AI</div>
        <div className="sf-logo">SolaceFrame</div>
        <p className="sf-muted">Governed synthetic continuity runtime backed by the solaceframe schema.</p>

        <nav className="sf-nav">
          {[
            "Scenario Bootstrap",
            "Admissibility",
            "Scene Compile",
            "Branch Forking",
            "Contradiction Repair",
            "Causal Graph",
            "Render Packet",
            "Execution Artifacts"
          ].map((item, index) => (
            <div className="sf-nav-item" key={item}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <span>{item}</span>
            </div>
          ))}
        </nav>

        <button className="sf-secondary" onClick={() => void loadRuntime()} disabled={Boolean(busy)}>
          Refresh Runtime
        </button>
      </aside>

      <section className="sf-main">
        <header className="sf-top">
          <div>
            <div className="sf-eyebrow">SolaceFrame V21 · Scenario Bootstrap Runtime</div>
            <h1 className="sf-title">
              Clear the board, preserve lineage, and start fresh continuity scenarios without losing audit history.
            </h1>
            <div className="sf-scenario-line">Active scenario: <strong>{scenarioTitle}</strong></div>
          </div>

          <div className={`sf-status decision-${report?.decision ?? "loading"}`}>
            {loading ? "Loading runtime" : `Runtime ${decisionLabel(report?.decision)}`}
          </div>
        </header>

        {error ? <div className="sf-error">{error}</div> : null}

        {runtime ? (
          <>
            <section className="sf-card sf-scenario-card">
              <div className="sf-card-head">
                <div>
                  <div className="sf-eyebrow">V21 Scenario Control</div>
                  <h2>Start fresh without destroying continuity history</h2>
                </div>
                <div className="sf-branch-pill">{runtime.world.name}</div>
              </div>

              <div className="sf-preset-row">
                {SCENARIO_PRESETS.map((preset) => (
                  <button
                    className="sf-preset"
                    key={preset.title}
                    onClick={() => setScenarioDraft(preset)}
                    disabled={Boolean(busy)}
                  >
                    {preset.title}
                  </button>
                ))}
              </div>

              <div className="sf-scenario-grid">
                <label className="sf-field">
                  <span>Scenario title</span>
                  <input
                    className="sf-input compact"
                    value={scenarioDraft.title}
                    onChange={(event) => updateScenarioDraft("title", event.target.value)}
                  />
                </label>

                <label className="sf-field">
                  <span>World name</span>
                  <input
                    className="sf-input compact"
                    value={scenarioDraft.worldName}
                    onChange={(event) => updateScenarioDraft("worldName", event.target.value)}
                  />
                </label>

                <label className="sf-field">
                  <span>Primary character</span>
                  <input
                    className="sf-input compact"
                    value={scenarioDraft.primaryCharacterName}
                    onChange={(event) => updateScenarioDraft("primaryCharacterName", event.target.value)}
                  />
                </label>

                <label className="sf-field">
                  <span>Location set</span>
                  <input
                    className="sf-input compact"
                    value={scenarioDraft.location}
                    onChange={(event) => updateScenarioDraft("location", event.target.value)}
                  />
                </label>
              </div>

              <label className="sf-field">
                <span>Identity / appearance anchor</span>
                <textarea
                  className="sf-textarea short"
                  value={scenarioDraft.primaryCharacterDescription}
                  onChange={(event) => updateScenarioDraft("primaryCharacterDescription", event.target.value)}
                />
              </label>

              <label className="sf-field">
                <span>Continuity rules</span>
                <textarea
                  className="sf-textarea short"
                  value={scenarioDraft.continuityRules}
                  onChange={(event) => updateScenarioDraft("continuityRules", event.target.value)}
                />
              </label>

              <label className="sf-field">
                <span>Initial scene</span>
                <textarea
                  className="sf-textarea short"
                  value={scenarioDraft.initialSceneText}
                  onChange={(event) => updateScenarioDraft("initialSceneText", event.target.value)}
                />
              </label>

              <div className="sf-action-row">
                <button
                  className="sf-primary"
                  onClick={() => void runScenarioAction("bootstrap_scenario")}
                  disabled={Boolean(busy) || !scenarioDraft.initialSceneText.trim()}
                >
                  {busy === "bootstrap-scenario" ? "Bootstrapping..." : "Bootstrap Scenario"}
                </button>

                <button
                  className="sf-primary subtle danger-action"
                  onClick={() => void runScenarioAction("reset_world")}
                  disabled={Boolean(busy) || !scenarioDraft.initialSceneText.trim()}
                >
                  {busy === "reset-world" ? "Resetting World..." : "Reset World + Start Fresh"}
                </button>
              </div>

              <p className="sf-muted">
                Reset archives the current world and branch, creates a new active world, seeds the primary identity,
                and queues the first render packet. Prior lineage remains available for audit.
              </p>
            </section>

            <section className="sf-card sf-admissibility-card">
              <div className="sf-card-head">
                <div>
                  <div className="sf-eyebrow">Runtime Admissibility</div>
                  <h2>{decisionLabel(report?.decision)} · {report?.score ?? 0}% survivability</h2>
                </div>
                <div className="sf-branch-pill">{activeBranch?.name} · {activeBranch?.status}</div>
              </div>

              <div className="sf-meter">
                <div className="sf-meter-fill" style={{ width: `${report?.score ?? 0}%` }} />
              </div>

              <div className="sf-factor-grid">
                <Metric label="World pressure" value={`${report?.factors.worldPressure ?? 0}%`} />
                <Metric label="Branch divergence" value={`${report?.factors.branchDivergence ?? 0}%`} />
                <Metric label="Open contradictions" value={String(report?.factors.unresolvedContradictions ?? 0)} />
                <Metric label="Irreversible events" value={String(report?.factors.irreversibleOpenEvents ?? 0)} />
              </div>

              <div className="sf-stack compact">
                {report?.reasons.map((reason) => (
                  <div className="sf-row-card" key={reason}>{reason}</div>
                ))}
                {report?.requiredRepairs.map((repair) => (
                  <div className="sf-row-card warning" key={repair}>{repair}</div>
                ))}
              </div>
            </section>

            <div className="sf-grid">
              <section className="sf-card">
                <div className="sf-eyebrow">Causal Scene Compiler</div>
                <textarea
                  className="sf-textarea"
                  value={sceneText}
                  onChange={(event) => setSceneText(event.target.value)}
                  placeholder="Describe the next scene..."
                />

                <button
                  className="sf-primary"
                  onClick={() => void runRuntimeAction({ action: "compile_scene", sceneText: sceneText.trim() }, "compile")}
                  disabled={Boolean(busy) || !sceneText.trim()}
                >
                  {busy === "compile" ? "Compiling Runtime..." : "Compile Governed Scene"}
                </button>

                <p className="sf-muted">
                  Persists scene state, causal events, contradictions, continuity diffs, branch pressure,
                  lineage, admissibility and a V19 continuity-lock render execution packet.
                </p>
              </section>

              <section className="sf-card">
                <div className="sf-eyebrow">Branch Forking</div>
                <input
                  className="sf-input"
                  value={forkName}
                  onChange={(event) => setForkName(event.target.value)}
                  placeholder="Fork name"
                />
                <button
                  className="sf-primary"
                  onClick={() =>
                    void runRuntimeAction(
                      {
                        action: "fork_branch",
                        name: forkName.trim() || "Continuity Repair Fork",
                        reason: "Operator forked branch from active runtime state."
                      },
                      "fork"
                    )
                  }
                  disabled={Boolean(busy)}
                >
                  {busy === "fork" ? "Forking Branch..." : "Fork Active Branch"}
                </button>
                <div className="sf-stack compact">
                  {runtime.branches.map((branch) => (
                    <div className="sf-row-card" key={branch.id}>
                      <div className="sf-row">
                        <strong>{branch.name}</strong>
                        <span>{branch.divergence_score}%</span>
                      </div>
                      <p>{branch.parent_branch_id ? `forked from ${branch.parent_branch_id}` : "prime branch"}</p>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <div className="sf-grid">
              <section className="sf-card">
                <div className="sf-eyebrow">Contradiction Repair</div>
                <textarea
                  className="sf-textarea short"
                  value={repairNote}
                  onChange={(event) => setRepairNote(event.target.value)}
                  placeholder="Repair note..."
                />
                <div className="sf-stack">
                  {unresolvedContradictions.map((item) => (
                    <ContradictionCard
                      key={item.id}
                      item={item}
                      busy={busy}
                      onResolve={() =>
                        void runRuntimeAction(
                          {
                            action: "resolve_contradiction",
                            contradictionId: item.id,
                            repairNote
                          },
                          `repair:${item.id}`
                        )
                      }
                    />
                  ))}
                  {unresolvedContradictions.length === 0 ? <p className="sf-muted">No unresolved contradictions.</p> : null}
                </div>
              </section>

              <section className="sf-card">
                <div className="sf-eyebrow">World / Branch State</div>
                <h2>{runtime.world.name}</h2>
                <div className="sf-meter">
                  <div className="sf-meter-fill" style={{ width: `${runtime.world.pressure}%` }} />
                </div>
                <div className="sf-big">{runtime.world.pressure}% world pressure</div>
                <div className="sf-muted">Branch divergence: {runtime.activeBranch.divergence_score}%</div>
                <pre className="sf-code">{JSON.stringify(worldState, null, 2)}</pre>
              </section>
            </div>

            <div className="sf-grid">
              <section className="sf-card">
                <div className="sf-eyebrow">Causal Graph</div>
                <div className="sf-stack">
                  {runtime.causalEvents.map((event) => (
                    <div className="sf-row-card" key={event.id}>
                      <div className="sf-row">
                        <strong>{event.event_type}</strong>
                        <span>{event.reversibility ?? "unclassified"} · severity {event.severity}</span>
                      </div>
                      <p>{event.subject} → {event.predicate} {event.object_ref ? `→ ${event.object_ref}` : ""}</p>
                      {event.parent_event_id ? <p className="sf-muted">parent: {event.parent_event_id}</p> : null}
                    </div>
                  ))}
                  {runtime.causalEvents.length === 0 ? <p className="sf-muted">No causal events yet.</p> : null}
                </div>
              </section>

              <section className="sf-card">
                <div className="sf-eyebrow">Character State</div>
                <div className="sf-stack">
                  {runtime.characters.map((character) => (
                    <div className="sf-row-card" key={character.id}>
                      <div className="sf-row">
                        <strong>{character.name}</strong>
                        <span>{character.continuity_score}% continuity</span>
                      </div>
                      <pre className="sf-code small">{JSON.stringify(character.state, null, 2)}</pre>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <div className="sf-grid">
              <section className="sf-card">
                <div className="sf-eyebrow">Latest Continuity Diff</div>
                {latestDiff ? (
                  <>
                    <div className="sf-chip-wrap">
                      {latestDiff.preserved.map((item) => (
                        <span className="sf-chip green" key={item}>{item}</span>
                      ))}
                      {latestDiff.mutated.map((item) => (
                        <span className="sf-chip blue" key={item}>{item}</span>
                      ))}
                      {latestDiff.violations.map((item) => (
                        <span className="sf-chip red" key={item}>{item}</span>
                      ))}
                    </div>
                    <pre className="sf-code">{JSON.stringify(latestDiff.after_state, null, 2)}</pre>
                  </>
                ) : (
                  <p className="sf-muted">No continuity diff has been created yet.</p>
                )}
              </section>

              <section className="sf-card">
                <div className="sf-eyebrow">Latest Render Packet</div>
                {latestJob ? (
                  <>
                    <div className="sf-row-card">
                      <div className="sf-row">
                        <strong>{latestJob.status}</strong>
                        <span>{latestJob.model_route ?? "pending route"}</span>
                      </div>
                      {latestJob.output_url ? (
                        <p>Artifact URL persisted.</p>
                      ) : (
                        <p>Queued packet awaiting governed execution.</p>
                      )}
                    </div>

                    <div className="sf-action-row">
                      <button
                        className="sf-primary"
                        onClick={() =>
                          void runRuntimeAction(
                            { action: "execute_render_job", renderJobId: latestJob.id, outputKind: "image" },
                            "execute:image"
                          )
                        }
                        disabled={Boolean(busy) || latestJob.status === "blocked"}
                      >
                        {busy === "execute:image" ? "Executing Image..." : "Execute Image"}
                      </button>

                      <button
                        className="sf-primary subtle"
                        onClick={() =>
                          void runRuntimeAction(
                            { action: "execute_render_job", renderJobId: latestJob.id, outputKind: "storyboard" },
                            "execute:storyboard"
                          )
                        }
                        disabled={Boolean(busy) || latestJob.status === "blocked"}
                      >
                        {busy === "execute:storyboard" ? "Executing Storyboard..." : "Execute Storyboard"}
                      </button>

                      <button
                        className="sf-primary subtle"
                        onClick={() =>
                          void runRuntimeAction(
                            { action: "execute_render_job", renderJobId: latestJob.id, outputKind: "video" },
                            "execute:video"
                          )
                        }
                        disabled={Boolean(busy) || latestJob.status === "blocked"}
                      >
                        {busy === "execute:video" ? "Generating Video..." : "Execute Video"}
                      </button>
                    </div>

                    <pre className="sf-code">{JSON.stringify(latestJob.packet, null, 2)}</pre>
                  </>
                ) : (
                  <p className="sf-muted">No packet queued yet.</p>
                )}
              </section>
            </div>


            <section className="sf-card">
              <div className="sf-card-head">
                <div>
                  <div className="sf-eyebrow">Execution Artifacts</div>
                  <h2>Storage-backed outputs with visual continuity anchors</h2>
                </div>
                <div className="sf-branch-pill">{mediaArtifacts.length} media artifacts</div>
              </div>

              {latestArtifact?.public_url && latestArtifact.mime_type?.startsWith("image/") ? (
                <div className="sf-artifact-hero">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={latestArtifact.public_url} alt="Latest SolaceFrame artifact" />
                </div>
              ) : latestArtifact?.public_url && latestArtifact.mime_type?.startsWith("video/") ? (
                <div className="sf-artifact-hero">
                  <video src={latestArtifact.public_url} controls playsInline />
                </div>
              ) : null}

              <div className="sf-stack">
                {mediaArtifacts.map((artifact) => {
                  const isImage = artifact.mime_type?.startsWith("image/");
                  const isVideo = artifact.mime_type?.startsWith("video/");
                  const isInlinePayload = artifact.public_url?.startsWith("data:");
                  const anchorLocked = isContinuityAnchor(artifact.metadata);
                  const continuityScore = getV19ContinuityScore(artifact.metadata);

                  return (
                    <div className={`sf-row-card artifact-card ${anchorLocked ? "continuity-anchor" : ""}`} key={artifact.id}>
                      <div className="sf-row">
                        <strong>{artifact.artifact_type}</strong>
                        <span>{anchorLocked ? "Continuity Anchor" : artifact.mime_type ?? "metadata"}</span>
                      </div>

                      {artifact.public_url ? (
                        <>
                          {isImage ? (
                            <div className="sf-artifact-preview">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={artifact.public_url}
                                alt={artifact.artifact_type}
                                className="sf-artifact-image"
                              />
                            </div>
                          ) : null}

                          {isVideo ? (
                            <div className="sf-artifact-preview">
                              <video
                                src={artifact.public_url}
                                controls
                                playsInline
                                className="sf-artifact-video"
                              />
                            </div>
                          ) : null}

                          <div className="sf-artifact-meta">
                            <span className="sf-chip green">
                              {artifact.storage_path ? "Supabase Storage" : isInlinePayload ? "Inline payload" : "External URL"}
                            </span>
                            {anchorLocked ? <span className="sf-chip gold">Visual anchor locked</span> : null}
                            {continuityScore !== null ? <span className="sf-chip blue">{continuityScore}% continuity</span> : null}
                            {artifact.storage_path ? (
                              <span className="sf-chip blue">{artifact.storage_path}</span>
                            ) : null}
                            {(isImage || isVideo) && artifact.public_url ? (
                              <button
                                className="sf-mini"
                                onClick={() =>
                                  void runRuntimeAction(
                                    {
                                      action: "set_continuity_anchor",
                                      artifactId: artifact.id,
                                      reason: "Operator approved this artifact as the visual continuity anchor for future renders."
                                    },
                                    `anchor:${artifact.id}`
                                  )
                                }
                                disabled={Boolean(busy) || anchorLocked}
                              >
                                {busy === `anchor:${artifact.id}`
                                  ? "Locking Anchor..."
                                  : anchorLocked
                                    ? "Anchor Locked"
                                    : "Set as Continuity Anchor"}
                              </button>
                            ) : null}
                            {!isImage && !isVideo ? (
                              <p className="sf-muted">
                                {isInlinePayload ? "Inline artifact payload persisted." : "Artifact URL persisted."}
                              </p>
                            ) : null}
                          </div>
                        </>
                      ) : (
                        <p>Execution metadata persisted without a public media URL. Check provider metadata for completion details.</p>
                      )}
                    </div>
                  );
                })}
                {mediaArtifacts.length === 0 ? (
                  <p className="sf-muted">No media artifacts are currently admitted. Execute an image, storyboard, or video render to create one. Failed provider attempts remain in render-job lineage instead of being shown as fake artifacts.</p>
                ) : null}
              </div>
            </section>

          </>
        ) : null}
      </section>
    </main>
  );
}


function isContinuityAnchor(metadata: Record<string, unknown>) {
  const v19 = metadata.v19;
  return Boolean(v19 && typeof v19 === "object" && (v19 as Record<string, unknown>).continuityAnchor === true);
}

function getV19ContinuityScore(metadata: Record<string, unknown>) {
  const v19 = metadata.v19;
  if (!v19 || typeof v19 !== "object") return null;
  const score = (v19 as Record<string, unknown>).continuityScore;
  return typeof score === "number" ? score : null;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="sf-metric">
      <div className="sf-metric-value">{value}</div>
      <div className="sf-metric-label">{label}</div>
    </div>
  );
}

function ContradictionCard({
  item,
  busy,
  onResolve
}: {
  item: RuntimeContradiction;
  busy: string | null;
  onResolve: () => void;
}) {
  return (
    <div className="sf-row-card danger">
      <div className="sf-row">
        <strong>{item.contradiction_type}</strong>
        <span>{item.severity}</span>
      </div>
      <p>{item.summary}</p>
      <button className="sf-mini" onClick={onResolve} disabled={Boolean(busy)}>
        {busy === `repair:${item.id}` ? "Repairing..." : "Resolve with Repair Lineage"}
      </button>
    </div>
  );
}
