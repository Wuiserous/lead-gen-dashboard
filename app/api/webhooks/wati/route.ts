import { createHash, timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { watiEnv } from "@/lib/env";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { dispatchWhatsAppJobs } from "@/lib/whatsapp/dispatch";

export const dynamic = "force-dynamic";

type WatiWebhook = Record<string, unknown>;

function safeEqual(left: string, right: string) {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function digits(value: unknown) {
  return stringValue(value).replace(/\D/g, "");
}

function replyText(payload: WatiWebhook) {
  const candidates = [
    payload.text,
    payload.buttonReply,
    payload.interactiveButtonReply,
    payload.listReply,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (candidate && typeof candidate === "object") {
      const object = candidate as Record<string, unknown>;
      for (const key of ["title", "text", "displayText", "description", "id"]) {
        if (typeof object[key] === "string" && object[key].trim()) {
          return object[key].trim();
        }
      }
    }
  }
  return "";
}

function webhookDedupeKey(payload: WatiWebhook, rawBody: string) {
  const eventType = stringValue(payload.eventType || payload.event_type || "unknown");
  const stableId =
    stringValue(payload.whatsappMessageId) ||
    stringValue(payload.localMessageId) ||
    stringValue(payload.id);
  const status = stringValue(payload.statusString || payload.status);
  if (stableId) return `${eventType}:${stableId}:${status}`.slice(0, 500);
  return `sha256:${createHash("sha256").update(rawBody).digest("hex")}`;
}

function statusFromEvent(payload: WatiWebhook) {
  const value = `${stringValue(payload.eventType)} ${stringValue(payload.statusString)}`.toLowerCase();
  if (value.includes("failed")) return "failed";
  if (value.includes("read")) return "read";
  if (value.includes("delivered")) return "delivered";
  if (value.includes("sent")) return "sent";
  return null;
}

function incomingEvent(payload: WatiWebhook) {
  const eventType = stringValue(payload.eventType).toLowerCase();
  return payload.owner === false || eventType === "message" || eventType === "messagereceived";
}

function nextEarlyStage(current: string, status: string) {
  const rank: Record<string, number> = {
    queued: 0,
    sent: 1,
    delivered: 2,
    read: 3,
  };
  return current in rank && rank[status] > rank[current] ? status : current;
}

async function recordActivity(conversation: Record<string, unknown>) {
  const admin = createAdminSupabase();
  await admin.from("activity_events").insert({
    event_type: "registration_whatsapp_updated",
    team_id: conversation.team_id,
    sales_id: conversation.assigned_sales_id,
    ambassador_id: conversation.ambassador_id,
    entity_id: conversation.registration_id,
  });
}

async function processWebhook(payload: WatiWebhook, rawBody: string) {
  const admin = createAdminSupabase();
  const eventType = stringValue(payload.eventType || payload.event_type || "unknown");
  const dedupeKey = webhookDedupeKey(payload, rawBody);
  const { data: event, error: eventError } = await admin
    .from("whatsapp_webhook_events")
    .insert({ dedupe_key: dedupeKey, event_type: eventType, payload })
    .select("id")
    .maybeSingle();

  if (eventError) {
    if (eventError.code === "23505") return { duplicate: true };
    throw new Error("Unable to store the WATI webhook.");
  }

  const waId = digits(payload.waId || payload.whatsappNumber || payload.phoneNumber);
  let conversationQuery = admin.from("whatsapp_conversations").select("*");
  if (waId) {
    conversationQuery = conversationQuery.eq("wa_id", waId);
  } else if (payload.conversationId) {
    conversationQuery = conversationQuery.eq("wati_conversation_id", stringValue(payload.conversationId));
  } else {
    await admin
      .from("whatsapp_webhook_events")
      .update({ processing_error: "Webhook has no contact identifier." })
      .eq("id", event.id);
    return { ignored: true };
  }

  const { data: conversation, error: conversationError } = await conversationQuery.maybeSingle();
  if (conversationError || !conversation) {
    await admin
      .from("whatsapp_webhook_events")
      .update({ processing_error: "No registration matches this WhatsApp contact." })
      .eq("id", event.id);
    return { ignored: true };
  }
  const { data: assignedEmployee } = await admin
    .from("profiles")
    .select("active,wati_enabled")
    .eq("id", conversation.assigned_sales_id)
    .maybeSingle();
  const employeeWatiEnabled = Boolean(
    assignedEmployee?.active && assignedEmployee?.wati_enabled,
  );

  if (incomingEvent(payload)) {
    const whatsappMessageId = stringValue(payload.whatsappMessageId) || null;
    if (whatsappMessageId) {
      const { data: duplicateMessage } = await admin
        .from("whatsapp_messages")
        .select("id")
        .eq("whatsapp_message_id", whatsappMessageId)
        .maybeSingle();
      if (duplicateMessage) {
        await admin
          .from("whatsapp_webhook_events")
          .update({ processed_at: new Date().toISOString() })
          .eq("id", event.id);
        return { duplicate: true };
      }
    }

    const body = replyText(payload);
    const messageType = stringValue(payload.type || "text").toLowerCase();
    const now = new Date();
    const { data: message, error: messageError } = await admin
      .from("whatsapp_messages")
      .insert({
        conversation_id: conversation.id,
        registration_id: conversation.registration_id,
        direction: "inbound",
        message_type: messageType,
        body,
        whatsapp_message_id: whatsappMessageId,
        status: "received",
        sent_at: now.toISOString(),
      })
      .select("id")
      .single();
    if (messageError) throw new Error("Unable to store the incoming WhatsApp message.");

    const updatedConversation = {
      ...conversation,
      wati_conversation_id:
        stringValue(payload.conversationId) || conversation.wati_conversation_id,
      wati_ticket_id: stringValue(payload.ticketId) || conversation.wati_ticket_id,
      last_inbound_at: now.toISOString(),
      conversation_window_expires_at: new Date(
        now.getTime() + 24 * 60 * 60 * 1000,
      ).toISOString(),
      state: ["queued", "sent", "delivered", "read", "not_started", "failed"].includes(
        conversation.state,
      )
        ? "engaged"
        : conversation.state,
      lead_score: Math.min(100, Math.max(conversation.lead_score, 15)),
      last_message_status: "received",
      last_error: null,
    };
    await admin
      .from("whatsapp_conversations")
      .update({
        wati_conversation_id: updatedConversation.wati_conversation_id,
        wati_ticket_id: updatedConversation.wati_ticket_id,
        last_inbound_at: updatedConversation.last_inbound_at,
        conversation_window_expires_at: updatedConversation.conversation_window_expires_at,
        state: updatedConversation.state,
        lead_score: updatedConversation.lead_score,
        last_message_status: "received",
        last_error: null,
      })
      .eq("id", conversation.id);

    if (employeeWatiEnabled) {
      await admin.from("whatsapp_jobs").upsert(
        {
          conversation_id: conversation.id,
          registration_id: conversation.registration_id,
          job_type: "process_inbound",
          payload: { message_id: message.id },
          dedupe_key: `inbound:${message.id}`,
        },
        { onConflict: "dedupe_key", ignoreDuplicates: true },
      );
    } else {
      await admin
        .from("whatsapp_conversations")
        .update({ bot_paused: true })
        .eq("id", conversation.id);
    }
    await recordActivity(updatedConversation);
  } else {
    const status = statusFromEvent(payload);
    const localMessageId = stringValue(payload.localMessageId);
    const whatsappMessageId = stringValue(payload.whatsappMessageId);
    const messageUpdates = {
      ...(status ? { status } : {}),
      ...(status === "sent" ? { sent_at: new Date().toISOString() } : {}),
      ...(status === "delivered" ? { delivered_at: new Date().toISOString() } : {}),
      ...(status === "read" ? { read_at: new Date().toISOString() } : {}),
      ...(status === "failed"
        ? {
            error_code: stringValue(payload.failedCode) || null,
            error_detail: stringValue(payload.failedDetail) || "Message delivery failed.",
          }
        : {}),
      ...(whatsappMessageId ? { whatsapp_message_id: whatsappMessageId } : {}),
    };
    if (localMessageId) {
      await admin
        .from("whatsapp_messages")
        .update(messageUpdates)
        .eq("wati_local_message_id", localMessageId);
    } else if (whatsappMessageId) {
      await admin
        .from("whatsapp_messages")
        .update(messageUpdates)
        .eq("whatsapp_message_id", whatsappMessageId);
    } else {
      const { data: latestOutbound } = await admin
        .from("whatsapp_messages")
        .select("id")
        .eq("conversation_id", conversation.id)
        .eq("direction", "outbound")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestOutbound) {
        await admin
          .from("whatsapp_messages")
          .update(messageUpdates)
          .eq("id", latestOutbound.id);
      }
    }

    if (status) {
      const nextState =
        status === "failed" && ["queued", "sent", "delivered", "read"].includes(conversation.state)
          ? "failed"
          : nextEarlyStage(conversation.state, status);
      const updatedConversation = {
        ...conversation,
        state: nextState,
        last_message_status: status,
        last_error:
          status === "failed"
            ? stringValue(payload.failedDetail) || "Message delivery failed."
            : null,
        wati_conversation_id:
          stringValue(payload.conversationId) || conversation.wati_conversation_id,
        wati_ticket_id: stringValue(payload.ticketId) || conversation.wati_ticket_id,
      };
      await admin
        .from("whatsapp_conversations")
        .update({
          state: updatedConversation.state,
          last_message_status: status,
          last_error: updatedConversation.last_error,
          wati_conversation_id: updatedConversation.wati_conversation_id,
          wati_ticket_id: updatedConversation.wati_ticket_id,
        })
        .eq("id", conversation.id);
      await recordActivity(updatedConversation);
    }
  }

  await admin
    .from("whatsapp_webhook_events")
    .update({ processed_at: new Date().toISOString(), processing_error: null })
    .eq("id", event.id);
  return { processed: true };
}

export async function POST(request: Request) {
  const secret = watiEnv().webhookSecret;
  if (!secret) {
    return NextResponse.json({ error: "WATI webhook is not configured." }, { status: 503 });
  }
  const provided =
    request.headers.get("x-wati-webhook-secret") ??
    new URL(request.url).searchParams.get("key") ??
    "";
  if (!provided || !safeEqual(provided, secret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const rawBody = await request.text();
  if (!rawBody || rawBody.length > 256_000) {
    return NextResponse.json({ error: "Invalid webhook body." }, { status: 400 });
  }
  let payload: WatiWebhook;
  try {
    payload = JSON.parse(rawBody) as WatiWebhook;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  try {
    const result = await processWebhook(payload, rawBody);
    after(async () => {
      await dispatchWhatsAppJobs({ limit: 10 });
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("WATI webhook processing failed", error);
    return NextResponse.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}
