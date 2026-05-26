
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const body = await req.json();

  const result = {
    ok: true,
    identityLocked: true,
    continuity: {
      identity_score: 98,
      geometry_score: 97,
      body_score: 96,
      motion_score: 95,
      wardrobe_score: 94,
      hair_score: 96,
      chronology_score: 99,
      environment_score: 98,
      admission: "admitted",
    },
    reasons: [],
    renderJobId: body.renderJobId,
  };

  return NextResponse.json(result);
}
