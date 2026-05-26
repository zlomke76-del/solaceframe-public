import { getSupabaseAdmin } from "../supabase-admin";

export async function ensureSeedRuntime() {
  const supabase = getSupabaseAdmin().schema("solaceframe");

  const { data: existingProject, error: existingError } = await supabase
    .from("projects")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existingProject?.id) {
    await ensureProjectChildren(existingProject.id as string);
    return existingProject.id as string;
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({
      name: "Prime SolaceFrame Runtime",
      description: "Default governed synthetic continuity project."
    })
    .select("*")
    .single();

  if (projectError) throw projectError;

  await ensureProjectChildren(project.id as string);
  return project.id as string;
}

async function ensureProjectChildren(projectId: string) {
  const supabase = getSupabaseAdmin().schema("solaceframe");

  const { data: existingBranch, error: branchLookupError } = await supabase
    .from("branches")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (branchLookupError) throw branchLookupError;

  let branch = existingBranch;

  if (!branch) {
    const { data: createdBranch, error: branchError } = await supabase
      .from("branches")
      .insert({
        project_id: projectId,
        name: "Prime Continuity",
        divergence_score: 0,
        status: "active"
      })
      .select("*")
      .single();

    if (branchError) throw branchError;
    branch = createdBranch;
  }

  const { data: project, error: projectLookupError } = await supabase
    .from("projects")
    .select("active_branch_id")
    .eq("id", projectId)
    .single();

  if (projectLookupError) throw projectLookupError;

  if (!project.active_branch_id && branch?.id) {
    const { error: updateProjectError } = await supabase
      .from("projects")
      .update({ active_branch_id: branch.id })
      .eq("id", projectId);

    if (updateProjectError) throw updateProjectError;
  }

  const { data: existingWorld, error: worldLookupError } = await supabase
    .from("worlds")
    .select("id")
    .eq("project_id", projectId)
    .limit(1)
    .maybeSingle();

  if (worldLookupError) throw worldLookupError;

  if (!existingWorld) {
    const { error: worldError } = await supabase
      .from("worlds")
      .insert({
        project_id: projectId,
        name: "Neon District 7",
        pressure: 38,
        state: {
          weather: "cold rain",
          damagedLocations: ["eastern bridge"],
          persistentObjects: ["yellow courier case"],
          unresolvedTensions: ["source authority unresolved"]
        }
      });

    if (worldError) throw worldError;
  }

  const { data: existingCharacters, error: characterLookupError } = await supabase
    .from("characters")
    .select("id")
    .eq("project_id", projectId)
    .limit(1);

  if (characterLookupError) throw characterLookupError;

  if (!existingCharacters || existingCharacters.length === 0) {
    const { error: charactersError } = await supabase
      .from("characters")
      .insert([
        {
          project_id: projectId,
          name: "Elena Voss",
          role: "Primary continuity anchor",
          appearance_anchor: {
            hair: "dark",
            wardrobe: "weathered jacket",
            visualLock: "active"
          },
          state: {
            emotionalState: "guarded",
            injury: "left-arm injury",
            carriedObjects: ["yellow courier case"]
          },
          continuity_score: 94,
          pressure: 22
        },
        {
          project_id: projectId,
          name: "Ren Kaito",
          role: "Unverified source holder",
          appearance_anchor: {
            wardrobe: "dark transit coat",
            visualLock: "active"
          },
          state: {
            emotionalState: "withholding",
            injury: "none",
            carriedObjects: ["encrypted source file"]
          },
          continuity_score: 87,
          pressure: 31
        }
      ]);

    if (charactersError) throw charactersError;
  }

  const { data: existingLineage, error: lineageLookupError } = await supabase
    .from("lineage_events")
    .select("id")
    .eq("project_id", projectId)
    .eq("event_type", "runtime-seeded")
    .limit(1)
    .maybeSingle();

  if (lineageLookupError) throw lineageLookupError;

  if (!existingLineage) {
    const { error: lineageError } = await supabase
      .from("lineage_events")
      .insert({
        project_id: projectId,
        event_type: "runtime-seeded",
        summary: "Initial SolaceFrame runtime state created.",
        payload: {
          branchId: branch?.id
        }
      });

    if (lineageError) throw lineageError;
  }
}
