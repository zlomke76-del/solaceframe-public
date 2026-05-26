import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const name = String(body.name || "").trim();

    if (!name) {
      return NextResponse.json(
        { ok: false, error: "name is required" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin().schema("solaceframe");

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .insert({
        name,
        description: body.description ?? null
      })
      .select("*")
      .single();

    if (projectError) throw projectError;

    const { data: branch, error: branchError } = await supabase
      .from("branches")
      .insert({
        project_id: project.id,
        name: "Prime Continuity",
        divergence_score: 0,
        status: "active"
      })
      .select("*")
      .single();

    if (branchError) throw branchError;

    const { error: updateError } = await supabase
      .from("projects")
      .update({ active_branch_id: branch.id })
      .eq("id", project.id);

    if (updateError) throw updateError;

    const { error: worldError } = await supabase
      .from("worlds")
      .insert({
        project_id: project.id,
        name: "Untitled World",
        pressure: 0,
        state: {
          weather: "unassigned",
          persistentObjects: [],
          unresolvedTensions: []
        }
      });

    if (worldError) throw worldError;

    return NextResponse.json({
      ok: true,
      projectId: project.id
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown project creation error"
      },
      { status: 500 }
    );
  }
}
