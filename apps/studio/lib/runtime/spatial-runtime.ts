import type { SceneAnalysis } from "./engine";
import type { ContinuityResolution, ResolvedContinuityFact } from "./continuity-resolver";
import type { RuntimeState } from "./types";

export type SpatialAdmissibility = "stable" | "bounded" | "degraded";

export type V26SpatialAnchor = {
  key: string;
  label: string;
  kind: "location" | "object" | "environment" | "body";
  status: "active" | "dormant" | "suppressed";
  reason: string;
  canonicalLocation?: string | null;
  owner?: string | null;
  orientation?: string | null;
  materialState?: string | null;
  pressure: number;
};

export type V26SpatialResolution = {
  version: "v26-spatial-reality-runtime";
  sceneLocation: string | null;
  admissibility: SpatialAdmissibility;
  spatialPressure: number;
  activeAnchors: V26SpatialAnchor[];
  dormantAnchors: V26SpatialAnchor[];
  suppressedAnchors: V26SpatialAnchor[];
  spatialRenderConstraints: string[];
  memoryCompaction: {
    activeAnchorCount: number;
    dormantAnchorCount: number;
    suppressedAnchorCount: number;
    retainedGlobalFactCount: number;
  };
  nextSpatialState: Record<string, unknown>;
  nextObjectState: Record<string, unknown>;
  notes: string[];
};

const MAX_ACTIVE_ANCHORS = 12;
const MAX_DORMANT_ANCHORS = 16;
const MAX_SPATIAL_CONSTRAINTS = 12;

export function resolveSpatialRealityForScene(input: {
  sceneText: string;
  state: RuntimeState;
  analysis: SceneAnalysis;
  continuityResolution: ContinuityResolution;
}): V26SpatialResolution {
  const sceneLower = input.sceneText.toLowerCase();
  const currentSpatialState = asRecord(input.state.world.spatial_state);
  const currentObjectState = asRecord(input.state.world.object_state);
  const sceneLocation = resolveSceneLocation(sceneLower, currentSpatialState, input.state.world.name);

  const canonicalAnchors = compactAnchors([
    ...anchorsFromWorldState(input.state.world.state, currentSpatialState, currentObjectState),
    ...anchorsFromContinuityFacts(input.continuityResolution.activeFacts, "active"),
    ...anchorsFromContinuityFacts(input.continuityResolution.dormantFacts, "dormant"),
    ...anchorsFromCharacters(input.state.characters),
    ...anchorsFromAnalysis(input.analysis, sceneLocation),
  ]);

  const classifiedAnchors = canonicalAnchors.map((anchor) => classifyAnchor(anchor, sceneLower, sceneLocation));
  const activeAnchors = classifiedAnchors
    .filter((anchor) => anchor.status === "active")
    .sort(sortByPressure)
    .slice(0, MAX_ACTIVE_ANCHORS);
  const dormantAnchors = classifiedAnchors
    .filter((anchor) => anchor.status === "dormant")
    .sort(sortByPressure)
    .slice(0, MAX_DORMANT_ANCHORS);
  const suppressedAnchors = classifiedAnchors.filter((anchor) => anchor.status === "suppressed").sort(sortByPressure);

  const spatialPressure = computeSpatialPressure({
    sceneLocation,
    activeAnchors,
    dormantAnchors,
    suppressedAnchors,
    continuityResolution: input.continuityResolution,
  });

  const admissibility: SpatialAdmissibility =
    spatialPressure >= 76 ? "degraded" : spatialPressure >= 42 ? "bounded" : "stable";

  const spatialRenderConstraints = buildSpatialRenderConstraints(activeAnchors, sceneLocation, admissibility).slice(
    0,
    MAX_SPATIAL_CONSTRAINTS,
  );

  const nextSpatialState = buildNextSpatialState({
    currentSpatialState,
    sceneLocation,
    activeAnchors,
    dormantAnchors,
    spatialPressure,
    admissibility,
    analysis: input.analysis,
  });

  const nextObjectState = buildNextObjectState({
    currentObjectState,
    activeAnchors,
    dormantAnchors,
    suppressedAnchors,
  });

  const notes = [
    "V26 resolved spatial and object anchors after continuity adjudication but before prompt assembly.",
    "Supabase remains continuity authority storage; heavy media analysis should remain outside hot runtime state.",
  ];

  if (suppressedAnchors.length > 0) {
    notes.push("Suppressed anchors remain canonical but were not emitted because they were not local to the scene.");
  }

  if (admissibility === "degraded") {
    notes.push("Spatial pressure is high; render should preserve active anchors and avoid inventing room/object topology.");
  }

  return {
    version: "v26-spatial-reality-runtime",
    sceneLocation,
    admissibility,
    spatialPressure,
    activeAnchors,
    dormantAnchors,
    suppressedAnchors,
    spatialRenderConstraints,
    memoryCompaction: {
      activeAnchorCount: activeAnchors.length,
      dormantAnchorCount: dormantAnchors.length,
      suppressedAnchorCount: suppressedAnchors.length,
      retainedGlobalFactCount:
        input.continuityResolution.activeFacts.length + input.continuityResolution.dormantFacts.length,
    },
    nextSpatialState,
    nextObjectState,
    notes,
  };
}

export function buildV26ResolvedPacket(input: {
  packet: Record<string, unknown>;
  spatialResolution: V26SpatialResolution;
}) {
  return {
    ...input.packet,
    v26: {
      spatialRealityRuntime: input.spatialResolution,
    },
    renderConstraints: compactStrings([
      ...toStringArray(input.packet.renderConstraints),
      ...input.spatialResolution.spatialRenderConstraints,
    ]).slice(0, MAX_SPATIAL_CONSTRAINTS),
  };
}

function anchorsFromWorldState(
  worldState: Record<string, unknown>,
  spatialState: Record<string, unknown>,
  objectState: Record<string, unknown>,
): V26SpatialAnchor[] {
  const anchors: V26SpatialAnchor[] = [];

  for (const location of toStringArray(worldState.damagedLocations)) {
    anchors.push({
      key: `location:${normalizeKey(location)}`,
      label: location,
      kind: "location",
      status: "dormant",
      reason: "canonical damaged location from world state",
      canonicalLocation: location,
      materialState: "damaged",
      pressure: 58,
    });
  }

  for (const object of toStringArray(worldState.persistentObjects)) {
    anchors.push({
      key: `object:${normalizeKey(object)}`,
      label: object,
      kind: "object",
      status: "dormant",
      reason: "persistent object from world state",
      canonicalLocation: readObjectLocation(objectState, object),
      owner: readObjectOwner(objectState, object),
      materialState: readObjectMaterialState(objectState, object),
      pressure: 46,
    });
  }

  const knownRooms = asRecord(spatialState.rooms);
  for (const [roomKey, value] of Object.entries(knownRooms)) {
    const room = asRecord(value);
    anchors.push({
      key: `location:${normalizeKey(roomKey)}`,
      label: typeof room.label === "string" ? room.label : roomKey,
      kind: "location",
      status: "dormant",
      reason: "known room topology retained in spatial state",
      canonicalLocation: roomKey,
      materialState: typeof room.materialState === "string" ? room.materialState : null,
      pressure: numberOr(room.pressure, 32),
    });
  }

  return anchors;
}

function anchorsFromContinuityFacts(
  facts: ResolvedContinuityFact[],
  defaultStatus: V26SpatialAnchor["status"],
): V26SpatialAnchor[] {
  return facts
    .filter((fact) => ["object", "location", "environment", "identity"].includes(fact.scope))
    .map((fact) => ({
      key: `${fact.scope}:${normalizeKey(fact.subject)}:${normalizeKey(fact.objectRef || fact.predicate)}`,
      label: fact.subject,
      kind: fact.scope === "identity" ? "body" : fact.scope === "object" ? "object" : fact.scope === "location" ? "location" : "environment",
      status: defaultStatus,
      reason: fact.reason,
      canonicalLocation: fact.scope === "location" ? fact.subject : null,
      owner: fact.scope === "object" ? fact.objectRef : null,
      materialState: fact.predicate,
      pressure: fact.severity * 9,
    }));
}

function anchorsFromCharacters(characters: RuntimeState["characters"]): V26SpatialAnchor[] {
  const anchors: V26SpatialAnchor[] = [];

  for (const character of characters) {
    const anatomicalState = asRecord(character.anatomical_state);
    const bodyMarks = [
      ...toStringArray(anatomicalState.scars),
      ...toStringArray(anatomicalState.tattoos),
      ...toStringArray(anatomicalState.bandages),
      ...toStringArray(anatomicalState.wounds),
    ];

    for (const mark of bodyMarks) {
      anchors.push({
        key: `body:${normalizeKey(character.name)}:${normalizeKey(mark)}`,
        label: `${character.name} ${mark}`,
        kind: "body",
        status: "dormant",
        reason: "anatomical persistence from character state",
        owner: character.name,
        materialState: mark,
        pressure: 54,
      });
    }

    for (const object of toStringArray(character.state?.carriedObjects)) {
      anchors.push({
        key: `object:${normalizeKey(object)}`,
        label: object,
        kind: "object",
        status: "dormant",
        reason: "object carried by character state",
        owner: character.name,
        pressure: 44,
      });
    }
  }

  return anchors;
}

function anchorsFromAnalysis(analysis: SceneAnalysis, sceneLocation: string | null): V26SpatialAnchor[] {
  const anchors: V26SpatialAnchor[] = [];

  for (const event of analysis.causalEvents) {
    if (["object-persistent", "object-carried"].includes(event.event_type)) {
      anchors.push({
        key: `object:${normalizeKey(event.subject)}`,
        label: event.subject,
        kind: "object",
        status: "active",
        reason: "current scene establishes or references object persistence",
        canonicalLocation: sceneLocation,
        owner: event.object_ref,
        materialState: event.predicate,
        pressure: event.severity * 10,
      });
    }

    if (["location-damaged", "environment-pressure"].includes(event.event_type)) {
      anchors.push({
        key: `${event.event_type === "location-damaged" ? "location" : "environment"}:${normalizeKey(event.subject)}`,
        label: event.subject,
        kind: event.event_type === "location-damaged" ? "location" : "environment",
        status: "active",
        reason: "current scene mutates location or environmental state",
        canonicalLocation: sceneLocation ?? event.subject,
        materialState: event.predicate,
        pressure: event.severity * 10,
      });
    }
  }

  return anchors;
}

function classifyAnchor(anchor: V26SpatialAnchor, sceneLower: string, sceneLocation: string | null): V26SpatialAnchor {
  const labelLower = anchor.label.toLowerCase();
  const locationLower = sceneLocation?.toLowerCase() ?? "";
  const ownerLower = anchor.owner?.toLowerCase() ?? "";
  const explicitlyMentioned = sceneLower.includes(labelLower) || Boolean(ownerLower && sceneLower.includes(ownerLower));
  const locationMatched = Boolean(
    anchor.canonicalLocation &&
      (sceneLower.includes(anchor.canonicalLocation.toLowerCase()) ||
        anchor.canonicalLocation.toLowerCase() === locationLower),
  );

  if (anchor.status === "active" || explicitlyMentioned || locationMatched) {
    return {
      ...anchor,
      status: "active",
      reason: anchor.status === "active" ? anchor.reason : "anchor is local to this scene",
    };
  }

  if (anchor.kind === "body" && /scar|tattoo|bandage|wound|injury|body|skin|arm|shoulder|face/.test(sceneLower)) {
    return {
      ...anchor,
      status: "active",
      reason: "anatomical state is visually relevant to the current scene",
    };
  }

  if (anchor.kind === "object" && /carry|hold|bag|case|prop|object|weapon|phone|box/.test(sceneLower)) {
    return {
      ...anchor,
      status: "active",
      reason: "object permanence is explicitly relevant to the current scene",
    };
  }

  if (anchor.kind === "environment" && /rain|storm|smoke|wet|mud|snow|fire|heat|cold|shower|steam/.test(sceneLower)) {
    return {
      ...anchor,
      status: "active",
      reason: "environmental residue is local to the scene conditions",
    };
  }

  if (anchor.kind === "location" && /room|apartment|bathroom|street|bridge|lobby|hospital|building|site/.test(sceneLower)) {
    return {
      ...anchor,
      status: "suppressed",
      reason: "a different spatial setting is present; prior location remains canonical but inactive",
    };
  }

  return {
    ...anchor,
    status: "dormant",
    reason: "anchor retained globally but not local enough to render",
  };
}

function buildSpatialRenderConstraints(
  activeAnchors: V26SpatialAnchor[],
  sceneLocation: string | null,
  admissibility: SpatialAdmissibility,
) {
  const constraints: string[] = [];

  if (sceneLocation) {
    constraints.push(`Scene-local spatial frame: ${sceneLocation}. Do not import unrelated room or location topology.`);
  }

  for (const anchor of activeAnchors) {
    if (anchor.kind === "location") {
      constraints.push(`${anchor.label} spatial/material state is active: ${anchor.materialState || "canonical state"}.`);
    }
    if (anchor.kind === "object") {
      constraints.push(`${anchor.label} object continuity is active only if present, carried, placed, hidden, or referenced in this scene.`);
    }
    if (anchor.kind === "environment") {
      constraints.push(`${anchor.label} environmental residue is active: ${anchor.materialState || "current environmental pressure"}.`);
    }
    if (anchor.kind === "body") {
      constraints.push(`${anchor.label} anatomical persistence must remain fixed to the same body location if visible.`);
    }
  }

  if (admissibility !== "stable") {
    constraints.push("Spatial continuity is bounded: avoid inventing new object positions that contradict active anchors.");
  }

  return compactStrings(constraints);
}

function buildNextSpatialState(input: {
  currentSpatialState: Record<string, unknown>;
  sceneLocation: string | null;
  activeAnchors: V26SpatialAnchor[];
  dormantAnchors: V26SpatialAnchor[];
  spatialPressure: number;
  admissibility: SpatialAdmissibility;
  analysis: SceneAnalysis;
}) {
  const rooms = asRecord(input.currentSpatialState.rooms);
  const activeLocations = input.activeAnchors.filter((anchor) => anchor.kind === "location");

  for (const anchor of activeLocations) {
    const key = normalizeKey(anchor.canonicalLocation || anchor.label);
    rooms[key] = {
      ...(asRecord(rooms[key])),
      label: anchor.label,
      materialState: anchor.materialState || asRecord(rooms[key]).materialState || "canonical",
      pressure: Math.max(numberOr(asRecord(rooms[key]).pressure, 0), anchor.pressure),
      lastActiveAt: new Date().toISOString(),
    };
  }

  return {
    ...input.currentSpatialState,
    version: "v26-spatial-reality-runtime",
    activeSceneLocation: input.sceneLocation,
    pressure: input.spatialPressure,
    admissibility: input.admissibility,
    rooms,
    lastScene: {
      title: input.analysis.title,
      at: new Date().toISOString(),
      activeAnchorKeys: input.activeAnchors.map((anchor) => anchor.key),
      dormantAnchorKeys: input.dormantAnchors.map((anchor) => anchor.key),
    },
  };
}

function buildNextObjectState(input: {
  currentObjectState: Record<string, unknown>;
  activeAnchors: V26SpatialAnchor[];
  dormantAnchors: V26SpatialAnchor[];
  suppressedAnchors: V26SpatialAnchor[];
}) {
  const objects = asRecord(input.currentObjectState.objects);

  for (const anchor of [...input.activeAnchors, ...input.dormantAnchors, ...input.suppressedAnchors]) {
    if (anchor.kind !== "object") continue;
    const key = normalizeKey(anchor.label);
    const existing = asRecord(objects[key]);
    objects[key] = {
      ...existing,
      label: anchor.label,
      owner: anchor.owner ?? existing.owner ?? null,
      canonicalLocation: anchor.canonicalLocation ?? existing.canonicalLocation ?? null,
      materialState: anchor.materialState ?? existing.materialState ?? null,
      status: anchor.status,
      pressure: Math.max(numberOr(existing.pressure, 0), anchor.pressure),
      lastResolvedAt: new Date().toISOString(),
    };
  }

  return {
    ...input.currentObjectState,
    version: "v26-spatial-reality-runtime",
    objects,
  };
}

function computeSpatialPressure(input: {
  sceneLocation: string | null;
  activeAnchors: V26SpatialAnchor[];
  dormantAnchors: V26SpatialAnchor[];
  suppressedAnchors: V26SpatialAnchor[];
  continuityResolution: ContinuityResolution;
}) {
  const activeLoad = input.activeAnchors.reduce((sum, anchor) => sum + anchor.pressure, 0) / 14;
  const suppressedLoad = input.suppressedAnchors.length * 5;
  const blockedLoad = input.continuityResolution.blockedFactCount * 6;
  const locationUncertainty = input.sceneLocation ? 0 : 8;
  return clampScore(activeLoad + suppressedLoad + blockedLoad + locationUncertainty, 0, 100);
}

function resolveSceneLocation(sceneLower: string, spatialState: Record<string, unknown>, fallbackWorldName: string) {
  const locationCandidates = [
    "apartment mirror",
    "apartment bedroom",
    "bedroom",
    "bathroom",
    "shower",
    "city sidewalk",
    "boutique hotel lobby",
    "street",
    "eastern bridge",
    "hospital",
    "warehouse",
    "studio",
  ];

  for (const candidate of locationCandidates) {
    if (sceneLower.includes(candidate)) return candidate;
  }

  const rooms = Object.keys(asRecord(spatialState.rooms));
  for (const room of rooms) {
    if (sceneLower.includes(room.replace(/-/g, " "))) return room;
  }

  if (/outside|exterior|rain|storm|street/.test(sceneLower)) return fallbackWorldName;
  if (/inside|interior|room/.test(sceneLower)) return "interior room";

  return null;
}

function readObjectLocation(objectState: Record<string, unknown>, label: string) {
  const object = asRecord(asRecord(objectState.objects)[normalizeKey(label)]);
  return typeof object.canonicalLocation === "string" ? object.canonicalLocation : null;
}

function readObjectOwner(objectState: Record<string, unknown>, label: string) {
  const object = asRecord(asRecord(objectState.objects)[normalizeKey(label)]);
  return typeof object.owner === "string" ? object.owner : null;
}

function readObjectMaterialState(objectState: Record<string, unknown>, label: string) {
  const object = asRecord(asRecord(objectState.objects)[normalizeKey(label)]);
  return typeof object.materialState === "string" ? object.materialState : null;
}

function compactAnchors(anchors: V26SpatialAnchor[]) {
  const map = new Map<string, V26SpatialAnchor>();

  for (const anchor of anchors) {
    const existing = map.get(anchor.key);
    if (!existing || anchor.status === "active" || anchor.pressure > existing.pressure) {
      map.set(anchor.key, anchor);
    }
  }

  return Array.from(map.values());
}

function sortByPressure(a: V26SpatialAnchor, b: V26SpatialAnchor) {
  return b.pressure - a.pressure;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
}

function compactStrings(values: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const cleaned = value.trim().replace(/\s+/g, " ");
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    output.push(cleaned);
  }

  return output;
}

function normalizeKey(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function numberOr(value: unknown, fallback: number) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function clampScore(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}
