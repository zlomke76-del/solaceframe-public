import type {
  RuntimeCausalEvent,
  RuntimeCharacter,
  RuntimeWorld,
} from "./types";

type SceneAnalysisLike = {
  title: string;
  driftRisk: string;
  mutated: string[];
  preserve: string[];
  violations: string[];
  renderConstraints: string[];
  causalEvents: Array<{
    event_key: string;
    event_type: string;
    subject: string;
    predicate: string;
    object_ref?: string | null;
    severity: number;
    payload?: Record<string, unknown>;
  }>;
};

type MemoryMarker = {
  id: string;
  kind: "scar" | "tattoo" | "bruise" | "cut" | "burn" | "bandage" | "strain";
  bodyRegion: string;
  side: "left" | "right" | "center" | "unknown";
  severity: number;
  visibility: number;
  permanence: "temporary" | "semi-permanent" | "permanent";
  status: "fresh" | "active" | "healing" | "faded" | "resolved";
  createdAtScene: string;
  lastSeenScene: string;
  continuityLocked: boolean;
  notes: string[];
};

type SyntheticMemoryReport = {
  version: "v24-synthetic-memory-runtime";
  sceneTitle: string;
  physicalStateMutations: string[];
  anatomicalStateMutations: string[];
  environmentalStateMutations: string[];
  objectStateMutations: string[];
  spatialStateMutations: string[];
  relationshipStateMutations: string[];
  recoveryStateMutations: string[];
  renderConstraints: string[];
};

const BODY_REGIONS = [
  "left forearm",
  "right forearm",
  "left upper arm",
  "right upper arm",
  "left shoulder",
  "right shoulder",
  "left hand",
  "right hand",
  "upper back",
  "lower back",
  "left thigh",
  "right thigh",
  "left cheek",
  "right cheek",
  "face",
  "torso",
  "neck",
  "abdomen",
];

function stableId(parts: Array<string | number | null | undefined>) {
  return parts
    .filter((part) => part !== null && part !== undefined && String(part).trim())
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 96);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item)).filter(Boolean)
    : [];
}

function readMarkerArray(value: unknown): MemoryMarker[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is MemoryMarker => {
    const record = asRecord(item);
    return typeof record.id === "string" && typeof record.kind === "string";
  });
}

function detectBodyRegion(text: string) {
  for (const region of BODY_REGIONS) {
    if (text.includes(region)) return region;
  }

  if (text.includes("arm")) return text.includes("right") ? "right arm" : text.includes("left") ? "left arm" : "arm";
  if (text.includes("shoulder")) return text.includes("right") ? "right shoulder" : text.includes("left") ? "left shoulder" : "shoulder";
  if (text.includes("hand")) return text.includes("right") ? "right hand" : text.includes("left") ? "left hand" : "hand";
  if (text.includes("face") || text.includes("cheek") || text.includes("eye") || text.includes("brow")) return "face";
  if (text.includes("back")) return "back";
  if (text.includes("leg") || text.includes("thigh")) return text.includes("right") ? "right leg" : text.includes("left") ? "left leg" : "leg";

  return "unknown body region";
}

function detectSide(region: string): MemoryMarker["side"] {
  if (region.includes("left")) return "left";
  if (region.includes("right")) return "right";
  if (region === "face" || region === "torso" || region === "neck" || region === "abdomen" || region.includes("back")) return "center";
  return "unknown";
}

function markerKindFromText(text: string): MemoryMarker["kind"] | null {
  if (/\btattoo(s)?\b/.test(text)) return "tattoo";
  if (/\bscar(s|red)?\b/.test(text)) return "scar";
  if (/\bbandage(s|d)?\b|\bwrap(ped)?\b|\bgauze\b/.test(text)) return "bandage";
  if (/\bbruise(s|d)?\b/.test(text)) return "bruise";
  if (/\bburn(s|ed)?\b/.test(text)) return "burn";
  if (/\bcut(s)?\b|\bwound(s|ed)?\b|\binjur(y|ed)\b/.test(text)) return "cut";
  if (/\bstrain(ed)?\b|\bsprain(ed)?\b/.test(text)) return "strain";
  return null;
}

function upsertMarker(markers: MemoryMarker[], marker: MemoryMarker) {
  const existingIndex = markers.findIndex(
    (item) => item.kind === marker.kind && item.bodyRegion === marker.bodyRegion && item.side === marker.side,
  );

  if (existingIndex >= 0) {
    const existing = markers[existingIndex];
    markers[existingIndex] = {
      ...existing,
      severity: Math.max(existing.severity, marker.severity),
      visibility: Math.max(existing.visibility, marker.visibility),
      status: marker.status,
      lastSeenScene: marker.lastSeenScene,
      continuityLocked: true,
      notes: Array.from(new Set([...existing.notes, ...marker.notes])).slice(-8),
    };
    return markers[existingIndex];
  }

  markers.push(marker);
  return marker;
}

function inferPhysicalState(sceneText: string, previous: Record<string, unknown>) {
  const lower = sceneText.toLowerCase();
  const physical = asRecord(previous.physicalState);
  const fatigue = typeof physical.fatigue === "number" ? physical.fatigue : 0;
  const stressLoad = typeof physical.stressLoad === "number" ? physical.stressLoad : 0;
  const temperatureExposure = typeof physical.temperatureExposure === "number" ? physical.temperatureExposure : 0;
  const recoveryState = typeof physical.recoveryState === "number" ? physical.recoveryState : 70;

  const fatigueDelta = /exhaust|fatigue|tired|limp|collapse|surviv|wounded|storm|rain|running|fight|chase/.test(lower) ? 12 : 2;
  const stressDelta = /danger|threat|weapon|explosion|chase|blood|injur|storm|catastrophic|aftermath/.test(lower) ? 16 : 3;
  const coldDelta = /rain|cold|snow|wet|storm|winter|freezing/.test(lower) ? 12 : 0;
  const recoveryDelta = /bathroom|shower|sleep|rest|safe|recover|decompress/.test(lower) ? 10 : -4;

  return {
    physicalState: {
      fatigue: clamp(fatigue + fatigueDelta, 0, 100),
      stressLoad: clamp(stressLoad + stressDelta, 0, 100),
      temperatureExposure: clamp(temperatureExposure + coldDelta, 0, 100),
      recoveryState: clamp(recoveryState + recoveryDelta, 0, 100),
      hydration: /rain|water|shower|bath/.test(lower) ? 70 : physical.hydration ?? 55,
      sleepDebt: /night|insomnia|exhaust|awake/.test(lower) ? clamp(Number(physical.sleepDebt ?? 0) + 8, 0, 100) : physical.sleepDebt ?? 0,
    },
    mutations: [
      `fatigue ${fatigue} -> ${clamp(fatigue + fatigueDelta, 0, 100)}`,
      `stress ${stressLoad} -> ${clamp(stressLoad + stressDelta, 0, 100)}`,
    ],
  };
}

function inferHairState(sceneText: string, previous: Record<string, unknown>) {
  const lower = sceneText.toLowerCase();
  const prior = asRecord(previous.hairState);

  const moistureState = /shower|soaked|wet hair|rain|storm|damp/.test(lower)
    ? /damp/.test(lower)
      ? "damp"
      : "wet"
    : prior.moistureState ?? "dry";

  const style = /ponytail|tied|bun|braid/.test(lower)
    ? /bun/.test(lower)
      ? "bun"
      : /braid/.test(lower)
        ? "braided"
        : "ponytail"
    : /loose|down|shower|wet/.test(lower)
      ? "down"
      : prior.style ?? "down";

  return {
    ...prior,
    style,
    moistureState,
    continuityLocked: true,
  };
}

function inferWardrobeState(sceneText: string, previous: Record<string, unknown>) {
  const lower = sceneText.toLowerCase();
  const prior = asRecord(previous.wardrobeState);
  const exposure = /rain|storm|wet|soaked|mud|blood|dust|smoke/.test(lower)
    ? Array.from(new Set([...readStringArray(prior.exposure), lower.includes("rain") || lower.includes("wet") ? "wet" : "environmentally exposed"]))
    : readStringArray(prior.exposure);

  const damage = /torn|ripped|burned|blood|mud|damaged|scraped/.test(lower)
    ? Array.from(new Set([...readStringArray(prior.damage), "visible wear must persist until repaired or changed"]))
    : readStringArray(prior.damage);

  return {
    ...prior,
    exposure,
    damage,
    continuityLocked: true,
    layerLogic: "outerwear, midlayer, baselayer, and visible underlayers must remain causally consistent and non-explicit",
  };
}

function inferObjectState(sceneText: string, previous: Record<string, unknown>, analysis: SceneAnalysisLike) {
  const lower = sceneText.toLowerCase();
  const objectState = asRecord(previous.objectState);
  const caseRecord = asRecord(objectState.yellowCourierCase);
  const mentionsCase = /yellow case|yellow courier|courier case|hard case|case/.test(lower) || analysis.renderConstraints.some((item) => /yellow.*case/i.test(item));

  if (!mentionsCase && Object.keys(caseRecord).length === 0) return objectState;

  return {
    ...objectState,
    yellowCourierCase: {
      ...caseRecord,
      continuityLocked: true,
      ownership: caseRecord.ownership ?? "primary protagonist custody unless explicitly transferred",
      location: /bathroom|sink|counter/.test(lower)
        ? "bathroom counter"
        : /street|rain|exterior/.test(lower)
          ? "carried close in public exterior"
          : caseRecord.location ?? "near primary protagonist",
      condition: /rain|wet|storm/.test(lower)
        ? "wet exterior, prior scratches and worn yellow shell persist"
        : caseRecord.condition ?? "worn yellow hard case with persistent scuffs",
      lastSeenScene: analysis.title,
    },
  };
}

function inferSpatialState(sceneText: string, previous: Record<string, unknown>) {
  const lower = sceneText.toLowerCase();
  const spatial = asRecord(previous.spatialState);
  const rooms = asRecord(spatial.rooms);

  if (!/bathroom|shower|mirror|sink|saloon|street|apartment|room|counter|lamp/.test(lower)) {
    return spatial;
  }

  const roomId = /bathroom|shower|sink/.test(lower)
    ? "bathroom"
    : /saloon|bar/.test(lower)
      ? "saloon"
      : /street|rain|bridge/.test(lower)
        ? "exterior-street"
        : "interior";

  const roomRecord = asRecord(rooms[roomId]);

  return {
    ...spatial,
    activeRoomId: roomId,
    rooms: {
      ...rooms,
      [roomId]: {
        ...roomRecord,
        continuityLocked: true,
        lightingSources: Array.from(
          new Set([
            ...readStringArray(roomRecord.lightingSources),
            ...(lower.includes("lamp") || roomId === "bathroom" ? ["warm overhead/wall light source must remain physically anchored"] : []),
          ]),
        ),
        objectLocations: {
          ...asRecord(roomRecord.objectLocations),
          ...(lower.includes("case") || lower.includes("yellow") ? { yellowCourierCase: roomId === "bathroom" ? "counter beside sink" : "with protagonist" } : {}),
        },
        materialState: {
          ...asRecord(roomRecord.materialState),
          ...(roomId === "bathroom" ? { steam: /steam|shower|wet|bathroom/.test(lower) ? "active steam diffusion" : "unknown" } : {}),
        },
      },
    },
  };
}

function inferAnatomicalMarkers(sceneText: string, character: RuntimeCharacter, analysis: SceneAnalysisLike) {
  const lower = sceneText.toLowerCase();
  const currentAnatomical = asRecord(character.state.anatomicalState);
  const markers = readMarkerArray(currentAnatomical.markers);
  const kind = markerKindFromText(lower);
  const mutations: string[] = [];

  if (kind) {
    const region = detectBodyRegion(lower);
    const marker = upsertMarker(markers, {
      id: stableId([character.id, kind, region]),
      kind,
      bodyRegion: region,
      side: detectSide(region),
      severity: /deep|severe|blood|burn/.test(lower) ? 8 : /bandage|wrap|bruise/.test(lower) ? 5 : 3,
      visibility: /visible|shown|exposed|bare|sleeve|arm/.test(lower) ? 85 : 60,
      permanence: kind === "tattoo" || kind === "scar" ? "permanent" : kind === "bandage" ? "temporary" : "semi-permanent",
      status: kind === "scar" || kind === "tattoo" ? "active" : kind === "bandage" ? "active" : "fresh",
      createdAtScene: analysis.title,
      lastSeenScene: analysis.title,
      continuityLocked: true,
      notes: [`Detected from scene: ${analysis.title}`],
    });
    mutations.push(`${marker.kind} locked at ${marker.bodyRegion}`);
  }

  if (/healing|recover|bandage removed|scar tissue|faded scar/.test(lower)) {
    for (const marker of markers) {
      if (marker.kind === "bandage" || marker.kind === "cut" || marker.kind === "bruise" || marker.kind === "burn") {
        marker.status = marker.status === "fresh" ? "active" : marker.status === "active" ? "healing" : marker.status;
        marker.lastSeenScene = analysis.title;
        marker.notes = Array.from(new Set([...marker.notes, "Recovery progression detected"])).slice(-8);
        mutations.push(`${marker.kind} at ${marker.bodyRegion} progressed to ${marker.status}`);
      }
    }
  }

  if (/rain|wet|shower|soaked/.test(lower)) {
    for (const marker of markers) {
      if (marker.kind === "bandage" && marker.status !== "resolved") {
        marker.notes = Array.from(new Set([...marker.notes, "Bandage exposed to moisture; adhesion/wetness must persist until changed"])).slice(-8);
        marker.visibility = Math.max(marker.visibility, 75);
        marker.lastSeenScene = analysis.title;
        mutations.push(`bandage moisture state preserved at ${marker.bodyRegion}`);
      }
    }
  }

  return {
    anatomicalState: {
      ...currentAnatomical,
      version: "v24-anatomical-persistence",
      markers,
      continuityRules: [
        "scars and tattoos are permanent body topology unless explicitly altered by story authority",
        "bandages persist at the same body region until changed, removed, or healed through scene lineage",
        "injuries alter posture and motion until recovery state permits normalization",
      ],
    },
    mutations,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function applySyntheticMemoryTransition(input: {
  sceneText: string;
  analysis: SceneAnalysisLike;
  world: RuntimeWorld;
  characters: RuntimeCharacter[];
  priorCausalEvents: RuntimeCausalEvent[];
}) {
  const physicalWorld = inferPhysicalState(input.sceneText, input.world.state);
  const objectState = inferObjectState(input.sceneText, input.world.state, input.analysis);
  const spatialState = inferSpatialState(input.sceneText, input.world.state);

  const environmentalMutations: string[] = [];
  const lower = input.sceneText.toLowerCase();
  const environmentalState = {
    ...asRecord(input.world.state.environmentalState),
    wetness: /rain|storm|shower|wet|soaked/.test(lower) ? "active" : asRecord(input.world.state.environmentalState).wetness ?? "stable",
    smoke: /smoke|fire|burn/.test(lower) ? "active" : asRecord(input.world.state.environmentalState).smoke ?? "none",
    materialCarryover: /mud|blood|dust|rain|steam|soaked|smoke/.test(lower)
      ? "visible material effects persist until cleaned, dried, repaired, or time-skipped"
      : asRecord(input.world.state.environmentalState).materialCarryover ?? "stable",
  };

  if (environmentalState.wetness === "active") environmentalMutations.push("wetness state active");
  if (environmentalState.materialCarryover !== "stable") environmentalMutations.push("material carryover must persist");

  const report: SyntheticMemoryReport = {
    version: "v24-synthetic-memory-runtime",
    sceneTitle: input.analysis.title,
    physicalStateMutations: physicalWorld.mutations,
    anatomicalStateMutations: [],
    environmentalStateMutations: environmentalMutations,
    objectStateMutations: Object.keys(objectState).length ? ["persistent object state updated"] : [],
    spatialStateMutations: Object.keys(spatialState).length ? ["spatial anchor state updated"] : [],
    relationshipStateMutations: [],
    recoveryStateMutations: /recover|rest|sleep|shower|bathroom|decompress/.test(lower) ? ["recovery sequence detected"] : [],
    renderConstraints: [
      "Preserve scars, tattoos, bandages, bruises, cuts, burns, and their body locations unless a governed scene changes them.",
      "Preserve wetness, dirt, blood, smoke, steam, and damage until a causal cleanup, recovery, repair, or time jump occurs.",
      "Preserve object location and orientation for continuity anchors such as the yellow courier case.",
      "Preserve room topology, lighting-source logic, counter/sink/shower placement, and physically plausible prop anchoring.",
    ],
  };

  const nextCharacters = input.characters.map((character) => {
    const lowerName = character.name.toLowerCase().split(" ")[0] ?? character.name.toLowerCase();
    const referenced = lower.includes(lowerName) || input.analysis.causalEvents.some((event) => event.subject === character.name);
    if (!referenced) return character;

    const physical = inferPhysicalState(input.sceneText, character.state);
    const anatomical = inferAnatomicalMarkers(input.sceneText, character, input.analysis);
    report.anatomicalStateMutations.push(...anatomical.mutations);

    return {
      ...character,
      state: {
        ...character.state,
        physicalState: physical.physicalState,
        anatomicalState: anatomical.anatomicalState,
        hairState: inferHairState(input.sceneText, character.state),
        wardrobeState: inferWardrobeState(input.sceneText, character.state),
        recoveryState: {
          ...asRecord(character.state.recoveryState),
          lastRecoveryScene: /recover|rest|sleep|shower|bathroom|decompress/.test(lower) ? input.analysis.title : asRecord(character.state.recoveryState).lastRecoveryScene,
        },
        syntheticMemory: {
          version: "v24-character-memory",
          lastMemoryMutationScene: input.analysis.title,
        },
      },
    };
  });

  const nextWorld: RuntimeWorld = {
    ...input.world,
    state: {
      ...input.world.state,
      physicalState: physicalWorld.physicalState,
      environmentalState,
      objectState,
      spatialState,
      syntheticMemory: {
        version: "v24-synthetic-memory-runtime",
        lastMutationScene: input.analysis.title,
        renderConstraints: report.renderConstraints,
      },
    },
  };

  return { world: nextWorld, characters: nextCharacters, report };
}
