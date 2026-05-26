import type {
  RuntimeCausalEvent,
  RuntimeCharacter,
  RuntimeContradiction,
  RuntimeState,
} from "./types";

type SceneAnalysisLike = {
  packet: Record<string, unknown>;
  renderConstraints: string[];
  causalEvents: Array<{
    event_type: string;
    subject: string;
    predicate: string;
    object_ref: string | null;
    severity: number;
  }>;
  preserve: string[];
  mutated: string[];
  violations: string[];
  admissibility: string;
  driftRisk: string;
};

export type ContinuityFactStatus = "active" | "dormant" | "blocked";
export type ContinuityFactScope = "identity" | "object" | "location" | "environment" | "relationship" | "other";

export type ResolvedContinuityFact = {
  key: string;
  subject: string;
  predicate: string;
  objectRef: string | null;
  eventType: string;
  severity: number;
  status: ContinuityFactStatus;
  scope: ContinuityFactScope;
  reason: string;
  source: "prior" | "current" | "world" | "character";
};

export type ContinuityResolution = {
  version: "v25-continuity-resolution";
  sceneCharacterNames: string[];
  activeFacts: ResolvedContinuityFact[];
  dormantFacts: ResolvedContinuityFact[];
  blockedFacts: ResolvedContinuityFact[];
  resolvedRenderConstraints: string[];
  suppressedConstraints: string[];
  redundantFactCount: number;
  dormantFactCount: number;
  blockedFactCount: number;
  notes: string[];
};

const MAX_ACTIVE_FACTS = 10;
const MAX_DORMANT_FACTS = 12;
const MAX_RENDER_CONSTRAINTS = 10;

export function resolveContinuityForScene(input: {
  sceneText: string;
  state: RuntimeState;
  analysis: SceneAnalysisLike;
}): ContinuityResolution {
  const sceneText = input.sceneText;
  const state = input.state;
  const analysis = input.analysis;
  const sceneLower = sceneText.toLowerCase();
  const activeCharacterNames = resolveSceneCharacters(sceneLower, state.characters);
  const mentionedCharacterKeys = new Set(activeCharacterNames.map(normalizeKeyPart));
  const currentFacts = analysis.causalEvents.map((event) =>
    normalizeFact({
      subject: event.subject,
      predicate: event.predicate,
      objectRef: event.object_ref,
      eventType: event.event_type,
      severity: event.severity,
      source: "current",
    }),
  );
  const priorFacts = state.causalEvents.map((event: RuntimeCausalEvent) =>
    normalizeFact({
      subject: event.subject,
      predicate: event.predicate,
      objectRef: event.object_ref,
      eventType: event.event_type,
      severity: event.severity,
      source: "prior",
    }),
  );
  const worldFacts = extractWorldFacts(state).map((fact) => normalizeFact(fact));
  const characterFacts = extractCharacterFacts(state.characters).map((fact) => normalizeFact(fact));
  const allFacts = [...currentFacts, ...priorFacts, ...worldFacts, ...characterFacts];
  const compacted = compactFacts(allFacts);
  const resolved = compacted.map((fact) => classifyFact(fact, sceneLower, mentionedCharacterKeys));
  const activeFacts = resolved.filter((fact) => fact.status === "active").slice(0, MAX_ACTIVE_FACTS);
  const dormantFacts = resolved.filter((fact) => fact.status === "dormant").slice(0, MAX_DORMANT_FACTS);
  const blockedFacts = resolved.filter((fact) => fact.status === "blocked");
  const currentConstraints = normalizeConstraintList([
    ...analysis.renderConstraints,
    ...(Array.isArray(analysis.packet.renderConstraints)
      ? analysis.packet.renderConstraints.map((item) => String(item))
      : []),
  ]);
  const constraintResolution = resolveRenderConstraints(currentConstraints, activeFacts, dormantFacts, blockedFacts, sceneLower);
  const unresolvedContradictions = state.contradictions.filter((item: RuntimeContradiction) => !item.resolved).length;
  const notes = [
    "V25 resolved canonical memory before render-packet construction.",
    "Dormant facts remain true globally but are not emitted as visual instructions unless scene-relevant.",
  ];

  if (unresolvedContradictions > 0) {
    notes.push(`${unresolvedContradictions} unresolved contradiction(s) remain visible for governance review.`);
  }

  if (blockedFacts.length > 0) {
    notes.push("Blocked facts were suppressed because they conflict with the current scene identity or location scope.");
  }

  return {
    version: "v25-continuity-resolution",
    sceneCharacterNames: activeCharacterNames,
    activeFacts,
    dormantFacts,
    blockedFacts,
    resolvedRenderConstraints: constraintResolution.resolved.slice(0, MAX_RENDER_CONSTRAINTS),
    suppressedConstraints: constraintResolution.suppressed,
    redundantFactCount: allFacts.length - compacted.length,
    dormantFactCount: dormantFacts.length,
    blockedFactCount: blockedFacts.length,
    notes,
  };
}

export function buildResolvedPacket(
  packet: Record<string, unknown>,
  resolution: ContinuityResolution,
) {
  return {
    ...packet,
    continuityResolution: resolution,
    renderConstraints: resolution.resolvedRenderConstraints,
    priorCausalEvents: resolution.activeFacts.map((fact) => ({
      subject: fact.subject,
      predicate: fact.predicate,
      objectRef: fact.objectRef,
      eventType: fact.eventType,
      severity: fact.severity,
      scope: fact.scope,
      status: fact.status,
    })),
    dormantContinuityFacts: resolution.dormantFacts.map((fact) => ({
      subject: fact.subject,
      predicate: fact.predicate,
      objectRef: fact.objectRef,
      eventType: fact.eventType,
      scope: fact.scope,
    })),
  };
}

function resolveSceneCharacters(sceneLower: string, characters: RuntimeCharacter[]) {
  const activeCharacters = characters.filter((character) => character.state.archived !== true);
  const explicitlyMentioned = activeCharacters.filter((character) =>
    sceneLower.includes(character.name.toLowerCase()),
  );

  if (explicitlyMentioned.length > 0) {
    return explicitlyMentioned.map((character) => character.name);
  }

  if (activeCharacters.length === 1) {
    return [activeCharacters[0].name];
  }

  return [];
}

function normalizeFact(input: {
  subject: string;
  predicate: string;
  objectRef: string | null;
  eventType: string;
  severity: number;
  source: ResolvedContinuityFact["source"];
}): ResolvedContinuityFact {
  const subject = String(input.subject || "unknown").trim();
  const predicate = String(input.predicate || "persists").trim();
  const objectRef = input.objectRef ? String(input.objectRef).trim() : null;
  const eventType = String(input.eventType || "continuity-fact").trim();
  const key = [subject, predicate, objectRef || "none", eventType]
    .map(normalizeKeyPart)
    .join(":");

  return {
    key,
    subject,
    predicate,
    objectRef,
    eventType,
    severity: clampScore(Number(input.severity || 1), 1, 10),
    status: "dormant",
    scope: classifyScope(subject, predicate, objectRef, eventType),
    reason: "pending V25 relevance resolution",
    source: input.source,
  };
}

function compactFacts(facts: ResolvedContinuityFact[]) {
  const map = new Map<string, ResolvedContinuityFact>();

  for (const fact of facts) {
    const existing = map.get(fact.key);
    if (!existing || fact.source === "current" || fact.severity > existing.severity) {
      map.set(fact.key, fact);
    }
  }

  return Array.from(map.values()).sort((a, b) => b.severity - a.severity);
}

function classifyFact(
  fact: ResolvedContinuityFact,
  sceneLower: string,
  mentionedCharacterKeys: Set<string>,
): ResolvedContinuityFact {
  const subjectKey = normalizeKeyPart(fact.subject);
  const objectKey = normalizeKeyPart(fact.objectRef || "");
  const subjectMentioned = Boolean(subjectKey && sceneLower.includes(subjectKey.replace(/-/g, " ")));
  const objectMentioned = Boolean(objectKey && sceneLower.includes(objectKey.replace(/-/g, " ")));
  const predicateText = `${fact.predicate} ${fact.eventType}`.toLowerCase();

  if (fact.scope === "identity" && mentionedCharacterKeys.size > 0 && !mentionedCharacterKeys.has(subjectKey)) {
    return {
      ...fact,
      status: "blocked",
      reason: "identity-scoped fact belongs to a different named character than the current scene",
    };
  }

  if (fact.source === "current") {
    return {
      ...fact,
      status: "active",
      reason: "current scene produced this fact",
    };
  }

  if (subjectMentioned || objectMentioned) {
    return {
      ...fact,
      status: "active",
      reason: "subject or object is mentioned in the current scene",
    };
  }

  if (fact.scope === "environment" && /rain|storm|weather|cold|wet|shower|bathroom|steam|water|snow|heat|fire|smoke/.test(sceneLower)) {
    return {
      ...fact,
      status: "active",
      reason: "environmental condition is relevant to the current scene setting",
    };
  }

  if (fact.scope === "object" && /carry|case|bag|box|weapon|phone|object|prop|holds|holding/.test(sceneLower)) {
    return {
      ...fact,
      status: "active",
      reason: "object permanence is relevant to current scene language",
    };
  }

  if (fact.scope === "identity" && mentionedCharacterKeys.size === 0 && /injury|wound|bandage|scar|tattoo|arm|shoulder|face|hair|body/.test(sceneLower)) {
    return {
      ...fact,
      status: "active",
      reason: "anatomical or identity continuity is relevant and no conflicting character identity is named",
    };
  }

  return {
    ...fact,
    status: "dormant",
    reason: "canonical memory retained but not relevant enough to become a visual render instruction",
  };
}

function resolveRenderConstraints(
  constraints: string[],
  activeFacts: ResolvedContinuityFact[],
  dormantFacts: ResolvedContinuityFact[],
  blockedFacts: ResolvedContinuityFact[],
  sceneLower: string,
) {
  const resolved: string[] = [];
  const suppressed: string[] = [];
  const blockedKeys = new Set(blockedFacts.flatMap((fact) => [fact.subject.toLowerCase(), fact.objectRef?.toLowerCase()].filter(Boolean) as string[]));
  const activeKeys = new Set(activeFacts.flatMap((fact) => [fact.subject.toLowerCase(), fact.objectRef?.toLowerCase()].filter(Boolean) as string[]));

  for (const constraint of constraints) {
    const normalized = constraint.trim();
    if (!normalized) continue;
    const lower = normalized.toLowerCase();
    const matchesBlocked = Array.from(blockedKeys).some((key) => key && lower.includes(key));
    const matchesActive = Array.from(activeKeys).some((key) => key && lower.includes(key));

    if (matchesBlocked) {
      suppressed.push(normalized);
      continue;
    }

    if (matchesActive || isSceneLocalConstraint(lower, sceneLower)) {
      resolved.push(normalized);
      continue;
    }

    suppressed.push(normalized);
  }

  for (const fact of activeFacts) {
    const constraint = renderConstraintForFact(fact);
    if (constraint && !resolved.some((item) => item.toLowerCase() === constraint.toLowerCase())) {
      resolved.push(constraint);
    }
  }

  for (const fact of dormantFacts) {
    const text = `${fact.subject} ${fact.objectRef || ""}`.toLowerCase();
    if (sceneLower.includes(text.trim())) {
      const constraint = renderConstraintForFact(fact);
      if (constraint) resolved.push(constraint);
    }
  }

  return {
    resolved: normalizeConstraintList(resolved),
    suppressed: normalizeConstraintList(suppressed),
  };
}

function renderConstraintForFact(fact: ResolvedContinuityFact) {
  if (fact.scope === "identity") {
    return `${fact.subject} ${fact.objectRef || fact.predicate} must be visible or narratively accounted for only if ${fact.subject} is present in this scene.`;
  }

  if (fact.scope === "object") {
    return `${fact.subject} must remain visually consistent only if present, carried, nearby, hidden, or narratively referenced in this scene.`;
  }

  if (fact.scope === "location") {
    return `${fact.subject} location state remains canonical but should render only when the scene is set there or directly references it.`;
  }

  if (fact.scope === "environment") {
    return `${fact.subject} environmental state should affect the scene only when local weather, water, smoke, damage, or recovery conditions are present.`;
  }

  return null;
}

function isSceneLocalConstraint(constraintLower: string, sceneLower: string) {
  if (/identity|same person|face|hair|body|wardrobe|bandage|scar|tattoo/.test(constraintLower)) {
    return /person|character|face|hair|body|wardrobe|bandage|scar|tattoo|arm|shoulder|injury/.test(sceneLower);
  }

  if (/rain|weather|wet|steam|water|bathroom|shower/.test(constraintLower)) {
    return /rain|weather|wet|steam|water|bathroom|shower/.test(sceneLower);
  }

  return false;
}

function extractWorldFacts(state: RuntimeState) {
  const worldState = state.world.state ?? {};
  const facts: Array<{
    subject: string;
    predicate: string;
    objectRef: string | null;
    eventType: string;
    severity: number;
    source: ResolvedContinuityFact["source"];
  }> = [];

  for (const value of toStringArray(worldState.persistentObjects)) {
    facts.push({
      subject: value,
      predicate: "persists-through-scene",
      objectRef: "scene",
      eventType: "object-persistent",
      severity: 2,
      source: "world",
    });
  }

  for (const value of toStringArray(worldState.damagedLocations)) {
    facts.push({
      subject: value,
      predicate: "damaged",
      objectRef: "world",
      eventType: "location-damaged",
      severity: 6,
      source: "world",
    });
  }

  if (typeof worldState.weather === "string" && worldState.weather.trim()) {
    facts.push({
      subject: state.world.name,
      predicate: "weather-pressure-increased",
      objectRef: "weather",
      eventType: "environment-pressure",
      severity: 4,
      source: "world",
    });
  }

  return facts;
}

function extractCharacterFacts(characters: RuntimeCharacter[]) {
  const facts: Array<{
    subject: string;
    predicate: string;
    objectRef: string | null;
    eventType: string;
    severity: number;
    source: ResolvedContinuityFact["source"];
  }> = [];

  for (const character of characters) {
    const state = character.state ?? {};
    const injury = typeof state.injury === "string" ? state.injury : null;

    if (injury && injury !== "none") {
      facts.push({
        subject: character.name,
        predicate: "injured",
        objectRef: injury.replace(/\s*active\s*$/i, ""),
        eventType: "character-injured",
        severity: 5,
        source: "character",
      });
    }

    for (const object of toStringArray(state.carriedObjects)) {
      facts.push({
        subject: object,
        predicate: "carried-by",
        objectRef: character.name,
        eventType: "object-carried",
        severity: 3,
        source: "character",
      });
    }
  }

  return facts;
}

function classifyScope(
  subject: string,
  predicate: string,
  objectRef: string | null,
  eventType: string,
): ContinuityFactScope {
  const text = `${subject} ${predicate} ${objectRef || ""} ${eventType}`.toLowerCase();

  if (/injur|wound|scar|tattoo|bandage|body|face|hair|arm|shoulder|leg|hand|eye/.test(text)) return "identity";
  if (/case|bag|box|file|weapon|phone|object|prop|carried/.test(text)) return "object";
  if (/bridge|room|bathroom|apartment|street|district|tavern|location/.test(text)) return "location";
  if (/weather|rain|storm|smoke|water|steam|pressure|fire|snow|mud|wet/.test(text)) return "environment";
  if (/trust|betray|relationship|alliance|hostility/.test(text)) return "relationship";

  return "other";
}

function normalizeConstraintList(values: string[]) {
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

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function normalizeKeyPart(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function clampScore(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
