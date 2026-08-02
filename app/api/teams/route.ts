import { NextResponse } from "next/server";
import { requireApiProfile } from "@/lib/auth";
import { assertSameOrigin, errorResponse } from "@/lib/http";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { cleanText } from "@/lib/validation";

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return errorResponse("Invalid request.", 403);
  const user = await requireApiProfile(["admin"]);
  if (!user) return errorResponse("Unauthorized.", 401);

  const body = await request.json();
  const name = cleanText(body.name, 80);
  if (name.length < 2) return errorResponse("Enter a valid team name.");

  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("teams")
    .insert({ name, created_by: user.id })
    .select("id,name,active,created_at")
    .single();

  if (error) {
    return errorResponse(
      error.message.includes("teams_name_unique")
        ? "A team with this name already exists."
        : "Unable to create the team.",
      409,
    );
  }

  await Promise.all([
    admin.from("audit_events").insert({
      actor_id: user.id,
      action: "team_created",
      entity_type: "team",
      entity_id: data.id,
      details: { name },
    }),
    admin.from("activity_events").insert({
      event_type: "team_created",
      actor_id: user.id,
      team_id: data.id,
      entity_id: data.id,
    }),
  ]);
  return NextResponse.json({ team: data }, { status: 201 });
}
