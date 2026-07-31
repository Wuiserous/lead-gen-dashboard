import { NextResponse } from "next/server";
import { requireApiProfile } from "@/lib/auth";
import { assertSameOrigin, errorResponse } from "@/lib/http";
import { createAdminSupabase } from "@/lib/supabase/admin";
import type { RegistrationStatus } from "@/lib/types";
import { cleanText } from "@/lib/validation";

const statuses: RegistrationStatus[] = [
  "new",
  "contacted",
  "interested",
  "follow_up",
  "converted",
  "not_interested",
  "invalid",
];

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!assertSameOrigin(request)) return errorResponse("Invalid request.", 403);
  const user = await requireApiProfile();
  if (!user) return errorResponse("Unauthorized.", 401);
  const { id } = await context.params;
  const body = await request.json();
  const status = body.status as RegistrationStatus;
  const note = cleanText(body.note, 2000);
  if (!statuses.includes(status)) return errorResponse("Invalid lead status.");

  const admin = createAdminSupabase();
  const { data: lead } = await admin
    .from("registrations")
    .select("id,credited_sales_id,credited_team_id,ambassador_id")
    .eq("id", id)
    .maybeSingle();
  if (!lead) return errorResponse("Registration not found.", 404);

  const allowed =
    user.role === "admin" ||
    (user.role === "sales" && lead.credited_sales_id === user.id) ||
    (user.role === "team_lead" && lead.credited_team_id === user.team_id);
  if (!allowed) return errorResponse("Unauthorized.", 403);

  const { error } = await admin
    .from("registrations")
    .update({ status, note })
    .eq("id", id);
  if (error) return errorResponse("Unable to update the registration.", 500);

  await admin.from("audit_events").insert({
    actor_id: user.id,
    action: "registration_updated",
    entity_type: "registration",
    entity_id: id,
    details: { status },
  });

  return NextResponse.json({ ok: true });
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
      "Only Team Leads and Admins can delete registrations.",
      403,
    );
  }

  const { id } = await context.params;
  const admin = createAdminSupabase();
  const { data: lead } = await admin
    .from("registrations")
    .select(
      "id,credited_sales_id,credited_team_id,ambassador_id",
    )
    .eq("id", id)
    .maybeSingle();
  if (!lead) return errorResponse("Registration not found.", 404);

  if (user.role === "team_lead" && lead.credited_team_id !== user.team_id) {
    return errorResponse("Unauthorized.", 403);
  }

  const { error } = await admin.from("registrations").delete().eq("id", id);
  if (error) return errorResponse("Unable to delete the registration.", 500);

  await admin.from("audit_events").insert({
    actor_id: user.id,
    action: "registration_deleted",
    entity_type: "registration",
    entity_id: id,
    details: {
      ambassador_id: lead.ambassador_id,
    },
  });
  await admin.from("activity_events").insert({
    event_type: "registration_deleted",
    actor_id: user.id,
    team_id: lead.credited_team_id,
    sales_id: lead.credited_sales_id,
    ambassador_id: lead.ambassador_id,
    entity_id: id,
  });

  return NextResponse.json({ ok: true });
}
