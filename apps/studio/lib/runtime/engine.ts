import type {
  Admissibility,
  DriftRisk,
  RuntimeCausalEvent,
  RuntimeCharacter,
  RuntimeContradiction,
  RuntimeWorld,
  CausalReversibility,
  RuntimeAdmissibilityReport
} from "./types";

export type CausalDraft = {
  event_key: string;
  event_type: string;
  subject: string;
  predicate: string;
  object_ref: string | null;
  severity: number;
  parent_event_id?: string | null;
  reversibility: CausalReversibility;
  payload: Record<string, unknown>;
};

export type ContradictionDraft = {
  contradiction_type: string;
  summary: string;
  severity: "low" | "medium" | "high";
  payload: Record<string, unknown>;
};

export type SceneAnalysis = {
  title: string;
  admissibility: Admissibility;
  driftRisk: DriftRisk;
  preserve: string[];
  mutated: string[];
  violations: string[];
  causalEvents: CausalDraft[];
  contradictions: ContradictionDraft[];
  renderConstraints: string[];
  packet: Record<string, unknown>;
};

export function analyzeScene(
  sceneText: string,
  world: RuntimeWorld,
  characters: RuntimeCharacter[],
  priorCausalEvents: RuntimeCausalEvent[],
  unresolvedContradictions: RuntimeContradiction[]
): SceneAnalysis {
  const lower = sceneText.toLowerCase();

  const preserve = new Set<string>();
  const mutated = new Set<string>();
  const violations = new Set<string>();
  const renderConstraints = new Set<string>();
  const causalEvents: CausalDraft[] = [];
  const contradictions: ContradictionDraft[] = [];

  const worldState = world.state ?? {};
  const damagedLocations = readStringArray(worldState.damagedLocations);
  const persistentObjects = readStringArray(worldState.persistentObjects);
  const primaryCharacter = resolvePrimarySceneCharacter(sceneText, characters);
  const primaryCharacterName = primaryCharacter?.name ?? "current character";
  const primaryLocation = resolvePrimarySceneLocation(lower, world.name);

  for (const character of characters) {
    const nameLower = character.name.toLowerCase();
    const firstName = nameLower.split(" ")[0] ?? nameLower;
    if (lower.includes(nameLower) || lower.includes(firstName)) {
      preserve.add(`${character.name} identity anchor`);
    }
  }
  if (lower.includes("courier") || lower.includes("case")) {
    preserve.add("yellow courier case lineage");
    renderConstraints.add("yellow courier case must remain consistent across frame lineage");
    causalEvents.push({
      event_key: "object:yellow-courier-case:persistent",
      event_type: "object-persistent",
      subject: "yellow courier case",
      predicate: "persists-through-scene",
      object_ref: "scene",
      severity: 2,
      reversibility: "reversible",
      payload: { source: "keyword:courier/case" }
    });
  }

  if (lower.includes("bridge")) {
    preserve.add("bridge damage continuity");
    renderConstraints.add(`${primaryLocation} state must match prior damage unless repaired`);
  }

  if (lower.includes("damage") || lower.includes("collapse") || lower.includes("destroy")) {
    mutated.add("location damage");
    causalEvents.push({
      event_key: `location:${slugify(primaryLocation)}:damaged`,
      event_type: "location-damaged",
      subject: primaryLocation,
      predicate: "damaged",
      object_ref: "world",
      severity: lower.includes("destroy") ? 8 : 6,
      reversibility: lower.includes("destroy") ? "irreversible" : "repairable",
      payload: { source: "scene damage/collapse/destroy term" }
    });
  }

  if (lower.includes("injury") || lower.includes("wound") || lower.includes("bandage") || lower.includes("scar") || lower.includes("tattoo") || lower.includes("arm")) {
    const anatomicalTarget = resolveAnatomicalTarget(lower);
    preserve.add("physical/anatomical continuity");
    renderConstraints.add(`${primaryCharacterName} ${anatomicalTarget} must remain anatomically consistent if visible`);
    causalEvents.push({
      event_key: `character:${slugify(primaryCharacterName)}:${slugify(anatomicalTarget)}`,
      event_type: lower.includes("tattoo") ? "character-tattooed" : lower.includes("scar") ? "character-scarred" : lower.includes("bandage") ? "character-bandaged" : "character-injured",
      subject: primaryCharacterName,
      predicate: lower.includes("tattoo") ? "tattoo-persistent" : lower.includes("scar") ? "scar-persistent" : lower.includes("bandage") ? "bandaged" : "injured",
      object_ref: anatomicalTarget,
      severity: lower.includes("wound") || lower.includes("injury") ? 5 : 3,
      reversibility: lower.includes("tattoo") || lower.includes("scar") ? "irreversible" : "repairable",
      payload: { source: "keyword:injury/wound/bandage/scar/tattoo/body", v26: "anatomical persistence" }
    });
  }

  if (lower.includes("trust") || lower.includes("withhold") || lower.includes("hide") || lower.includes("betray")) {
    const relationshipTarget = resolveRelationshipTarget(sceneText, characters, primaryCharacterName);
    mutated.add("relationship pressure");
    renderConstraints.add(`${primaryCharacterName} / ${relationshipTarget} relationship must preserve degraded trust state only if both are scene-relevant`);
    causalEvents.push({
      event_key: `relationship:${slugify(primaryCharacterName)}-${slugify(relationshipTarget)}:trust-degraded`,
      event_type: "relationship-degraded",
      subject: primaryCharacterName,
      predicate: "trust-degraded",
      object_ref: relationshipTarget,
      severity: 6,
      reversibility: "repairable",
      payload: { source: "relationship keyword" }
    });
  }

  if (lower.includes("flood") || lower.includes("rain") || lower.includes("storm")) {
    mutated.add("environment pressure");
    causalEvents.push({
      event_key: "environment:weather:pressure",
      event_type: "environment-pressure",
      subject: world.name,
      predicate: "weather-pressure-increased",
      object_ref: "weather",
      severity: 4,
      reversibility: "reversible",
      payload: { source: "weather keyword" }
    });
  }

  if (lower.includes("repair") || lower.includes("heal")) {
    mutated.add("repair pathway requested");
    renderConstraints.add("repair must explicitly preserve lineage and account for prior state");
  }

  if (lower.includes("reset")) {
    violations.add("state reset requested without branch repair");
    contradictions.push({
      contradiction_type: "continuity-reset",
      summary: "Scene attempts to reset state without repair pathway.",
      severity: "high",
      payload: { sceneText }
    });
  }

  if (lower.includes("erase")) {
    violations.add("lineage erasure requested");
    contradictions.push({
      contradiction_type: "lineage-erasure",
      summary: "Scene attempts to erase lineage rather than repair it.",
      severity: "high",
      payload: { sceneText }
    });
  }

  if (lower.includes("bridge") && lower.includes("undamaged") && damagedLocations.includes("eastern bridge")) {
    violations.add("bridge described as undamaged despite existing damage");
    contradictions.push({
      contradiction_type: "world-state-conflict",
      summary: "Eastern bridge cannot be undamaged while prior damage remains unresolved.",
      severity: "medium",
      payload: { damagedLocations }
    });
  }

  if ((lower.includes("no case") || lower.includes("case disappears")) && persistentObjects.includes("yellow courier case")) {
    violations.add("persistent object disappearance without lineage event");
    contradictions.push({
      contradiction_type: "object-permanence-conflict",
      summary: "Yellow courier case cannot disappear without explicit transfer, destruction, or repair event.",
      severity: "medium",
      payload: { persistentObjects }
    });
  }

  for (const contradiction of unresolvedContradictions) {
    if (!contradiction.resolved) {
      renderConstraints.add(`unresolved contradiction remains: ${contradiction.summary}`);
    }
  }

  for (const event of priorCausalEvents.slice(0, 12)) {
    if (event.event_type === "location-damaged") {
      renderConstraints.add(`${event.subject} remains damaged unless repaired`);
    }
    if (["character-injured", "character-bandaged", "character-scarred", "character-tattooed"].includes(event.event_type)) {
      renderConstraints.add(`${event.subject} ${event.object_ref ?? "anatomical state"} persists unless healed, removed, or explicitly revised through lineage`);
    }
    if (event.event_type === "relationship-degraded") {
      renderConstraints.add(`${event.subject} / ${event.object_ref} relationship remains degraded`);
    }
  }

  let driftRisk: DriftRisk = "low";
  if (mutated.size >= 2 || contradictions.length > 0) driftRisk = "medium";
  if (violations.size > 0 || contradictions.some((item) => item.severity === "high")) driftRisk = "high";

  const admissibility: Admissibility =
    violations.size > 0 ? "blocked" : driftRisk === "medium" ? "conditional" : "allow";

  return {
    title: makeSceneTitle(sceneText),
    admissibility,
    driftRisk,
    preserve: Array.from(preserve),
    mutated: Array.from(mutated),
    violations: Array.from(violations),
    causalEvents,
    contradictions,
    renderConstraints: Array.from(renderConstraints),
    packet: {
      mode: "image_scene",
      sceneText,
      world: {
        id: world.id,
        name: world.name,
        pressure: world.pressure,
        state: world.state
      },
      characters: characters.map((character) => ({
        id: character.id,
        name: character.name,
        state: character.state,
        continuityScore: character.continuity_score,
        pressure: character.pressure
      })),
      priorCausalEvents: priorCausalEvents.slice(0, 20).map((event) => ({
        eventType: event.event_type,
        subject: event.subject,
        predicate: event.predicate,
        objectRef: event.object_ref,
        severity: event.severity
      })),
      renderConstraints: Array.from(renderConstraints),
      preserve: Array.from(preserve),
      mutated: Array.from(mutated),
      violations: Array.from(violations),
      contradictions,
      admissibility,
      driftRisk
    }
  };
}

export function mutateWorld(world: RuntimeWorld, analysis: SceneAnalysis): RuntimeWorld {
  const pressureDelta =
    analysis.driftRisk === "high" ? 18 : analysis.driftRisk === "medium" ? 8 : 3;

  const nextPressure = Math.min(100, world.pressure + pressureDelta);

  const currentEvents = Array.isArray(world.state.events) ? world.state.events : [];
  const damagedLocations = new Set(readStringArray(world.state.damagedLocations));
  const persistentObjects = new Set(readStringArray(world.state.persistentObjects));
  const unresolvedTensions = new Set(readStringArray(world.state.unresolvedTensions));
  const renderConstraints = new Set(readStringArray(world.state.renderConstraints));

  for (const event of analysis.causalEvents) {
    if (event.event_type === "location-damaged") damagedLocations.add(event.subject);
    if (event.event_type === "object-persistent") persistentObjects.add(event.subject);
    if (event.event_type === "relationship-degraded") unresolvedTensions.add("relationship trust degradation");
  }

  for (const constraint of analysis.renderConstraints) {
    renderConstraints.add(constraint);
  }

  for (const contradiction of analysis.contradictions) {
    unresolvedTensions.add(contradiction.summary);
  }

  return {
    ...world,
    pressure: nextPressure,
    state: {
      ...world.state,
      pressureTrend: nextPressure > world.pressure ? "increasing" : "stable",
      damagedLocations: Array.from(damagedLocations),
      persistentObjects: Array.from(persistentObjects),
      unresolvedTensions: Array.from(unresolvedTensions),
      renderConstraints: Array.from(renderConstraints),
      events: [
        ...currentEvents,
        {
          at: new Date().toISOString(),
          title: analysis.title,
          admissibility: analysis.admissibility,
          driftRisk: analysis.driftRisk,
          mutated: analysis.mutated,
          causalEvents: analysis.causalEvents.map((event) => event.event_key)
        }
      ]
    }
  };
}

export function mutateCharacters(
  characters: RuntimeCharacter[],
  sceneText: string,
  analysis: SceneAnalysis
): RuntimeCharacter[] {
  const lower = sceneText.toLowerCase();

  return characters.map((character) => {
    const firstName = character.name.toLowerCase().split(" ")[0] ?? character.name.toLowerCase();
    const isReferenced = lower.includes(firstName) || analysis.causalEvents.some((event) => event.subject === character.name);

    if (!isReferenced) return character;

    const currentHistory = Array.isArray(character.state.history) ? character.state.history : [];
    const pressureIncrease = analysis.driftRisk === "high" ? 12 : analysis.driftRisk === "medium" ? 6 : 2;
    const continuityDrop = analysis.driftRisk === "high" ? 8 : analysis.driftRisk === "medium" ? 3 : 1;

    const nextAnatomicalState: Record<string, unknown> = {
      ...(typeof character.anatomical_state === "object" && character.anatomical_state !== null
        ? character.anatomical_state
        : {}),
    };

    const nextState: Record<string, unknown> = {
      ...character.state,
      history: [
        ...currentHistory,
        {
          at: new Date().toISOString(),
          sceneTitle: analysis.title,
          effect: analysis.mutated,
          causalEvents: analysis.causalEvents
            .filter((event) => event.subject === character.name)
            .map((event) => event.event_key)
        }
      ]
    };

    for (const event of analysis.causalEvents.filter((item) => item.subject === character.name)) {
      const target = event.object_ref ?? "anatomical state";
      if (event.event_type === "character-injured") {
        nextState.injury = `${target} injury active`;
        nextAnatomicalState.wounds = uniqueStrings([
          ...readStringArray(nextAnatomicalState.wounds),
          target,
        ]);
      }
      if (event.event_type === "character-bandaged") {
        nextAnatomicalState.bandages = uniqueStrings([
          ...readStringArray(nextAnatomicalState.bandages),
          target,
        ]);
      }
      if (event.event_type === "character-scarred") {
        nextAnatomicalState.scars = uniqueStrings([
          ...readStringArray(nextAnatomicalState.scars),
          target,
        ]);
      }
      if (event.event_type === "character-tattooed") {
        nextAnatomicalState.tattoos = uniqueStrings([
          ...readStringArray(nextAnatomicalState.tattoos),
          target,
        ]);
      }
    }

    if (analysis.causalEvents.some((event) => event.event_type === "relationship-degraded" && event.subject === character.name)) {
      nextState.emotionalState = "strained";
      nextState.relationships = {
        ...(typeof character.state.relationships === "object" && character.state.relationships !== null
          ? (character.state.relationships as Record<string, unknown>)
          : {}),
        "Ren Kaito": "trust degraded"
      };
    }

    return {
      ...character,
      pressure: Math.min(100, character.pressure + pressureIncrease),
      continuity_score: Math.max(0, character.continuity_score - continuityDrop),
      state: nextState,
      anatomical_state: nextAnatomicalState
    };
  });
}

export function computeBranchDelta(analysis: SceneAnalysis) {
  if (analysis.driftRisk === "high") return { pressureDelta: 18, divergenceDelta: 10 };
  if (analysis.driftRisk === "medium") return { pressureDelta: 8, divergenceDelta: 5 };
  return { pressureDelta: 3, divergenceDelta: 1 };
}

function makeSceneTitle(sceneText: string) {
  const trimmed = sceneText.trim();
  if (!trimmed) return "Untitled scene";
  const first = trimmed.split(/[.!?]/)[0] ?? trimmed;
  return first.length > 52 ? `${first.slice(0, 52)}...` : first;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}


export function evaluateRuntimeAdmissibility(input: {
  world: RuntimeWorld;
  activeBranch: { divergence_score: number };
  causalEvents: RuntimeCausalEvent[];
  contradictions: RuntimeContradiction[];
}): RuntimeAdmissibilityReport {
  const unresolvedContradictions = input.contradictions.filter((item) => !item.resolved);
  const irreversibleOpenEvents = input.causalEvents.filter(
    (event) => event.reversibility === "irreversible" && !event.repaired
  );

  const worldPressure = clampNumber(input.world.pressure, 0, 100);
  const branchDivergence = clampNumber(input.activeBranch.divergence_score, 0, 100);
  const contradictionLoad = Math.min(40, unresolvedContradictions.length * 12);
  const irreversibleLoad = Math.min(30, irreversibleOpenEvents.length * 15);
  const pressureLoad = worldPressure * 0.22;
  const divergenceLoad = branchDivergence * 0.18;
  const survivability = Math.max(0, Math.round(100 - contradictionLoad - irreversibleLoad - pressureLoad - divergenceLoad));

  const reasons: string[] = [];
  const requiredRepairs: string[] = [];

  if (unresolvedContradictions.length > 0) {
    reasons.push(`${unresolvedContradictions.length} unresolved contradiction(s) remain open`);
    requiredRepairs.push("Resolve or fork around unresolved contradiction state before clean execution");
  }

  if (irreversibleOpenEvents.length > 0) {
    reasons.push(`${irreversibleOpenEvents.length} irreversible causal event(s) remain unrepaired`);
    requiredRepairs.push("Attach repair lineage or move execution into a governed branch");
  }

  if (worldPressure >= 72) {
    reasons.push("World pressure has crossed the high-risk threshold");
    requiredRepairs.push("Reduce unresolved world tension before allowing normal render execution");
  }

  if (branchDivergence >= 68) {
    reasons.push("Branch divergence is approaching continuity fracture");
    requiredRepairs.push("Fork, repair, or reconcile branch state before continuing");
  }

  let decision: RuntimeAdmissibilityReport["decision"] = "allow";

  if (survivability < 45 || unresolvedContradictions.some((item) => item.severity === "high")) {
    decision = "blocked";
  } else if (survivability < 74 || unresolvedContradictions.length > 0 || irreversibleOpenEvents.length > 0) {
    decision = "conditional";
  }

  if (reasons.length === 0) {
    reasons.push("Runtime state remains inside admissible continuity bounds");
  }

  return {
    decision,
    score: survivability,
    factors: {
      unresolvedContradictions: unresolvedContradictions.length,
      irreversibleOpenEvents: irreversibleOpenEvents.length,
      branchDivergence,
      worldPressure,
      survivability
    },
    reasons,
    requiredRepairs
  };
}

function resolvePrimarySceneCharacter(sceneText: string, characters: RuntimeCharacter[]) {
  const lower = sceneText.toLowerCase();
  return characters.find((character) => {
    const nameLower = character.name.toLowerCase();
    const firstName = nameLower.split(" ")[0] ?? nameLower;
    return lower.includes(nameLower) || lower.includes(firstName);
  }) ?? characters.find((character) => (character.state as Record<string, unknown>).archived !== true) ?? null;
}

function resolveRelationshipTarget(sceneText: string, characters: RuntimeCharacter[], primaryCharacterName: string) {
  const lower = sceneText.toLowerCase();
  const other = characters.find((character) => {
    if (character.name === primaryCharacterName) return false;
    const nameLower = character.name.toLowerCase();
    const firstName = nameLower.split(" ")[0] ?? nameLower;
    return lower.includes(nameLower) || lower.includes(firstName);
  });

  return other?.name ?? "scene relationship counterparty";
}

function resolvePrimarySceneLocation(lower: string, fallbackWorldName: string) {
  const candidates = [
    "apartment bedroom",
    "apartment mirror",
    "bathroom",
    "shower",
    "city sidewalk",
    "boutique hotel lobby",
    "eastern bridge",
    "hospital",
    "street",
    "warehouse",
  ];

  return candidates.find((candidate) => lower.includes(candidate)) ?? (lower.includes("bridge") ? "eastern bridge" : fallbackWorldName);
}

function resolveAnatomicalTarget(lower: string) {
  const targets = [
    "left forearm",
    "right forearm",
    "left arm",
    "right arm",
    "left shoulder",
    "right shoulder",
    "upper back",
    "lower abdomen",
    "face",
    "neck",
    "hand",
    "leg",
  ];

  return targets.find((target) => lower.includes(target)) ?? (lower.includes("arm") ? "left arm" : "body");
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}
