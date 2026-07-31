import { NextResponse } from "next/server";
import { requireApiProfile } from "@/lib/auth";
import { assertSameOrigin, errorResponse } from "@/lib/http";
import { createAdminSupabase } from "@/lib/supabase/admin";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!assertSameOrigin(request)) return errorResponse("Invalid request.", 403);
  const actor = await requireApiProfile(["admin"]);
  if (!actor) return errorResponse("Unauthorized.", 401);

  const { id } = await context.params;
  const body = await request.json();
  if (typeof body.active !== "boolean") {
    return errorResponse("No valid change supplied.");
  }

  const admin = createAdminSupabase();
  if (!body.active) {
    const { count } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("team_id", id)
      .eq("active", true);
    if (count) {
      return errorResponse(
        "Move or suspend active employees before deactivating this team.",
        409,
      );
    }
  }

  const { data, error } = await admin
    .from("teams")
    .update({ active: body.active })
    .eq("id", id)
    .select("id,name,active")
    .maybeSingle();
  if (error || !data) return errorResponse("Unable to update the team.", 500);

  await admin.from("audit_events").insert({
    actor_id: actor.id,
    action: "team_updated",
    entity_type: "team",
    entity_id: id,
    details: { active: body.active },
  });
  await admin.from("activity_events").insert({
    event_type: "team_updated",
    actor_id: actor.id,
    team_id: id,
    entity_id: id,
  });
  return NextResponse.json({ team: data });
}
