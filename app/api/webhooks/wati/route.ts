import { createHash, timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { watiEnv } from "@/lib/env";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { dispatchWhatsAppJob } from "@/lib/whatsapp/dispatch";
import {
  fallbackDelayMs as fallbackDelayForPolicy,
  readWatiFallbackPolicy,
} from "@/lib/whatsapp/fallback-circuit";
import { outboundBodiesMatch } from "@/lib/whatsapp/message-match";
import { deriveWatiLeadAnalytics } from "@/lib/whatsapp/lead-analytics";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type WatiWebhook = Record<string, unknown>;
type WebhookProcessResult = {
  duplicate?: boolean;
  ignored?: boolean;
  processed?: boolean;
  fallbackJobId?: string;
  fallbackDelayMs?: number;
};

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

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
  if (value.includes("replied")) return null;
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

function outboundMessageEvent(payload: WatiWebhook) {
  const eventType = stringValue(payload.eventType || payload.event_type).toLowerCase();
  if (eventType.includes("replied")) return false;
  return (
    payload.owner === true ||
    eventType.startsWith("sessionmessage") ||
    eventType.startsWith("templatemessage") ||
    eventType.startsWith("sentmessage")
  );
}

function payloadTimestamp(payload: WatiWebhook) {
  const created = stringValue(payload.created);
  if (created) {
    const parsed = Date.parse(created);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  const numericTimestamp = Number(payload.timestamp);
  if (Number.isFinite(numericTimestamp) && numericTimestamp > 0) {
    const milliseconds = numericTimestamp > 10_000_000_000
      ? numericTimestamp
      : numericTimestamp * 1_000;
    const parsed = new Date(milliseconds);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function outboundBody(payload: WatiWebhook) {
  const body = replyText(payload);
  if (body) return body;
  const data = payload.data;
  if (data && typeof data === "object") {
    const object = data as Record<string, unknown>;
    for (const key of ["caption", "body", "title", "fileName", "filename", "url"]) {
      const value = stringValue(object[key]).trim();
      if (value) return value;
    }
  }
  return null;
}

function outboundIntent(payload: WatiWebhook) {
  const eventType = stringValue(payload.eventType || payload.event_type).toLowerCase();
  if (stringValue(payload.chatbotTriggeredEventId)) return "wati_chatbot";
  if (eventType.startsWith("templatemessage")) return "wati_template";
  if (stringValue(payload.operatorEmail)) return "wati_operator";
  return "wati_outbound";
}

function advancedMessageStatus(current: string, candidate: string) {
  const rank: Record<string, number> = {
    queued: 0,
    sending: 1,
    sent: 2,
    delivered: 3,
    read: 4,
  };
  if (candidate === "failed") {
    return ["delivered", "read"].includes(current) ? current : candidate;
  }
  if (current === "failed") return candidate;
  return (rank[candidate] ?? -1) > (rank[current] ?? -1) ? candidate : current;
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

async function syncOutboundMessage(
  conversation: Record<string, unknown>,
  payload: WatiWebhook,
  status: string,
) {
  const admin = createAdminSupabase();
  const localMessageId = stringValue(payload.localMessageId) || null;
  const whatsappMessageId = stringValue(payload.whatsappMessageId) || null;
  const occurredAt = payloadTimestamp(payload);
  const body = outboundBody(payload);
  const messageType = stringValue(payload.type || "message").toLowerCase();
  const templateName = stringValue(payload.templateName) || null;

  let existing: { id: string; status: string; intent?: string | null } | null = null;
  if (localMessageId) {
    const { data, error } = await admin
      .from("whatsapp_messages")
      .select("id,status,intent")
      .eq("wati_local_message_id", localMessageId)
      .maybeSingle();
    if (error) throw new Error("Unable to match the WATI outbound message.");
    existing = data;
  }
  if (!existing && whatsappMessageId) {
    const { data, error } = await admin
      .from("whatsapp_messages")
      .select("id,status,intent")
      .eq("whatsapp_message_id", whatsappMessageId)
      .maybeSingle();
    if (error) throw new Error("Unable to match the WhatsApp outbound message.");
    existing = data;
  }
  if (!existing && (body || templateName)) {
    const occurredAtMs = Date.parse(occurredAt);
    const { data, error } = await admin
      .from("whatsapp_messages")
      .select("id,status,intent,body,template_name")
      .eq("conversation_id", conversation.id)
      .eq("direction", "outbound")
      .is("wati_local_message_id", null)
      .is("whatsapp_message_id", null)
      .gte("created_at", new Date(occurredAtMs - 15 * 60_000).toISOString())
      .lte("created_at", new Date(occurredAtMs + 2 * 60_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) throw new Error("Unable to reconcile the WATI outbound message.");
    const candidate = (data ?? []).find((message: {
      id: string;
      status: string;
      intent: string | null;
      body: string;
      template_name: string | null;
    }) =>
      templateName
        ? message.template_name === templateName
        : Boolean(body && outboundBodiesMatch(message.body, body)),
    );
    if (candidate) existing = {
      id: candidate.id,
      status: candidate.status,
      intent: candidate.intent,
    };
  }

  const finalStatus = existing
    ? advancedMessageStatus(existing.status, status)
    : status;
  const messageValues = {
    direction: "outbound",
    message_type: messageType,
    ...(body ? { body } : {}),
    ...(!existing ? { intent: outboundIntent(payload) } : {}),
    ...(templateName ? { template_name: templateName } : {}),
    ...(localMessageId ? { wati_local_message_id: localMessageId } : {}),
    ...(whatsappMessageId ? { whatsapp_message_id: whatsappMessageId } : {}),
    status: finalStatus,
    ...(status === "sent" ? { sent_at: occurredAt } : {}),
    ...(status === "delivered" ? { delivered_at: occurredAt } : {}),
    ...(status === "read" ? { read_at: occurredAt } : {}),
    ...(status === "failed"
      ? {
          error_code: stringValue(payload.failedCode) || null,
          error_detail:
            stringValue(payload.failedDetail) || "Message delivery failed.",
        }
      : { error_code: null, error_detail: null }),
  };

  if (existing) {
    const { error } = await admin
      .from("whatsapp_messages")
      .update(messageValues)
      .eq("id", existing.id);
    if (error) throw new Error("Unable to update the WATI outbound message.");
    return { occurredAt, status: finalStatus };
  }

  const { error } = await admin.from("whatsapp_messages").insert({
    conversation_id: conversation.id,
    registration_id: conversation.registration_id,
    ...messageValues,
    body: body ?? `[${messageType || "message"} message]`,
    sent_at: occurredAt,
    created_at: occurredAt,
  });
  if (error) {
    if (error.code === "23505") {
      return syncOutboundMessage(conversation, payload, status);
    }
    throw new Error("Unable to store the WATI outbound message.");
  }
  return { occurredAt, status: finalStatus };
}

async function processWebhook(
  payload: WatiWebhook,
  rawBody: string,
): Promise<WebhookProcessResult> {
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
  let fallbackJobId: string | null = null;
  let fallbackDelayMs = 0;

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
    const occurredAt = payloadTimestamp(payload);
    const lastInboundAt =
      !conversation.last_inbound_at ||
      Date.parse(occurredAt) > Date.parse(conversation.last_inbound_at)
        ? occurredAt
        : conversation.last_inbound_at;
    const { data: inboundMessage, error: messageError } = await admin
      .from("whatsapp_messages")
      .insert({
        conversation_id: conversation.id,
        registration_id: conversation.registration_id,
        direction: "inbound",
        message_type: messageType,
        body,
        whatsapp_message_id: whatsappMessageId,
        status: "received",
        sent_at: occurredAt,
        created_at: occurredAt,
      })
      .select("id")
      .single();
    if (messageError || !inboundMessage) {
      throw new Error("Unable to store the incoming WhatsApp message.");
    }

    const { data: inboundMessages, error: inboundMessagesError } = await admin
      .from("whatsapp_messages")
      .select("body")
      .eq("conversation_id", conversation.id)
      .eq("direction", "inbound")
      .order("sent_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });
    if (inboundMessagesError) {
      throw new Error("Unable to calculate the WhatsApp lead score.");
    }
    const analytics = deriveWatiLeadAnalytics(
      (inboundMessages ?? []).map((message: { body: string }) => message.body),
      conversation,
    );

    const updatedConversation = {
      ...conversation,
      ...analytics,
      wati_conversation_id:
        stringValue(payload.conversationId) || conversation.wati_conversation_id,
      wati_ticket_id: stringValue(payload.ticketId) || conversation.wati_ticket_id,
      last_inbound_at: lastInboundAt,
      conversation_window_expires_at: new Date(
        Date.parse(lastInboundAt) + 24 * 60 * 60 * 1000,
      ).toISOString(),
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
        urgency: updatedConversation.urgency,
        flow_step: updatedConversation.flow_step,
        study_stage: updatedConversation.study_stage,
        experience_level: updatedConversation.experience_level,
        primary_goal: updatedConversation.primary_goal,
        bot_paused: employeeWatiEnabled ? updatedConversation.bot_paused : true,
        last_message_status: "received",
        last_error: null,
      })
      .eq("id", conversation.id);

    if (employeeWatiEnabled && body) {
      const policy = await readWatiFallbackPolicy();
      const delayMs = fallbackDelayForPolicy(policy);
      if (policy.mode === "wati") {
        await recordActivity(updatedConversation);
        await admin
          .from("whatsapp_webhook_events")
          .update({ processed_at: new Date().toISOString(), processing_error: null })
          .eq("id", event.id);
        return { processed: true };
      }
      const scheduledFor = new Date(Date.now() + delayMs).toISOString();
      const { data: fallbackJob, error: fallbackJobError } = await admin
        .from("whatsapp_jobs")
        .insert({
          conversation_id: conversation.id,
          registration_id: conversation.registration_id,
          job_type: "process_inbound",
          payload: {
            inbound_message_id: inboundMessage.id,
            inbound_body: body,
            inbound_received_at: occurredAt,
            response_mode: "wati_native_fallback",
            reply_policy: policy.effectiveInternal ? "internal" : "observe_wati",
          },
          dedupe_key: `inbound-fallback:${inboundMessage.id}`,
          scheduled_for: scheduledFor,
          max_attempts: 5,
        })
        .select("id")
        .single();
      if (fallbackJobError || !fallbackJob) {
        throw new Error("Unable to schedule the WhatsApp fallback response.");
      }
      fallbackJobId = fallbackJob.id;
      fallbackDelayMs = delayMs;
    } else if (!employeeWatiEnabled) {
      await admin
        .from("whatsapp_conversations")
        .update({ bot_paused: true })
        .eq("id", conversation.id);
    }
    await recordActivity(updatedConversation);
  } else {
    const status = statusFromEvent(payload);
    if (status && outboundMessageEvent(payload)) {
      const syncedMessage = await syncOutboundMessage(conversation, payload, status);
      const messageStatus = syncedMessage.status;
      const nextState =
        messageStatus === "failed" && ["queued", "sent", "delivered", "read"].includes(conversation.state)
          ? "failed"
          : nextEarlyStage(conversation.state, messageStatus);
      const updatedConversation = {
        ...conversation,
        state: nextState,
        last_message_status: messageStatus,
        last_error:
          messageStatus === "failed"
            ? stringValue(payload.failedDetail) || "Message delivery failed."
            : null,
        wati_conversation_id:
          stringValue(payload.conversationId) || conversation.wati_conversation_id,
        wati_ticket_id: stringValue(payload.ticketId) || conversation.wati_ticket_id,
        last_outbound_at:
          !conversation.last_outbound_at ||
          Date.parse(syncedMessage.occurredAt) > Date.parse(conversation.last_outbound_at)
            ? syncedMessage.occurredAt
            : conversation.last_outbound_at,
      };
      await admin
        .from("whatsapp_conversations")
        .update({
          state: updatedConversation.state,
          last_message_status: updatedConversation.last_message_status,
          last_error: updatedConversation.last_error,
          wati_conversation_id: updatedConversation.wati_conversation_id,
          wati_ticket_id: updatedConversation.wati_ticket_id,
          last_outbound_at: updatedConversation.last_outbound_at,
        })
        .eq("id", conversation.id);
      await recordActivity(updatedConversation);
    }
  }

  await admin
    .from("whatsapp_webhook_events")
    .update({ processed_at: new Date().toISOString(), processing_error: null })
    .eq("id", event.id);
  return {
    processed: true,
    ...(fallbackJobId
      ? { fallbackJobId, fallbackDelayMs }
      : {}),
  };
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
    if (result.fallbackJobId) {
      const jobId = result.fallbackJobId;
      const delayMs = result.fallbackDelayMs ?? 5_000;
      after(async () => {
        try {
          await wait(delayMs);
          await dispatchWhatsAppJob(jobId);
        } catch (fallbackError) {
          // The durable pending job remains available to the cron/dashboard
          // workers even when this immediate attempt is interrupted.
          console.error("Immediate WhatsApp fallback dispatch failed", fallbackError);
        }
      });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("WATI webhook processing failed", error);
    return NextResponse.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}
