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

  let updateQuery = admin
    .from("ambassadors")
    .update(updates)
    .eq("id", id);
  if (user.role === "sales") {
    updateQuery = updateQuery.eq("sales_id", user.id);
  } else if (user.role === "team_lead") {
    updateQuery = updateQuery.eq("team_id", user.team_id);
  }
  const { data, error } = await updateQuery
    .select("id,sales_id,team_id,status,progress_key,target")
    .maybeSingle();
  if (error) return errorResponse("Unable to update the ambassador.", 500);
  if (!data) return errorResponse("Campus Ambassador not found or unavailable.", 404);

  await admin.from("activity_events").insert({
    event_type: "ambassador_updated",
    actor_id: user.id,
    team_id: data.team_id,
    sales_id: data.sales_id,
    ambassador_id: data.id,
    entity_id: data.id,
  });
  return NextResponse.json({ ambassador: data });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!assertSameOrigin(request)) return errorResponse("Invalid request.", 403);
  const user = await requireApiProfile();
  if (!user) return errorResponse("Unauthorized.", 401);
  if (user.role === "sales") {
    return errorResponse(
      "Only Team Leads and Admins can delete groups.",
      403,
    );
  }

  const { id } = await context.params;
  const admin = createAdminSupabase();
  const { data: ambassador } = await admin
    .from("ambassadors")
    .select("id,sales_id,team_id")
    .eq("id", id)
    .maybeSingle();
  if (!ambassador) return errorResponse("Campus Ambassador not found.", 404);

  if (user.role === "team_lead" && ambassador.team_id !== user.team_id) {
    return errorResponse("Unauthorized.", 403);
  }

  const { count: registrationCount } = await admin
    .from("registrations")
    .select("id", { count: "exact", head: true })
    .eq("ambassador_id", id);

  const { error } = await admin.from("ambassadors").delete().eq("id", id);
  if (error) {
    return errorResponse(
      "Unable to delete this group and its registrations.",
      500,
    );
  }

  await admin.from("audit_events").insert({
    actor_id: user.id,
    action: "ambassador_deleted",
    entity_type: "ambassador",
    entity_id: id,
    details: {
      registration_count: registrationCount ?? 0,
    },
  });
  await admin.from("activity_events").insert({
    event_type: "ambassador_deleted",
    actor_id: user.id,
    team_id: ambassador.team_id,
    sales_id: ambassador.sales_id,
    entity_id: id,
  });

  return NextResponse.json({
    ok: true,
    deletedRegistrations: registrationCount ?? 0,
  });
}
