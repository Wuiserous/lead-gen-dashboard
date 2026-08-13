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
  let updateQuery = admin
    .from("registrations")
    .update({ status, note })
    .eq("id", id);
  if (user.role === "sales") {
    updateQuery = updateQuery.eq("owner_sales_id", user.id);
  } else if (user.role === "team_lead") {
    updateQuery = updateQuery.in("owner_team_id", user.managed_team_ids);
  }
  const { data: lead, error } = await updateQuery
    .select("id,credited_sales_id,credited_team_id,owner_sales_id,owner_team_id,ambassador_id,status,note,updated_at")
    .maybeSingle();
  if (error) return errorResponse("Unable to update the registration.", 500);
  if (!lead) return errorResponse("Registration not found or unavailable.", 404);

  const terminalWhatsappState =
    status === "converted"
      ? "converted"
      : status === "not_interested"
        ? "not_interested"
        : status === "invalid"
          ? "failed"
          : null;
  const sideEffects: Array<PromiseLike<unknown>> = [
    admin.from("audit_events").insert({
      actor_id: user.id,
      action: "registration_updated",
      entity_type: "registration",
      entity_id: id,
      details: { status },
    }),
  ];
  if (terminalWhatsappState) {
    sideEffects.push(
      admin
        .from("whatsapp_conversations")
        .update({ state: terminalWhatsappState, bot_paused: true, flow_step: "closed" })
        .eq("registration_id", id),
      admin
        .from("whatsapp_jobs")
        .update({ status: "cancelled", completed_at: new Date().toISOString() })
        .eq("registration_id", id)
        .eq("status", "pending"),
    );
  }
  await Promise.all(sideEffects);

  return NextResponse.json({ lead });
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
  let deleteQuery = admin
    .from("registrations")
    .delete()
    .eq("id", id);
  if (user.role === "team_lead") {
    deleteQuery = deleteQuery.in("owner_team_id", user.managed_team_ids);
  }
  const { data: lead, error } = await deleteQuery
    .select("id,credited_sales_id,credited_team_id,owner_sales_id,owner_team_id,ambassador_id")
    .maybeSingle();
  if (error) return errorResponse("Unable to delete the registration.", 500);
  if (!lead) return errorResponse("Registration not found or unavailable.", 404);

  await Promise.all([
    admin.from("audit_events").insert({
      actor_id: user.id,
      action: "registration_deleted",
      entity_type: "registration",
      entity_id: id,
      details: {
        ambassador_id: lead.ambassador_id,
      },
    }),
    admin.from("activity_events").insert({
      event_type: "registration_deleted",
      actor_id: user.id,
      team_id: lead.owner_team_id,
      sales_id: lead.owner_sales_id,
      ambassador_id: lead.ambassador_id,
      entity_id: id,
    }),
  ]);

  return NextResponse.json({ ok: true });
}
