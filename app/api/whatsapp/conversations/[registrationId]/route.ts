import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireApiProfile } from "@/lib/auth";
import { assertSameOrigin, errorResponse } from "@/lib/http";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { cleanText } from "@/lib/validation";
import { dispatchWhatsAppJob } from "@/lib/whatsapp/dispatch";
import { collapseOutboundMirrors } from "@/lib/whatsapp/message-match";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function scopedConversation(registrationId: string) {
  const user = await requireApiProfile(["admin", "sales"]);
  if (!user) return { user: null, conversation: null, error: "unauthorized" };
  const admin = createAdminSupabase();
  let query = admin
    .from("whatsapp_conversations")
    .select(
      "*,registration:registrations(id,name,phone,preferred_domain,status,note),sales:profiles!whatsapp_conversations_assigned_sales_id_fkey(id,full_name,email,wati_enabled)",
    )
    .eq("registration_id", registrationId);
  if (user.role === "sales") {
    query = query.eq("assigned_sales_id", user.id);
  }
  const { data, error } = await query.maybeSingle();
  return {
    user,
    conversation: error ? null : data,
    error: error ? "load_failed" : data ? null : "not_found",
  };
}

function employeeWatiEnabled(conversation: Record<string, unknown>) {
  const relation = conversation.sales as
    | { wati_enabled?: boolean }
    | Array<{ wati_enabled?: boolean }>
    | null
    | undefined;
  const employee = Array.isArray(relation) ? relation[0] : relation;
  return Boolean(employee?.wati_enabled);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ registrationId: string }> },
) {
  const { registrationId } = await context.params;
  if (!uuidPattern.test(registrationId)) return errorResponse("Invalid registration.");
  const scoped = await scopedConversation(registrationId);
  if (!scoped.user) return errorResponse("Unauthorized.", 401);
  if (!scoped.conversation) {
    return errorResponse(
      scoped.error === "load_failed" ? "Unable to load the WhatsApp conversation." : "Conversation not found.",
      scoped.error === "load_failed" ? 500 : 404,
    );
  }

  const admin = createAdminSupabase();
  const { data: messages, error } = await admin
    .from("whatsapp_messages")
    .select(
      "id,direction,message_type,body,intent,template_name,status,error_detail,created_at",
    )
    .eq("conversation_id", scoped.conversation.id)
    .order("sent_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(100);
  if (error) return errorResponse("Unable to load WhatsApp messages.", 500);

  return NextResponse.json(
    {
      conversation: scoped.conversation,
      messages: collapseOutboundMirrors((messages ?? []).reverse()),
      sessionOpen: Boolean(
        scoped.conversation.conversation_window_expires_at &&
          Date.parse(scoped.conversation.conversation_window_expires_at) > Date.now(),
      ),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ registrationId: string }> },
) {
  if (!assertSameOrigin(request)) return errorResponse("Invalid request.", 403);
  const { registrationId } = await context.params;
  if (!uuidPattern.test(registrationId)) return errorResponse("Invalid registration.");
  const scoped = await scopedConversation(registrationId);
  if (!scoped.user) return errorResponse("Unauthorized.", 401);
  if (!scoped.conversation) return errorResponse("Conversation not found.", 404);

  const body = await request.json().catch(() => ({}));
  if (body.action !== "pause" && body.action !== "resume") {
    return errorResponse("Invalid WhatsApp action.");
  }
  if (scoped.conversation.opted_out_at && body.action === "resume") {
    return errorResponse("The student has opted out. Only the student can restart messaging.", 409);
  }
  if (body.action === "resume" && !employeeWatiEnabled(scoped.conversation)) {
    return errorResponse("WATI is disabled for the assigned employee.", 409);
  }

  const admin = createAdminSupabase();
  const botPaused = body.action === "pause";
  const { data: conversation, error } = await admin
    .from("whatsapp_conversations")
    .update({ bot_paused: botPaused, last_error: null })
    .eq("id", scoped.conversation.id)
    .select("*")
    .single();
  if (error) return errorResponse("Unable to update WhatsApp automation.", 500);

  await Promise.all([
    admin.from("audit_events").insert({
      actor_id: scoped.user.id,
      action: botPaused ? "whatsapp_automation_paused" : "whatsapp_automation_resumed",
      entity_type: "registration",
      entity_id: registrationId,
    }),
    admin.from("activity_events").insert({
      event_type: "registration_whatsapp_updated",
      actor_id: scoped.user.id,
      team_id: scoped.conversation.team_id,
      sales_id: scoped.conversation.assigned_sales_id,
      ambassador_id: scoped.conversation.ambassador_id,
      entity_id: registrationId,
    }),
  ]);

  return NextResponse.json({ conversation });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ registrationId: string }> },
) {
  if (!assertSameOrigin(request)) return errorResponse("Invalid request.", 403);
  const { registrationId } = await context.params;
  if (!uuidPattern.test(registrationId)) return errorResponse("Invalid registration.");
  const scoped = await scopedConversation(registrationId);
  if (!scoped.user) return errorResponse("Unauthorized.", 401);
  if (!scoped.conversation) return errorResponse("Conversation not found.", 404);
  if (!employeeWatiEnabled(scoped.conversation)) {
    return errorResponse("WATI is disabled for the assigned employee.", 409);
  }
  if (scoped.conversation.opted_out_at) {
    return errorResponse("The student has opted out of WhatsApp updates.", 409);
  }
  if (
    !scoped.conversation.conversation_window_expires_at ||
    Date.parse(scoped.conversation.conversation_window_expires_at) <= Date.now()
  ) {
    return errorResponse(
      "The 24-hour WhatsApp session has expired. Use an approved WATI template to reopen it.",
      409,
    );
  }

  const body = await request.json().catch(() => ({}));
  const message = cleanText(body.message, 4000);
  if (!message) return errorResponse("Enter a WhatsApp message.");

  const admin = createAdminSupabase();
  const dedupeKey = `manual:${registrationId}:${randomUUID()}`;
  const { data: queuedJob, error } = await admin
    .from("whatsapp_jobs")
    .insert({
      conversation_id: scoped.conversation.id,
      registration_id: registrationId,
      job_type: "manual_text",
      payload: { message, actor_id: scoped.user.id },
      dedupe_key: dedupeKey,
    })
    .select("id")
    .single();
  if (error) return errorResponse("Unable to queue the WhatsApp message.", 500);

  await admin
    .from("whatsapp_conversations")
    .update({ bot_paused: true, flow_step: "awaiting_human" })
    .eq("id", scoped.conversation.id);
  await admin.from("audit_events").insert({
    actor_id: scoped.user.id,
    action: "whatsapp_manual_message_queued",
    entity_type: "registration",
    entity_id: registrationId,
  });

  let sent = false;
  try {
    const dispatch = await dispatchWhatsAppJob(queuedJob.id);
    sent = dispatch.completed > 0;
  } catch (dispatchError) {
    // The durable job remains available to the cron retry worker.
    console.error("Manual WhatsApp dispatch failed", dispatchError);
  }
  return NextResponse.json({ queued: true, sent }, { status: sent ? 200 : 202 });
}
