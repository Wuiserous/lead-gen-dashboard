import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireApiProfile } from "@/lib/auth";
import { assertSameOrigin, errorResponse } from "@/lib/http";
import { createAdminSupabase } from "@/lib/supabase/admin";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!assertSameOrigin(request)) return errorResponse("Invalid request.", 403);
  const user = await requireApiProfile();
  if (!user) return errorResponse("Unauthorized.", 401);
  const { id } = await context.params;
  const admin = createAdminSupabase();

  const { data: ambassador } = await admin
    .from("ambassadors")
    .select("id,sales_id,team_id,status")
    .eq("id", id)
    .maybeSingle();
  if (!ambassador) return errorResponse("Campus Ambassador not found.", 404);

  const allowed =
    user.role === "admin" ||
    (user.role === "sales" && ambassador.sales_id === user.id) ||
    (user.role === "team_lead" && ambassador.team_id === user.team_id);
  if (!allowed) return errorResponse("Unauthorized.", 403);

  const body = await request.json();
  const updates: Record<string, unknown> = {};
  if (body.status === "active" || body.status === "paused") {
    updates.status = body.status;
  }
  if (body.regenerateProgressLink === true) {
    updates.progress_key = randomUUID();
  }
  if (
    user.role === "admin" &&
    Number.isInteger(Number(body.target)) &&
    Number(body.target) > 0
  ) {
    updates.target = Math.min(Number(body.target), 10000);
  }
  if (!Object.keys(updates).length) return errorResponse("No changes supplied.");

  const { data, error } = await admin
    .from("ambassadors")
    .update(updates)
    .eq("id", id)
    .select("id,status,progress_key,target")
    .single();
  if (error) return errorResponse("Unable to update the ambassador.", 500);

  await admin.from("activity_events").insert({
    event_type: "ambassador_updated",
    actor_id: user.id,
    team_id: ambassador.team_id,
    sales_id: ambassador.sales_id,
    ambassador_id: ambassador.id,
    entity_id: ambassador.id,
  });
  return NextResponse.json({ ambassador: data });
}
