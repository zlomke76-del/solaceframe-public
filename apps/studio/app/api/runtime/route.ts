import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { ensureSeedRuntime } from "@/lib/runtime/seed";
import {
  analyzeScene,
  computeBranchDelta,
  evaluateRuntimeAdmissibility,
  mutateCharacters,
  mutateWorld,
} from "@/lib/runtime/engine";
import { executeRenderRequest } from "@/lib/runtime/execution";
import { buildResolvedPacket, resolveContinuityForScene } from "@/lib/runtime/continuity-resolver";
import { buildV26ResolvedPacket, resolveSpatialRealityForScene } from "@/lib/runtime/spatial-runtime";
import type {
  RuntimeArtifact,
  RuntimeCausalEvent,
  RuntimeCharacter,
  RuntimeContradiction,
  RuntimeContinuityDiff,
  RuntimeRenderJob,
  RuntimeScene,
  RuntimeState,
  RuntimeWorld,
} from "@/lib/runtime/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RuntimeAction =
  | "compile_scene"
  | "fork_branch"
  | "resolve_contradiction"
  | "execute_render_job"
  | "bootstrap_scenario"
  | "reset_world"
  | "set_continuity_anchor"
  | "reconcile_video_job"
  | "refresh_video_jobs";

function sanitizeRuntimeErrorText(value: unknown) {
  const text = typeof value === "string" ? value : String(value || "Unknown runtime error");
  const looksLikeHtml = /<(!doctype|html|head|body|div|script|style|span|meta)\b/i.test(text);
  const mentionsProviderTimeout = /522|timed out|cloudflare|supabase/i.test(text);

  if (looksLikeHtml || mentionsProviderTimeout) {
    return "Runtime provider unavailable or timed out before returning usable JSON.";
  }

  return text.length > 420 ? `${text.slice(0, 420)}…` : text;
}

function normalizeRuntimeError(error: unknown) {
  if (error instanceof Error) {
    return {
      message: sanitizeRuntimeErrorText(error.message),
      raw: { name: error.name },
    };
  }

  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    const message =
      typeof record.message === "string"
        ? record.message
        : typeof record.error === "string"
          ? record.error
          : "Non-Error runtime failure";

    return {
      message: sanitizeRuntimeErrorText(message),
      code: typeof record.code === "string" ? record.code : undefined,
      details: typeof record.details === "string" ? sanitizeRuntimeErrorText(record.details) : undefined,
      hint: typeof record.hint === "string" ? sanitizeRuntimeErrorText(record.hint) : undefined,
      raw: { sanitized: true },
    };
  }

  return { message: sanitizeRuntimeErrorText(error), raw: { sanitized: true } };
}

function jsonError(error: unknown, status = 500) {
  const normalized = normalizeRuntimeError(error);
  console.error("SolaceFrame runtime error:", normalized);
  return NextResponse.json({ ok: false, ...normalized }, { status });
}

export async function GET() {
  try {
    const projectId = await ensureSeedRuntime();
    const state = await loadRuntimeState(projectId);
    return NextResponse.json({ ok: true, state });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const action = String(body.action || "compile_scene") as RuntimeAction;

    if (action === "fork_branch") {
      return await forkBranch(body);
    }

    if (action === "resolve_contradiction") {
      return await resolveContradiction(body);
    }

    if (action === "execute_render_job") {
      return await executeRenderJob(body);
    }

    if (action === "bootstrap_scenario") {
      return await bootstrapScenario(body, false);
    }

    if (action === "reset_world") {
      return await bootstrapScenario(body, true);
    }

    if (action === "set_continuity_anchor") {
      return await setContinuityAnchor(body);
    }

    if (action === "reconcile_video_job") {
      return await reconcileVideoJob(body);
    }

    if (action === "refresh_video_jobs") {
      return await refreshVideoJobs(body);
    }

    return await compileScene(body);
  } catch (error) {
    return jsonError(error);
  }
}

async function compileScene(body: Record<string, unknown>) {
  const sceneText = String(body.sceneText || "").trim();

  if (!sceneText) {
    return NextResponse.json(
      { ok: false, error: "sceneText is required" },
      { status: 400 },
    );
  }

  const projectId = await ensureSeedRuntime();
  const supabase = getSupabaseAdmin().schema("solaceframe");
  const state = await loadRuntimeState(projectId);

  const unresolvedContradictions = state.contradictions.filter(
    (item) => !item.resolved,
  );
  const analysis = analyzeScene(
    sceneText,
    state.world,
    state.characters,
    state.causalEvents,
    unresolvedContradictions,
  );

  const continuityResolution = resolveContinuityForScene({
    sceneText,
    state,
    analysis,
  });
  const v25Packet = buildResolvedPacket(analysis.packet, continuityResolution);
  const spatialResolution = resolveSpatialRealityForScene({
    sceneText,
    state,
    analysis,
    continuityResolution,
  });
  const resolvedPacket = buildV26ResolvedPacket({
    packet: v25Packet,
    spatialResolution,
  });

  const beforeState = {
    world: state.world,
    characters: state.characters,
    causalEvents: state.causalEvents.slice(0, 20),
    unresolvedContradictions,
    activeBranch: state.activeBranch,
    admissibilityReport: state.admissibilityReport,
    continuityResolution,
    spatialResolution,
  };

  const nextWorld = mutateWorld(state.world, analysis);
  const nextCharacters = mutateCharacters(
    state.characters,
    sceneText,
    analysis,
  );
  const branchDelta = computeBranchDelta(analysis);

  const { data: scene, error: sceneError } = await supabase
    .from("scenes")
    .insert({
      project_id: projectId,
      branch_id: state.activeBranch.id,
      title: analysis.title,
      scene_text: sceneText,
      admissibility: analysis.admissibility,
      drift_risk: analysis.driftRisk,
      compiled_packet: resolvedPacket,
    })
    .select("*")
    .single();

  if (sceneError) throw sceneError;

  if (analysis.causalEvents.length > 0) {
    const { error: causalError } = await supabase.from("causal_events").insert(
      analysis.causalEvents.map((event) => ({
        project_id: projectId,
        branch_id: state.activeBranch.id,
        scene_id: scene.id,
        parent_event_id: event.parent_event_id ?? null,
        event_key: event.event_key,
        event_type: event.event_type,
        subject: event.subject,
        predicate: event.predicate,
        object_ref: event.object_ref,
        severity: event.severity,
        reversibility: event.reversibility,
        repaired: false,
        payload: event.payload,
      })),
    );

    if (causalError) throw causalError;
  }

  if (analysis.contradictions.length > 0) {
    const { error: contradictionError } = await supabase
      .from("contradictions")
      .insert(
        analysis.contradictions.map((contradiction) => ({
          project_id: projectId,
          branch_id: state.activeBranch.id,
          scene_id: scene.id,
          contradiction_type: contradiction.contradiction_type,
          summary: contradiction.summary,
          severity: contradiction.severity,
          resolved: false,
          payload: contradiction.payload,
        })),
      );

    if (contradictionError) throw contradictionError;
  }

  const { error: worldError } = await supabase
    .from("worlds")
    .update({
      state: nextWorld.state,
      pressure: nextWorld.pressure,
      spatial_state: spatialResolution.nextSpatialState,
      object_state: spatialResolution.nextObjectState,
    })
    .eq("id", state.world.id);

  if (worldError) throw worldError;

  for (const character of nextCharacters) {
    const { error: characterError } = await supabase
      .from("characters")
      .update({
        state: character.state,
        anatomical_state: character.anatomical_state ?? {},
        physical_state: character.physical_state ?? {},
        recovery_state: character.recovery_state ?? {},
        continuity_score: character.continuity_score,
        pressure: character.pressure,
      })
      .eq("id", character.id);

    if (characterError) throw characterError;
  }

  const nextDivergence = Math.min(
    100,
    state.activeBranch.divergence_score + branchDelta.divergenceDelta,
  );

  const { error: branchError } = await supabase
    .from("branches")
    .update({
      divergence_score: nextDivergence,
      status:
        analysis.admissibility === "blocked"
          ? "blocked-review"
          : state.activeBranch.status,
    })
    .eq("id", state.activeBranch.id);

  if (branchError) throw branchError;

  const { data: renderJob, error: renderError } = await supabase
    .from("render_jobs")
    .insert({
      project_id: projectId,
      scene_id: scene.id,
      branch_id: state.activeBranch.id,
      status: analysis.admissibility === "blocked" ? "blocked" : "queued",
      model_route: "solaceframe-execution-router",
      prompt: buildCanonicalPrompt(sceneText, resolvedPacket),
      packet: resolvedPacket,
      output_kind: "image",
      execution_mode: "manual",
    })
    .select("*")
    .single();

  if (renderError) throw renderError;

  const afterState = {
    world: nextWorld,
    characters: nextCharacters,
    causalEvents: analysis.causalEvents,
    contradictions: analysis.contradictions,
    branch: {
      ...state.activeBranch,
      divergence_score: nextDivergence,
    },
  };

  const { error: diffError } = await supabase.from("continuity_diffs").insert({
    project_id: projectId,
    scene_id: scene.id,
    before_state: beforeState,
    after_state: afterState,
    preserved: analysis.preserve,
    mutated: analysis.mutated,
    violations: analysis.violations,
  });

  if (diffError) throw diffError;

  const { error: lineageError } = await supabase.from("lineage_events").insert({
    project_id: projectId,
    scene_id: scene.id,
    render_job_id: renderJob.id,
    event_type: "causal-scene-compiled",
    summary: `Causal scene compiled: ${analysis.title}`,
    payload: {
      admissibility: analysis.admissibility,
      driftRisk: analysis.driftRisk,
      renderJobId: renderJob.id,
      causalEvents: analysis.causalEvents,
      contradictions: analysis.contradictions,
      renderConstraints: continuityResolution.resolvedRenderConstraints,
      suppressedConstraints: continuityResolution.suppressedConstraints,
      continuityResolution,
      spatialResolution,
    },
  });

  if (lineageError) throw lineageError;

  const nextState = await loadRuntimeState(projectId);
  return NextResponse.json({ ok: true, analysis, continuityResolution, spatialResolution, state: nextState });
}

async function executeRenderJob(body: Record<string, unknown>) {
  const renderJobId = String(body.renderJobId || "").trim();
  const outputKind = String(body.outputKind || "image") as
    | "image"
    | "video"
    | "storyboard";

  if (!renderJobId) {
    return NextResponse.json(
      { ok: false, error: "renderJobId is required" },
      { status: 400 },
    );
  }

  if (!["image", "video", "storyboard"].includes(outputKind)) {
    return NextResponse.json(
      { ok: false, error: "outputKind must be image, video, or storyboard" },
      { status: 400 },
    );
  }

  const projectId = await ensureSeedRuntime();
  const supabase = getSupabaseAdmin().schema("solaceframe");
  const state = await loadRuntimeState(projectId);
  const job = state.renderJobs.find((item: RuntimeRenderJob) => item.id === renderJobId);

  if (!job) {
    return NextResponse.json(
      { ok: false, error: "Render job not found" },
      { status: 404 },
    );
  }

  if (job.status === "blocked") {
    return NextResponse.json(
      {
        ok: false,
        error: "Render job is blocked by prior admissibility state",
      },
      { status: 409 },
    );
  }

  const startedAt = new Date().toISOString();

  if (outputKind === "video") {
    const activeVideoStatuses = [
      "queued",
      "submitted",
      "provider_accepted",
      "generating",
      "awaiting_media",
      "reconciling",
    ];
    const activeVideoJob = state.renderJobs.find(
      (item: RuntimeRenderJob) =>
        item.id !== job.id &&
        item.branch_id === job.branch_id &&
        item.output_kind === "video" &&
        activeVideoStatuses.includes(item.status),
    );

    if (activeVideoJob) {
      return NextResponse.json(
        {
          ok: false,
          error: "An active video orchestration already exists for this branch.",
          activeVideoJobId: activeVideoJob.id,
          state,
        },
        { status: 409 },
      );
    }
  }

  const { error: runningError } = await supabase
    .from("render_jobs")
    .update({
      status: outputKind === "video" ? "submitted" : "running",
      output_kind: outputKind,
      execution_mode: resolveExecutionMode(outputKind),
      started_at: startedAt,
      progress_status:
        outputKind === "video" ? "submitting-video-generation" : "generating",
      progress_percent: outputKind === "video" ? 15 : 10,
      error: null,
    })
    .eq("id", job.id);

  if (runningError) throw runningError;

  const execution = await executeRenderRequest({ job, outputKind, state });
  const completedAt = new Date().toISOString();

  const shouldHoldVideoForAsyncCompletion =
    outputKind === "video" &&
    execution.provider === "vercel-ai-gateway-video" &&
    execution.status !== "blocked" &&
    !execution.artifactUrl &&
    !isFatalProviderExecutionError(execution.error);

  if (execution.status === "queued" || shouldHoldVideoForAsyncCompletion) {
    const { error: jobError } = await supabase
      .from("render_jobs")
      .update({
        status: execution.providerJobId ? "provider_accepted" : "awaiting_media",
        model_route: execution.provider,
        provider: execution.provider,
        provider_job_id: execution.providerJobId,
        output_url: null,
        artifact_id: null,
        completed_at: null,
        progress_status: execution.providerJobId
          ? "provider-accepted-video-job-awaiting-completion"
          : "awaiting-provider-media-or-operation-id",
        progress_percent: 35,
        provider_payload: {
          provider: execution.provider,
          providerJobId: execution.providerJobId,
          outputKind,
          artifactUrlPersisted: false,
          mimeType: execution.mimeType,
          error: execution.error,
          metadata: execution.metadata,
          v203: {
            artifactAdmitted: false,
            routeBehavior: "async-video-held-without-502",
            reason:
              "Video provider returned or implied async completion state without an immediate public MP4. The job remains queued for reconciliation; no metadata-only artifact is admitted and the API returns ok:true.",
          },
        },
        error: null,
      })
      .eq("id", job.id);

    if (jobError) throw jobError;

    const { error: lineageError } = await supabase.from("lineage_events").insert({
      project_id: projectId,
      scene_id: job.scene_id,
      render_job_id: job.id,
      event_type: "render-video-submitted",
      summary: `Video render job submitted for async provider completion: ${outputKind}`,
      payload: {
        renderJobId: job.id,
        artifactId: null,
        provider: execution.provider,
        providerJobId: execution.providerJobId,
        outputKind,
        startedAt,
        queuedAt: completedAt,
        error: null,
        metadata: execution.metadata,
        artifactAdmitted: false,
        v203: {
          routeBehavior: "async-video-held-without-502",
        },
      },
    });

    if (lineageError) throw lineageError;

    const nextState = await loadRuntimeState(projectId);
    return NextResponse.json({ ok: true, execution, state: nextState });
  }

  if (execution.status !== "completed") {
    const { error: jobError } = await supabase
      .from("render_jobs")
      .update({
        status: execution.status,
        model_route: execution.provider,
        provider: execution.provider,
        provider_job_id: execution.providerJobId,
        output_url: null,
        artifact_id: null,
        completed_at: completedAt,
        progress_status:
          execution.status === "blocked"
            ? "blocked-by-admissibility"
            : "provider-failed-no-artifact-admitted",
        progress_percent: 0,
        provider_payload: {
          provider: execution.provider,
          providerJobId: execution.providerJobId,
          outputKind,
          artifactUrlPersisted: false,
          mimeType: execution.mimeType,
          error: execution.error,
          metadata: execution.metadata,
          v192: {
            artifactAdmitted: false,
            reason:
              "Failed or blocked executions are recorded on the render job and lineage only. No metadata-only artifact card is admitted into the artifact gallery.",
          },
        },
        error: execution.error,
      })
      .eq("id", job.id);

    if (jobError) throw jobError;

    const { error: lineageError } = await supabase.from("lineage_events").insert({
      project_id: projectId,
      scene_id: job.scene_id,
      render_job_id: job.id,
      event_type:
        execution.status === "blocked" ? "render-blocked" : "render-failed",
      summary: `Render job ${execution.status}: ${outputKind}`,
      payload: {
        renderJobId: job.id,
        artifactId: null,
        provider: execution.provider,
        providerJobId: execution.providerJobId,
        outputKind,
        startedAt,
        completedAt,
        error: execution.error,
        metadata: execution.metadata,
        artifactAdmitted: false,
      },
    });

    if (lineageError) throw lineageError;

    const nextState = await loadRuntimeState(projectId);
    return NextResponse.json(
      {
        ok: false,
        error: execution.error || `Render job ${execution.status}`,
        execution,
        state: nextState,
      },
      { status: execution.status === "blocked" ? 409 : 502 },
    );
  }

  const persistedMedia = await persistExecutionMedia({
    projectId,
    renderJobId: job.id,
    artifactType: execution.artifactType,
    artifactUrl: execution.artifactUrl,
    mimeType: execution.mimeType,
  });

  if (!persistedMedia.publicUrl) {
    const { error: jobError } = await supabase
      .from("render_jobs")
      .update({
        status: "failed",
        model_route: execution.provider,
        provider: execution.provider,
        provider_job_id: execution.providerJobId,
        output_url: null,
        artifact_id: null,
        completed_at: completedAt,
        progress_status: "provider-completed-without-public-media-url",
        progress_percent: 0,
        provider_payload: {
          provider: execution.provider,
          providerJobId: execution.providerJobId,
          outputKind,
          artifactUrlPersisted: false,
          mimeType: persistedMedia.mimeType,
          error: "Provider completed but no public media URL was available to admit as an artifact.",
          metadata: execution.metadata,
        },
        error: "Provider completed but no public media URL was available to admit as an artifact.",
      })
      .eq("id", job.id);

    if (jobError) throw jobError;

    const { error: lineageError } = await supabase.from("lineage_events").insert({
      project_id: projectId,
      scene_id: job.scene_id,
      render_job_id: job.id,
      event_type: "render-failed",
      summary: `Render job failed: ${outputKind}`,
      payload: {
        renderJobId: job.id,
        artifactId: null,
        provider: execution.provider,
        providerJobId: execution.providerJobId,
        outputKind,
        startedAt,
        completedAt,
        error: "Provider completed but no public media URL was available to admit as an artifact.",
        metadata: execution.metadata,
        artifactAdmitted: false,
      },
    });

    if (lineageError) throw lineageError;

    const nextState = await loadRuntimeState(projectId);
    return NextResponse.json(
      {
        ok: false,
        error: "Provider completed but no public media URL was available to admit as an artifact.",
        execution,
        state: nextState,
      },
      { status: 502 },
    );
  }

  const { data: artifact, error: artifactError } = await supabase
    .from("artifacts")
    .insert({
      project_id: projectId,
      scene_id: job.scene_id,
      render_job_id: job.id,
      branch_id: job.branch_id,
      artifact_type: execution.artifactType,
      storage_path: persistedMedia.storagePath,
      public_url: persistedMedia.publicUrl,
      mime_type: persistedMedia.mimeType,
      metadata: {
        ...execution.metadata,
        v18: {
          storageBacked: Boolean(persistedMedia.storagePath),
          originalDelivery: persistedMedia.originalDelivery,
          bucket: persistedMedia.bucket,
          storagePath: persistedMedia.storagePath,
          byteLength: persistedMedia.byteLength,
          persistedAt: persistedMedia.persistedAt,
          videoProviderEnabled:
            outputKind === "video" &&
            execution.provider === "vercel-ai-gateway-video",
        },
        v181: {
          completionRuntime:
            outputKind === "video"
              ? "video-result-extraction"
              : "standard-media-completion",
          hasPublicMediaUrl: Boolean(persistedMedia.publicUrl),
          finalMimeType: persistedMedia.mimeType,
          finalStatus: execution.status,
        },
        v192: {
          artifactAdmitted: true,
          reason:
            "Only completed executions with a public media URL are admitted into the artifact gallery.",
        },
      },
    })
    .select("*")
    .single();

  if (artifactError) throw artifactError;

  const { error: jobError } = await supabase
    .from("render_jobs")
    .update({
      status: execution.status,
      model_route: execution.provider,
      provider: execution.provider,
      provider_job_id: execution.providerJobId,
      output_url: persistedMedia.publicUrl,
      artifact_id: artifact.id,
      completed_at: completedAt,
      progress_status: "completed",
      progress_percent: 100,
      provider_payload: {
        provider: execution.provider,
        providerJobId: execution.providerJobId,
        outputKind,
        artifactUrlPersisted: Boolean(persistedMedia.publicUrl),
        mimeType: persistedMedia.mimeType,
        error: execution.error,
        metadata: execution.metadata,
      },
      error: execution.error,
    })
    .eq("id", job.id);

  if (jobError) throw jobError;

  const { error: lineageError } = await supabase.from("lineage_events").insert({
    project_id: projectId,
    scene_id: job.scene_id,
    render_job_id: job.id,
    event_type: "render-executed",
    summary: `Render job completed: ${outputKind}`,
    payload: {
      renderJobId: job.id,
      artifactId: artifact.id,
      provider: execution.provider,
      providerJobId: execution.providerJobId,
      outputKind,
      startedAt,
      completedAt,
      error: execution.error,
      artifactAdmitted: true,
    },
  });

  if (lineageError) throw lineageError;

  const nextState = await loadRuntimeState(projectId);
  return NextResponse.json({
    ok: true,
    execution: {
      ...execution,
      artifactUrl: persistedMedia.publicUrl,
      mimeType: persistedMedia.mimeType,
    },
    artifact,
    state: nextState,
  });

}

async function refreshVideoJobs(body: Record<string, unknown>) {
  const projectId = await ensureSeedRuntime();
  const state = await loadRuntimeState(projectId);
  const activeVideoStatuses = [
    "queued",
    "submitted",
    "provider_accepted",
    "generating",
    "awaiting_media",
    "reconciling",
  ];
  const maxJobs = Math.max(1, Math.min(Number(body.limit || 3), 6));
  const jobs = state.renderJobs
    .filter(
      (job: RuntimeRenderJob) =>
        job.output_kind === "video" && activeVideoStatuses.includes(job.status),
    )
    .slice(0, maxJobs);

  for (const job of jobs) {
    await reconcileVideoJob({ renderJobId: job.id, internal: true });
  }

  const nextState = await loadRuntimeState(projectId);
  return NextResponse.json({ ok: true, reconciled: jobs.length, state: nextState });
}

async function reconcileVideoJob(body: Record<string, unknown>) {
  const renderJobId = String(body.renderJobId || "").trim();

  if (!renderJobId) {
    return NextResponse.json(
      { ok: false, error: "renderJobId is required" },
      { status: 400 },
    );
  }

  const projectId = await ensureSeedRuntime();
  const supabase = getSupabaseAdmin().schema("solaceframe");
  const state = await loadRuntimeState(projectId);
  const job = state.renderJobs.find((item: RuntimeRenderJob) => item.id === renderJobId);

  if (!job) {
    return NextResponse.json(
      { ok: false, error: "Render job not found" },
      { status: 404 },
    );
  }

  if (job.output_kind !== "video") {
    return NextResponse.json(
      { ok: false, error: "Only video render jobs can be reconciled by this action" },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const providerPayload = job.provider_payload ?? {};
  const mediaUrl = extractReconciliationMediaUrl(job, providerPayload);
  const mimeType = extractReconciliationMimeType(providerPayload) || "video/mp4";

  if (!mediaUrl) {
    const degraded = shouldMarkVideoJobDegraded(job);
    const nextStatus = degraded ? "degraded" : "awaiting_media";
    const nextProgress = degraded ? job.progress_percent ?? 35 : Math.min(90, Math.max(job.progress_percent ?? 35, 45));

    const { error: jobError } = await supabase
      .from("render_jobs")
      .update({
        status: nextStatus,
        progress_status: degraded
          ? "provider-state-preserved-without-retrievable-media"
          : "awaiting-provider-media-reconciliation",
        progress_percent: nextProgress,
        provider_payload: {
          ...providerPayload,
          v22: {
            ...(isRecord(providerPayload.v22) ? providerPayload.v22 : {}),
            lastReconciledAt: now,
            reconciler: "server-side-bounded-refresh",
            mediaAvailable: false,
            degraded,
          },
        },
        completed_at: degraded ? now : null,
        error: degraded ? "Provider state was preserved, but no retrievable video media was available for admission." : null,
      })
      .eq("id", job.id);

    if (jobError) throw jobError;

    const { error: lineageError } = await supabase.from("lineage_events").insert({
      project_id: projectId,
      scene_id: job.scene_id,
      render_job_id: job.id,
      event_type: degraded ? "render-video-degraded" : "render-video-awaiting-media",
      summary: degraded
        ? "Video job preserved in degraded state without admissible media."
        : "Video job checked; provider media is not yet available.",
      payload: {
        renderJobId: job.id,
        provider: job.provider,
        providerJobId: job.provider_job_id,
        reconciledAt: now,
        degraded,
        artifactAdmitted: false,
      },
    });

    if (lineageError) throw lineageError;

    const nextState = await loadRuntimeState(projectId);
    return NextResponse.json({ ok: true, reconciled: true, degraded, state: nextState });
  }

  const { error: reconcilingError } = await supabase
    .from("render_jobs")
    .update({
      status: "reconciling",
      progress_status: "reconciling-provider-video-media",
      progress_percent: 92,
      provider_payload: {
        ...providerPayload,
        v22: {
          ...(isRecord(providerPayload.v22) ? providerPayload.v22 : {}),
          reconciliationStartedAt: now,
          mediaAvailable: true,
        },
      },
    })
    .eq("id", job.id);

  if (reconcilingError) throw reconcilingError;

  const persistedMedia = await persistExecutionMedia({
    projectId,
    renderJobId: job.id,
    artifactType: "video",
    artifactUrl: mediaUrl,
    mimeType,
  });

  if (!persistedMedia.publicUrl) {
    throw new Error("Video reconciliation found provider media but could not produce a public artifact URL.");
  }

  const admission = buildMotionContinuityAdmission(state, job);
  const finalStatus = admission.status === "rejected" ? "rejected" : "completed";
  const completedAt = new Date().toISOString();

  let artifact: RuntimeArtifact | null = null;

  if (admission.status !== "rejected") {
    const { data, error: artifactError } = await supabase
      .from("artifacts")
      .insert({
        project_id: projectId,
        scene_id: job.scene_id,
        render_job_id: job.id,
        branch_id: job.branch_id,
        artifact_type: "video",
        storage_path: persistedMedia.storagePath,
        public_url: persistedMedia.publicUrl,
        mime_type: persistedMedia.mimeType,
        provider: job.provider,
        provider_job_id: job.provider_job_id,
        metadata: {
          v22: {
            admission,
            storageBacked: Boolean(persistedMedia.storagePath),
            originalDelivery: persistedMedia.originalDelivery,
            bucket: persistedMedia.bucket,
            storagePath: persistedMedia.storagePath,
            byteLength: persistedMedia.byteLength,
            persistedAt: persistedMedia.persistedAt,
          },
          sourceRenderJobId: job.id,
          providerPayload,
        },
      })
      .select("*")
      .single();

    if (artifactError) throw artifactError;
    artifact = data as RuntimeArtifact;
  }

  const { error: jobError } = await supabase
    .from("render_jobs")
    .update({
      status: finalStatus,
      output_url: admission.status === "rejected" ? null : persistedMedia.publicUrl,
      artifact_id: artifact?.id ?? null,
      completed_at: completedAt,
      progress_status: admission.status === "rejected" ? "motion-continuity-rejected" : "completed",
      progress_percent: admission.status === "rejected" ? 100 : 100,
      provider_payload: {
        ...providerPayload,
        v22: {
          ...(isRecord(providerPayload.v22) ? providerPayload.v22 : {}),
          admission,
          reconciledAt: completedAt,
          artifactId: artifact?.id ?? null,
          artifactAdmitted: admission.status !== "rejected",
        },
      },
      error: admission.status === "rejected" ? "Motion continuity admission rejected this artifact." : null,
    })
    .eq("id", job.id);

  if (jobError) throw jobError;

  const { error: lineageError } = await supabase.from("lineage_events").insert({
    project_id: projectId,
    scene_id: job.scene_id,
    render_job_id: job.id,
    event_type: admission.status === "rejected" ? "render-video-rejected" : "render-video-reconciled",
    summary:
      admission.status === "rejected"
        ? "Video artifact rejected by motion continuity admission."
        : "Video artifact reconciled and admitted into continuity runtime.",
    payload: {
      renderJobId: job.id,
      artifactId: artifact?.id ?? null,
      provider: job.provider,
      providerJobId: job.provider_job_id,
      admission,
      completedAt,
      artifactAdmitted: admission.status !== "rejected",
    },
  });

  if (lineageError) throw lineageError;

  const nextState = await loadRuntimeState(projectId);
  return NextResponse.json({ ok: true, reconciled: true, admission, artifact, state: nextState });
}

function extractReconciliationMediaUrl(job: RuntimeRenderJob, providerPayload: Record<string, unknown>) {
  if (typeof job.output_url === "string" && /^https?:\/\//i.test(job.output_url)) return job.output_url;

  const candidates = [
    providerPayload.artifactUrl,
    providerPayload.outputUrl,
    providerPayload.publicUrl,
    providerPayload.videoUrl,
    (providerPayload.metadata as Record<string, unknown> | undefined)?.artifactUrl,
    (providerPayload.metadata as Record<string, unknown> | undefined)?.outputUrl,
    (providerPayload.metadata as Record<string, unknown> | undefined)?.publicUrl,
    (providerPayload.metadata as Record<string, unknown> | undefined)?.videoUrl,
    ((providerPayload.metadata as Record<string, unknown> | undefined)?.response as Record<string, unknown> | undefined)?.url,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && (candidate.startsWith("data:video/") || /^https?:\/\//i.test(candidate))) {
      return candidate;
    }
  }

  return null;
}

function extractReconciliationMimeType(providerPayload: Record<string, unknown>) {
  const candidates = [
    providerPayload.mimeType,
    (providerPayload.metadata as Record<string, unknown> | undefined)?.mimeType,
    (providerPayload.metadata as Record<string, unknown> | undefined)?.contentType,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.includes("/")) return candidate;
  }

  return null;
}

function shouldMarkVideoJobDegraded(job: RuntimeRenderJob) {
  const createdAt = job.started_at || job.created_at;
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const thresholdMs = Number(process.env.SOLACEFRAME_VIDEO_DEGRADE_AFTER_MS || 1000 * 60 * 20);
  return Number.isFinite(ageMs) && ageMs > thresholdMs;
}

function buildMotionContinuityAdmission(state: RuntimeState, job: RuntimeRenderJob) {
  const baseContinuity = Math.max(0, Math.min(100, state.admissibilityReport.score));
  const worldPenalty = Math.round((state.world.pressure || 0) * 0.08);
  const branchPenalty = Math.round((state.activeBranch.divergence_score || 0) * 0.08);
  const contradictionPenalty = state.contradictions.filter((item) => !item.resolved).length * 2;
  const continuityScore = Math.max(0, Math.min(100, baseContinuity - worldPenalty - branchPenalty - contradictionPenalty));
  const identityScore = Math.max(0, Math.min(100, Math.round(averageCharacterContinuity(state))));
  const motionScore = Math.max(0, Math.min(100, continuityScore - (job.provider_job_id ? 0 : 4)));
  const chronologyScore = Math.max(0, Math.min(100, 100 - branchPenalty - contradictionPenalty));
  const environmentalScore = Math.max(0, Math.min(100, 100 - worldPenalty));
  const aggregate = Math.round((continuityScore + identityScore + motionScore + chronologyScore + environmentalScore) / 5);
  const status = aggregate >= 95 ? "admitted" : aggregate >= 90 ? "review" : "rejected";

  return {
    version: "v22-motion-continuity-admission",
    continuity_score: continuityScore,
    drift_score: 100 - aggregate,
    identity_score: identityScore,
    motion_score: motionScore,
    chronology_score: chronologyScore,
    environmental_score: environmentalScore,
    aggregate_score: aggregate,
    status,
    reasons: status === "admitted"
      ? ["Motion artifact admitted from current bounded runtime state."]
      : status === "review"
        ? ["Motion artifact requires operator review before it becomes a strong continuity anchor."]
        : ["Motion artifact remains in lineage but is not admitted as canonical continuity media."],
  };
}

function averageCharacterContinuity(state: RuntimeState) {
  if (state.characters.length === 0) return 94;
  return state.characters.reduce((sum, character) => sum + (character.continuity_score || 0), 0) / state.characters.length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isFatalProviderExecutionError(error: string | null) {
  if (!error) return false;
  return /\b(400|401|403|404|429)\b|rate limit|quota|billing|unauthorized|forbidden|invalid api key|invalid model|model not found|not supported/i.test(error);
}

function resolveExecutionMode(outputKind: "image" | "video" | "storyboard") {
  if (process.env.SOLACEFRAME_RENDER_WEBHOOK_URL) return "external-webhook";
  if (process.env.SOLACEFRAME_FORCE_PLACEHOLDER_RENDER === "true")
    return "local-placeholder";
  if (
    process.env.VERCEL_AI_GATEWAY_API_KEY ||
    process.env.AI_GATEWAY_API_KEY ||
    process.env.VERCEL_OIDC_TOKEN
  ) {
    return outputKind === "video"
      ? "vercel-ai-gateway-video"
      : "vercel-ai-gateway";
  }
  return "local-placeholder";
}

type PersistExecutionMediaInput = {
  projectId: string;
  renderJobId: string;
  artifactType: string;
  artifactUrl: string | null;
  mimeType: string | null;
};

type PersistedExecutionMedia = {
  publicUrl: string | null;
  storagePath: string | null;
  mimeType: string | null;
  bucket: string | null;
  originalDelivery: "none" | "data-url" | "external-url";
  byteLength: number | null;
  persistedAt: string;
};

async function persistExecutionMedia(
  input: PersistExecutionMediaInput,
): Promise<PersistedExecutionMedia> {
  const persistedAt = new Date().toISOString();

  if (!input.artifactUrl) {
    return {
      publicUrl: null,
      storagePath: null,
      mimeType: input.mimeType,
      bucket: null,
      originalDelivery: "none",
      byteLength: null,
      persistedAt,
    };
  }

  const parsedDataUrl = parseDataUrl(input.artifactUrl, input.mimeType);

  if (!parsedDataUrl) {
    return {
      publicUrl: input.artifactUrl,
      storagePath: null,
      mimeType: input.mimeType,
      bucket: null,
      originalDelivery: "external-url",
      byteLength: null,
      persistedAt,
    };
  }

  const bucket =
    process.env.SOLACEFRAME_ARTIFACT_BUCKET || "solaceframe-artifacts";
  const extension = extensionForMimeType(
    parsedDataUrl.mimeType,
    input.artifactType,
  );
  const safeArtifactType =
    input.artifactType.replace(/[^a-z0-9_-]/gi, "-").toLowerCase() ||
    "artifact";
  const storagePath = [
    input.projectId,
    input.renderJobId,
    `${Date.now()}-${safeArtifactType}.${extension}`,
  ].join("/");

  const rootSupabase = getSupabaseAdmin();
  const { error: uploadError } = await rootSupabase.storage
    .from(bucket)
    .upload(storagePath, parsedDataUrl.buffer, {
      contentType: parsedDataUrl.mimeType,
      cacheControl: "31536000",
      upsert: false,
    });

  if (uploadError) throw uploadError;

  const { data } = rootSupabase.storage.from(bucket).getPublicUrl(storagePath);

  return {
    publicUrl: data.publicUrl,
    storagePath,
    mimeType: parsedDataUrl.mimeType,
    bucket,
    originalDelivery: "data-url",
    byteLength: parsedDataUrl.buffer.byteLength,
    persistedAt,
  };
}

function parseDataUrl(
  value: string,
  fallbackMimeType: string | null,
): { mimeType: string; buffer: Buffer } | null {
  if (!value.startsWith("data:")) return null;

  const commaIndex = value.indexOf(",");
  if (commaIndex < 0) return null;

  const metadata = value.slice(5, commaIndex);
  const payload = value.slice(commaIndex + 1);
  const metadataParts = metadata.split(";").filter(Boolean);
  const mimeType =
    metadataParts.find((part) => part.includes("/")) ||
    fallbackMimeType ||
    "application/octet-stream";
  const isBase64 = metadataParts.includes("base64");

  return {
    mimeType,
    buffer: isBase64
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf8"),
  };
}

function extensionForMimeType(mimeType: string, artifactType: string) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/svg+xml") return "svg";
  if (mimeType === "video/mp4") return "mp4";
  if (mimeType === "application/json" || artifactType === "storyboard")
    return "json";
  return "bin";
}


type ScenarioBootstrapInput = {
  title: string;
  worldName: string;
  location: string;
  tone: string;
  style: string;
  primaryCharacterName: string;
  primaryCharacterRole: string;
  primaryCharacterDescription: string;
  continuityRules: string[];
  initialSceneText: string;
  resetReason: string;
};

function normalizeString(value: unknown, fallback: string) {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizeStringList(value: unknown, fallback: string[]) {
  if (Array.isArray(value)) {
    const items = value.map((item) => String(item || "").trim()).filter(Boolean);
    if (items.length > 0) return items;
  }

  if (typeof value === "string") {
    const items = value
      .split(/\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (items.length > 0) return items;
  }

  return fallback;
}

function normalizeScenarioInput(body: Record<string, unknown>): ScenarioBootstrapInput {
  const title = normalizeString(body.title, "Fresh Continuity Scenario");
  const worldName = normalizeString(body.worldName, `${title} World`);
  const location = normalizeString(body.location, "realistic urban interior and exterior locations");
  const tone = normalizeString(body.tone, "grounded, cinematic, continuity-first");
  const style = normalizeString(body.style, "realistic 8k editorial film stills with natural lighting");
  const primaryCharacterName = normalizeString(body.primaryCharacterName, "Primary Synthetic Actor");
  const primaryCharacterRole = normalizeString(body.primaryCharacterRole, "Persistent identity anchor");
  const primaryCharacterDescription = normalizeString(
    body.primaryCharacterDescription,
    "same recognizable person across different outfits, locations, camera angles, and lighting conditions",
  );
  const continuityRules = normalizeStringList(body.continuityRules, [
    "Preserve the same face, age, body structure, and core appearance markers across every output.",
    "Clothing, location, weather, lighting, and camera angle may vary without changing identity.",
    "Do not accept silent identity drift; continuity violations must remain visible in lineage.",
  ]);
  const initialSceneText = normalizeString(
    body.initialSceneText,
    `${primaryCharacterName} appears in a neutral baseline portrait for continuity anchoring before scene variation begins.`,
  );
  const resetReason = normalizeString(
    body.resetReason,
    "Operator started a fresh scenario while preserving archived lineage.",
  );

  return {
    title,
    worldName,
    location,
    tone,
    style,
    primaryCharacterName,
    primaryCharacterRole,
    primaryCharacterDescription,
    continuityRules,
    initialSceneText,
    resetReason,
  };
}

async function bootstrapScenario(body: Record<string, unknown>, resetExistingWorld: boolean) {
  const projectId = await ensureSeedRuntime();
  const supabase = getSupabaseAdmin().schema("solaceframe");
  const previousState = await loadRuntimeState(projectId);
  const scenario = normalizeScenarioInput(body);
  const now = new Date().toISOString();

  if (resetExistingWorld) {
    const archivedWorldState = {
      ...previousState.world.state,
      archived: true,
      archivedAt: now,
      archiveReason: scenario.resetReason,
      successorScenario: scenario.title,
    };

    const { error: archiveWorldError } = await supabase
      .from("worlds")
      .update({
        name: `${previousState.world.name} · archived`,
        state: archivedWorldState,
        pressure: Math.min(100, previousState.world.pressure + 4),
      })
      .eq("id", previousState.world.id);

    if (archiveWorldError) throw archiveWorldError;

    const { error: archiveBranchError } = await supabase
      .from("branches")
      .update({
        status: "archived",
        snapshot: {
          ...(previousState.activeBranch.snapshot ?? {}),
          archivedAt: now,
          archiveReason: scenario.resetReason,
          successorScenario: scenario.title,
        },
      })
      .eq("id", previousState.activeBranch.id);

    if (archiveBranchError) throw archiveBranchError;

    for (const character of previousState.characters) {
      const { error: archiveCharacterError } = await supabase
        .from("characters")
        .update({
          state: {
            ...character.state,
            archived: true,
            archivedAt: now,
            archiveReason: scenario.resetReason,
          },
          pressure: Math.min(100, character.pressure + 2),
        })
        .eq("id", character.id);

      if (archiveCharacterError) throw archiveCharacterError;
    }
  }

  const { data: branch, error: branchError } = await supabase
    .from("branches")
    .insert({
      project_id: projectId,
      parent_branch_id: resetExistingWorld ? previousState.activeBranch.id : null,
      name: scenario.title,
      divergence_score: 0,
      status: "active",
      snapshot: {
        bootstrappedAt: now,
        scenario,
        previousBranchId: resetExistingWorld ? previousState.activeBranch.id : null,
        previousWorldId: resetExistingWorld ? previousState.world.id : null,
      },
      fork_reason: resetExistingWorld
        ? scenario.resetReason
        : "Operator bootstrapped a new governed scenario.",
    })
    .select("*")
    .single();

  if (branchError) throw branchError;

  const { data: world, error: worldError } = await supabase
    .from("worlds")
    .insert({
      project_id: projectId,
      name: scenario.worldName,
      pressure: 8,
      state: {
        active: true,
        scenarioTitle: scenario.title,
        location: scenario.location,
        tone: scenario.tone,
        style: scenario.style,
        continuityRules: scenario.continuityRules,
        persistentObjects: [],
        unresolvedTensions: [],
        pressureTrend: "fresh-bootstrap",
        bootstrappedAt: now,
        previousWorldId: resetExistingWorld ? previousState.world.id : null,
      },
    })
    .select("*")
    .single();

  if (worldError) throw worldError;

  const { error: projectError } = await supabase
    .from("projects")
    .update({ active_branch_id: branch.id })
    .eq("id", projectId);

  if (projectError) throw projectError;

  const { data: character, error: characterError } = await supabase
    .from("characters")
    .insert({
      project_id: projectId,
      name: scenario.primaryCharacterName,
      role: scenario.primaryCharacterRole,
      appearance_anchor: {
        description: scenario.primaryCharacterDescription,
        visualLock: "pending-primary-anchor",
        identityContinuity: "same-person-preservation-required",
        allowedVariation: ["wardrobe", "location", "lighting", "weather", "camera angle", "emotional state"],
        lockedTraits: ["face", "age", "body structure", "hair identity", "core appearance markers"],
      },
      state: {
        active: true,
        scenarioTitle: scenario.title,
        continuityRules: scenario.continuityRules,
        emotionalState: "neutral baseline",
        carriedObjects: [],
        wardrobeState: "baseline-neutral",
      },
      continuity_score: 96,
      pressure: 6,
    })
    .select("*")
    .single();

  if (characterError) throw characterError;

  const analysis = analyzeScene(scenario.initialSceneText, world as RuntimeWorld, [character as RuntimeCharacter], [], []);

  const { data: scene, error: sceneError } = await supabase
    .from("scenes")
    .insert({
      project_id: projectId,
      branch_id: branch.id,
      title: analysis.title,
      scene_text: scenario.initialSceneText,
      admissibility: analysis.admissibility,
      drift_risk: analysis.driftRisk,
      compiled_packet: {
        ...analysis.packet,
        scenarioBootstrap: true,
        scenario,
        identityPreservation: {
          primaryCharacterId: character.id,
          primaryCharacterName: scenario.primaryCharacterName,
          status: "anchor-pending",
        },
      },
    })
    .select("*")
    .single();

  if (sceneError) throw sceneError;

  const { data: renderJob, error: renderError } = await supabase
    .from("render_jobs")
    .insert({
      project_id: projectId,
      scene_id: scene.id,
      branch_id: branch.id,
      status: analysis.admissibility === "blocked" ? "blocked" : "queued",
      model_route: "solaceframe-execution-router",
      prompt: buildCanonicalPrompt(scenario.initialSceneText, {
        ...analysis.packet,
        scenarioBootstrap: true,
        continuityRules: scenario.continuityRules,
      }),
      packet: {
        ...analysis.packet,
        scenarioBootstrap: true,
        scenario,
        primaryCharacter: character,
        world,
      },
      output_kind: "image",
      execution_mode: "manual",
      progress_status: "scenario-bootstrap-ready",
      progress_percent: 0,
    })
    .select("*")
    .single();

  if (renderError) throw renderError;

  const { error: lineageError } = await supabase.from("lineage_events").insert({
    project_id: projectId,
    scene_id: scene.id,
    render_job_id: renderJob.id,
    event_type: resetExistingWorld ? "world-reset-scenario-bootstrapped" : "scenario-bootstrapped",
    summary: resetExistingWorld
      ? `World reset and scenario bootstrapped: ${scenario.title}`
      : `Scenario bootstrapped: ${scenario.title}`,
    payload: {
      scenario,
      resetExistingWorld,
      previousWorldId: resetExistingWorld ? previousState.world.id : null,
      previousBranchId: resetExistingWorld ? previousState.activeBranch.id : null,
      worldId: world.id,
      branchId: branch.id,
      characterId: character.id,
      sceneId: scene.id,
      renderJobId: renderJob.id,
    },
  });

  if (lineageError) throw lineageError;

  const nextState = await loadRuntimeState(projectId);
  return NextResponse.json({ ok: true, scenario, state: nextState });
}

async function setContinuityAnchor(body: Record<string, unknown>) {
  const artifactId = String(body.artifactId || "").trim();
  const reason = normalizeString(
    body.reason,
    "Operator approved this artifact as the visual continuity anchor for future renders.",
  );

  if (!artifactId) {
    return NextResponse.json(
      { ok: false, error: "artifactId is required" },
      { status: 400 },
    );
  }

  const projectId = await ensureSeedRuntime();
  const supabase = getSupabaseAdmin().schema("solaceframe");
  const state = await loadRuntimeState(projectId);
  const artifact = state.artifacts.find((item: RuntimeArtifact) => item.id === artifactId);

  if (!artifact) {
    return NextResponse.json(
      { ok: false, error: "Artifact not found in active runtime" },
      { status: 404 },
    );
  }

  const metadata = artifact.metadata ?? {};
  const nextMetadata = {
    ...metadata,
    v19: {
      ...(typeof metadata.v19 === "object" && metadata.v19 !== null ? metadata.v19 : {}),
      continuityAnchor: true,
      continuityScore: 98,
      anchorLockedAt: new Date().toISOString(),
      reason,
    },
    v21: {
      scenarioAnchor: true,
      activeBranchId: state.activeBranch.id,
      activeWorldId: state.world.id,
    },
  };

  const { error: artifactError } = await supabase
    .from("artifacts")
    .update({ metadata: nextMetadata })
    .eq("id", artifact.id);

  if (artifactError) throw artifactError;

  if (state.characters[0]?.id) {
    const { error: characterError } = await supabase
      .from("characters")
      .update({
        appearance_anchor: {
          ...(state.characters[0]?.appearance_anchor ?? {}),
          primaryArtifactId: artifact.id,
          primaryArtifactUrl: artifact.public_url,
          visualLock: "active",
          lockedAt: new Date().toISOString(),
        },
        continuity_score: 98,
      })
      .eq("id", state.characters[0].id);

    if (characterError) throw characterError;
  }

  const { error: lineageError } = await supabase.from("lineage_events").insert({
    project_id: projectId,
    scene_id: artifact.scene_id,
    render_job_id: artifact.render_job_id,
    event_type: "continuity-anchor-set",
    summary: "Artifact promoted to visual continuity anchor.",
    payload: {
      artifactId: artifact.id,
      branchId: state.activeBranch.id,
      worldId: state.world.id,
      reason,
    },
  });

  if (lineageError) throw lineageError;

  const nextState = await loadRuntimeState(projectId);
  return NextResponse.json({ ok: true, artifactId: artifact.id, state: nextState });
}

async function forkBranch(body: Record<string, unknown>) {
  const projectId = await ensureSeedRuntime();
  const supabase = getSupabaseAdmin().schema("solaceframe");
  const state = await loadRuntimeState(projectId);
  const forkName = String(
    body.name || `Fork from ${state.activeBranch.name}`,
  ).trim();
  const forkReason = String(
    body.reason || "Operator-created governed branch fork",
  ).trim();

  const snapshot = {
    forkedAt: new Date().toISOString(),
    parentBranch: state.activeBranch,
    world: state.world,
    characters: state.characters,
    unresolvedContradictions: state.contradictions.filter(
      (item) => !item.resolved,
    ),
    causalEvents: state.causalEvents.slice(0, 40),
    admissibilityReport: state.admissibilityReport,
  };

  const { data: branch, error: branchError } = await supabase
    .from("branches")
    .insert({
      project_id: projectId,
      parent_branch_id: state.activeBranch.id,
      name: forkName,
      divergence_score: Math.min(100, state.activeBranch.divergence_score + 4),
      status: "active-fork",
      snapshot,
      fork_reason: forkReason,
    })
    .select("*")
    .single();

  if (branchError) throw branchError;

  const { error: projectError } = await supabase
    .from("projects")
    .update({ active_branch_id: branch.id })
    .eq("id", projectId);

  if (projectError) throw projectError;

  const { error: lineageError } = await supabase.from("lineage_events").insert({
    project_id: projectId,
    event_type: "branch-forked",
    summary: `Branch forked from ${state.activeBranch.name}: ${forkName}`,
    payload: {
      parentBranchId: state.activeBranch.id,
      childBranchId: branch.id,
      forkReason,
      snapshot,
    },
  });

  if (lineageError) throw lineageError;

  const nextState = await loadRuntimeState(projectId);
  return NextResponse.json({ ok: true, branch, state: nextState });
}

async function resolveContradiction(body: Record<string, unknown>) {
  const contradictionId = String(body.contradictionId || "").trim();
  const repairNote = String(
    body.repairNote || "Contradiction resolved through governed repair review.",
  ).trim();

  if (!contradictionId) {
    return NextResponse.json(
      { ok: false, error: "contradictionId is required" },
      { status: 400 },
    );
  }

  const projectId = await ensureSeedRuntime();
  const supabase = getSupabaseAdmin().schema("solaceframe");
  const state = await loadRuntimeState(projectId);

  const contradiction = state.contradictions.find(
    (item) => item.id === contradictionId,
  );

  if (!contradiction) {
    return NextResponse.json(
      { ok: false, error: "Contradiction not found in active runtime" },
      { status: 404 },
    );
  }

  const { data: repairEvent, error: repairError } = await supabase
    .from("causal_events")
    .insert({
      project_id: projectId,
      branch_id: contradiction.branch_id ?? state.activeBranch.id,
      scene_id: contradiction.scene_id,
      event_key: `repair:${contradiction.id}`,
      event_type: "contradiction-repaired",
      subject: contradiction.contradiction_type,
      predicate: "resolved-by-governed-repair",
      object_ref: contradiction.id,
      severity: 1,
      reversibility: "reversible",
      repaired: true,
      payload: {
        contradictionId: contradiction.id,
        summary: contradiction.summary,
        repairNote,
      },
    })
    .select("*")
    .single();

  if (repairError) throw repairError;

  const { error: contradictionError } = await supabase
    .from("contradictions")
    .update({
      resolved: true,
      resolved_at: new Date().toISOString(),
      repair_causal_event_id: repairEvent.id,
      repair_note: repairNote,
      payload: {
        ...contradiction.payload,
        repairNote,
        repairCausalEventId: repairEvent.id,
      },
    })
    .eq("id", contradiction.id);

  if (contradictionError) throw contradictionError;

  const nextPressure = Math.max(0, state.world.pressure - 6);
  const currentRepairs = Array.isArray(state.world.state.repairs)
    ? state.world.state.repairs
    : [];

  const { error: worldError } = await supabase
    .from("worlds")
    .update({
      pressure: nextPressure,
      state: {
        ...state.world.state,
        pressureTrend: "repairing",
        repairs: [
          ...currentRepairs,
          {
            at: new Date().toISOString(),
            contradictionId: contradiction.id,
            repairEventId: repairEvent.id,
            repairNote,
          },
        ],
      },
    })
    .eq("id", state.world.id);

  if (worldError) throw worldError;

  const { error: lineageError } = await supabase.from("lineage_events").insert({
    project_id: projectId,
    scene_id: contradiction.scene_id,
    event_type: "contradiction-resolved",
    summary: `Contradiction resolved: ${contradiction.summary}`,
    payload: {
      contradictionId: contradiction.id,
      repairEventId: repairEvent.id,
      repairNote,
    },
  });

  if (lineageError) throw lineageError;

  const nextState = await loadRuntimeState(projectId);
  return NextResponse.json({ ok: true, repairEvent, state: nextState });
}

async function loadRuntimeState(projectId: string) {
  const supabase = getSupabaseAdmin().schema("solaceframe");

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();

  if (projectError) throw projectError;
  if (!project) throw new Error("Runtime project not found after seed.");

  const { data: world, error: worldError } = await supabase
    .from("worlds")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (worldError) throw worldError;
  if (!world) throw new Error("Runtime world missing after seed.");

  let activeBranchId = project.active_branch_id as string | null;

  if (!activeBranchId) {
    const { data: fallbackBranch, error: fallbackBranchError } = await supabase
      .from("branches")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (fallbackBranchError) throw fallbackBranchError;
    if (!fallbackBranch) throw new Error("Runtime branch missing after seed.");

    activeBranchId = fallbackBranch.id as string;

    const { error: projectBranchUpdateError } = await supabase
      .from("projects")
      .update({ active_branch_id: activeBranchId })
      .eq("id", projectId);

    if (projectBranchUpdateError) throw projectBranchUpdateError;
  }

  const { data: activeBranch, error: branchError } = await supabase
    .from("branches")
    .select("*")
    .eq("id", activeBranchId)
    .maybeSingle();

  if (branchError) throw branchError;
  if (!activeBranch) throw new Error("Active branch not found.");

  const [
    branchesResult,
    charactersResult,
    scenesResult,
    renderJobsResult,
    artifactsResult,
    lineageEventsResult,
    continuityDiffsResult,
    causalEventsResult,
    contradictionsResult,
  ] = await Promise.all([
    supabase
      .from("branches")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true }),
    supabase
      .from("characters")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true }),
    supabase
      .from("scenes")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("render_jobs")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("artifacts")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("lineage_events")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("continuity_diffs")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("causal_events")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(40),
    supabase
      .from("contradictions")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(40),
  ]);

  if (branchesResult.error) throw branchesResult.error;
  if (charactersResult.error) throw charactersResult.error;
  if (scenesResult.error) throw scenesResult.error;
  if (renderJobsResult.error) throw renderJobsResult.error;
  if (artifactsResult.error) throw artifactsResult.error;
  if (lineageEventsResult.error) throw lineageEventsResult.error;
  if (continuityDiffsResult.error) throw continuityDiffsResult.error;
  if (causalEventsResult.error) throw causalEventsResult.error;
  if (contradictionsResult.error) throw contradictionsResult.error;

  const causalEvents = (causalEventsResult.data ?? []) as RuntimeCausalEvent[];
  const contradictions = (contradictionsResult.data ??
    []) as RuntimeContradiction[];
  const admissibilityReport = evaluateRuntimeAdmissibility({
    world: world as RuntimeWorld,
    activeBranch,
    causalEvents,
    contradictions,
  });

  const activeBranchIdForState = activeBranch.id as string;
  const activeCharacters = ((charactersResult.data ?? []) as RuntimeCharacter[]).filter(
    (character) => (character.state as Record<string, unknown>).archived !== true,
  );
  const activeScenes = ((scenesResult.data ?? []) as RuntimeScene[]).filter(
    (scene: RuntimeScene) => scene.branch_id === activeBranchIdForState,
  );
  const activeRenderJobs = ((renderJobsResult.data ?? []) as RuntimeRenderJob[]).filter(
    (job: RuntimeRenderJob) => job.branch_id === activeBranchIdForState,
  );
  const activeArtifacts = ((artifactsResult.data ?? []) as RuntimeArtifact[]).filter(
    (artifact: RuntimeArtifact) => artifact.branch_id === activeBranchIdForState,
  );
  const activeContinuityDiffs = ((continuityDiffsResult.data ?? []) as RuntimeContinuityDiff[]).filter((diff: RuntimeContinuityDiff) => {
    if (!diff.scene_id) return true;
    return activeScenes.some((scene: RuntimeScene) => scene.id === diff.scene_id);
  });
  const activeCausalEvents = causalEvents.filter(
    (event) => !event.branch_id || event.branch_id === activeBranchIdForState,
  );
  const activeContradictions = contradictions.filter(
    (item) => !item.branch_id || item.branch_id === activeBranchIdForState,
  );

  return {
    project,
    world,
    activeBranch,
    branches: branchesResult.data ?? [],
    characters: activeCharacters,
    scenes: activeScenes,
    renderJobs: activeRenderJobs,
    artifacts: activeArtifacts,
    lineageEvents: lineageEventsResult.data ?? [],
    continuityDiffs: activeContinuityDiffs,
    causalEvents: activeCausalEvents,
    contradictions: activeContradictions,
    admissibilityReport,
  };
}

function buildCanonicalPrompt(
  sceneText: string,
  packet: Record<string, unknown>,
) {
  const compactPacket = {
    mode: typeof packet.mode === "string" ? packet.mode : undefined,
    driftRisk: typeof packet.driftRisk === "string" ? packet.driftRisk : undefined,
    admissibility:
      typeof packet.admissibility === "string" ? packet.admissibility : undefined,
    preserve: Array.isArray(packet.preserve) ? packet.preserve.slice(0, 8) : [],
    mutated: Array.isArray(packet.mutated) ? packet.mutated.slice(0, 8) : [],
    violations: Array.isArray(packet.violations) ? packet.violations.slice(0, 8) : [],
    renderConstraints: Array.isArray(packet.renderConstraints)
      ? packet.renderConstraints.slice(0, 10)
      : [],
    causalEvents: Array.isArray(packet.causalEvents)
      ? packet.causalEvents.slice(0, 10)
      : [],
    continuityResolution: isRecord(packet.continuityResolution)
      ? {
          version: packet.continuityResolution.version,
          sceneCharacterNames: packet.continuityResolution.sceneCharacterNames,
          activeFacts: packet.continuityResolution.activeFacts,
          dormantFactCount: packet.continuityResolution.dormantFactCount,
          blockedFactCount: packet.continuityResolution.blockedFactCount,
          redundantFactCount: packet.continuityResolution.redundantFactCount,
          suppressedConstraints: packet.continuityResolution.suppressedConstraints,
        }
      : undefined,
    v26: summarizeV26Packet(packet.v26),
  };

  return [
    "Governed synthetic media render.",
    `Scene: ${sceneText}`,
    "The render must obey V25 scene-local continuity resolution: active facts are visual instructions; dormant facts are retained memory, not render pressure.",
    "The render must obey V26 spatial reality resolution: active spatial/object/body anchors are local constraints; dormant anchors are retained canonical truth, not visual pressure.",
    `Compact packet: ${JSON.stringify(compactPacket)}`,
  ].join("\n");
}


function summarizeV26Packet(value: unknown) {
  if (!isRecord(value)) return undefined;
  const spatialRealityRuntime = isRecord(value.spatialRealityRuntime)
    ? value.spatialRealityRuntime
    : undefined;

  if (!spatialRealityRuntime) return undefined;

  return {
    spatialRealityRuntime: {
      version: spatialRealityRuntime.version,
      sceneLocation: spatialRealityRuntime.sceneLocation,
      admissibility: spatialRealityRuntime.admissibility,
      spatialPressure: spatialRealityRuntime.spatialPressure,
      activeAnchors: Array.isArray(spatialRealityRuntime.activeAnchors)
        ? spatialRealityRuntime.activeAnchors.slice(0, 8)
        : [],
      dormantAnchorCount: Array.isArray(spatialRealityRuntime.dormantAnchors)
        ? spatialRealityRuntime.dormantAnchors.length
        : 0,
      suppressedAnchorCount: Array.isArray(spatialRealityRuntime.suppressedAnchors)
        ? spatialRealityRuntime.suppressedAnchors.length
        : 0,
      spatialRenderConstraints: Array.isArray(spatialRealityRuntime.spatialRenderConstraints)
        ? spatialRealityRuntime.spatialRenderConstraints.slice(0, 8)
        : [],
      memoryCompaction: spatialRealityRuntime.memoryCompaction,
    },
  };
}
