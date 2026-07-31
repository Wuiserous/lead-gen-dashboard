import { NextResponse } from "next/server";
import { requireApiProfile } from "@/lib/auth";
import { assertSameOrigin, errorResponse } from "@/lib/http";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { cleanText } from "@/lib/validation";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!assertSameOrigin(request)) return errorResponse("Invalid request.", 403);
  const actor = await requireApiProfile(["admin"]);
  if (!actor) return errorResponse("Unauthorized.", 401);

  const { id } = await context.params;
  if (id === actor.id) {
    return errorResponse("Use another Admin account to change your own access.");
  }

  const body = await request.json();
  const admin = createAdminSupabase();
  const { data: profile } = await admin
    .from("profiles")
    .select("id,role,team_id,active")
    .eq("id", id)
    .maybeSingle();
  if (!profile || profile.role === "admin") {
    return errorResponse("Employee not found.", 404);
  }

  let nextActive = profile.active;
  let nextTeamId = profile.team_id;
  if (typeof body.active === "boolean") nextActive = body.active;
  if (body.teamId) {
    const teamId = cleanText(body.teamId, 80);
    const { data: team } = await admin
      .from("teams")
      .select("id")
      .eq("id", teamId)
      .eq("active", true)
      .maybeSingle();
    if (!team) return errorResponse("Select an active team.");
    nextTeamId = teamId;
  }
  if (nextActive === profile.active && nextTeamId === profile.team_id) {
    return errorResponse("No changes supplied.");
  }

  const { error } = await admin.rpc("admin_update_employee", {
    p_employee_id: id,
    p_team_id: nextTeamId,
    p_active: nextActive,
    p_actor_id: actor.id,
  });
  if (error) {
    return errorResponse(
      error.message.includes("one_active_team_lead")
        ? "The selected team already has an active Team Lead."
        : "Unable to update the employee.",
      409,
    );
  }

  return NextResponse.json({ ok: true });
}
