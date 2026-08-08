import { NextResponse } from "next/server";
import { createResend } from "@/lib/email/resend";
import { resendEnv } from "@/lib/env";
import { createAdminSupabase } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type EmailEventData = Record<string, unknown> & {
  email_id?: string;
  tags?: Record<string, string> | Array<{ name: string; value: string }>;
};

function stringValue(value: unknown) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function tagValue(data: EmailEventData, name: string) {
  if (Array.isArray(data.tags)) {
    return data.tags.find((tag) => tag.name === name)?.value ?? "";
  }
  return data.tags?.[name] ?? "";
}

function eventStatus(eventType: string) {
  const statuses: Record<string, string> = {
    "email.sent": "sent",
    "email.delivered": "delivered",
    "email.delivery_delayed": "delivery_delayed",
    "email.opened": "opened",
    "email.clicked": "clicked",
    "email.bounced": "bounced",
    "email.complained": "complained",
    "email.suppressed": "suppressed",
    "email.failed": "failed",
  };
  return statuses[eventType] ?? null;
}

function eventError(data: EmailEventData) {
  for (const key of ["error", "bounce", "failed", "suppression"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 2_000);
    if (value && typeof value === "object") {
      const object = value as Record<string, unknown>;
      const message = stringValue(object.message || object.reason || object.type);
      if (message) return message.slice(0, 2_000);
    }
  }
  return null;
}

export async function POST(request: Request) {
  const config = resendEnv();
  if (!config.webhookSecret) {
    return NextResponse.json({ error: "Webhook is not configured." }, { status: 503 });
  }

  const rawBody = await request.text();
  const svixId = request.headers.get("svix-id") ?? "";
  const svixTimestamp = request.headers.get("svix-timestamp") ?? "";
  const svixSignature = request.headers.get("svix-signature") ?? "";
  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 400 });
  }

  let verified: ReturnType<ReturnType<typeof createResend>["webhooks"]["verify"]>;
  try {
    verified = createResend().webhooks.verify({
      payload: rawBody,
      headers: {
        id: svixId,
        timestamp: svixTimestamp,
        signature: svixSignature,
      },
      webhookSecret: config.webhookSecret,
    });
  } catch {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 400 });
  }

  const payload = verified as unknown as {
    type: string;
    created_at: string;
    data: EmailEventData;
  };
  const admin = createAdminSupabase();
  const { data: storedEvent, error: eventInsertError } = await admin
    .from("email_webhook_events")
    .insert({
      dedupe_key: svixId,
      event_type: payload.type,
      payload,
    })
    .select("id")
    .maybeSingle();

  if (eventInsertError) {
    if (eventInsertError.code === "23505") {
      return NextResponse.json({ received: true, duplicate: true });
    }
    console.error("Unable to store Resend webhook", eventInsertError);
    return NextResponse.json({ error: "Unable to store webhook." }, { status: 500 });
  }
  if (!storedEvent) {
    return NextResponse.json({ error: "Unable to store webhook." }, { status: 500 });
  }

  try {
    const resendEmailId = stringValue(payload.data.email_id);
    const jobId = tagValue(payload.data, "job_id");
    let messageQuery = admin.from("email_messages").select("id,last_event_at");
    if (resendEmailId) messageQuery = messageQuery.eq("resend_email_id", resendEmailId);
    else if (jobId) messageQuery = messageQuery.eq("job_id", jobId);
    else {
      await admin
        .from("email_webhook_events")
        .update({
          processed_at: new Date().toISOString(),
          processing_error: "Webhook has no Resend email ID or job tag.",
        })
        .eq("id", storedEvent.id);
      return NextResponse.json({ received: true, ignored: true });
    }

    const { data: message, error: messageError } = await messageQuery.maybeSingle();
    if (messageError) throw messageError;
    if (!message) {
      await admin
        .from("email_webhook_events")
        .update({
          processed_at: new Date().toISOString(),
          processing_error: "No local email matches this Resend event.",
        })
        .eq("id", storedEvent.id);
      return NextResponse.json({ received: true, ignored: true });
    }

    const eventAt = new Date(payload.created_at);
    const lastEventAt = message.last_event_at ? new Date(message.last_event_at) : null;
    const status = eventStatus(payload.type);
    if (status && !Number.isNaN(eventAt.getTime()) && (!lastEventAt || eventAt >= lastEventAt)) {
      const timestamp = eventAt.toISOString();
      const updates = {
        status,
        last_event_at: timestamp,
        last_error: eventError(payload.data),
        ...(status === "sent" ? { sent_at: timestamp } : {}),
        ...(status === "delivered" ? { delivered_at: timestamp } : {}),
        ...(status === "opened" ? { opened_at: timestamp } : {}),
        ...(status === "clicked" ? { clicked_at: timestamp } : {}),
        ...(resendEmailId ? { resend_email_id: resendEmailId } : {}),
      };
      const { error: updateError } = await admin
        .from("email_messages")
        .update(updates)
        .eq("id", message.id);
      if (updateError) throw updateError;
    }

    await admin
      .from("email_webhook_events")
      .update({
        email_message_id: message.id,
        processed_at: new Date().toISOString(),
        processing_error: null,
      })
      .eq("id", storedEvent.id);

    return NextResponse.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook processing failed.";
    await admin
      .from("email_webhook_events")
      .update({ processing_error: message.slice(0, 2_000) })
      .eq("id", storedEvent.id);
    console.error("Resend webhook processing failed", error);
    return NextResponse.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}
