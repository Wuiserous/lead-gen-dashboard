import { randomUUID } from "node:crypto";
import { mapWithConcurrency } from "@/lib/concurrency";
import { watiConfigured, watiEnv } from "@/lib/env";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { nextWhatsAppFlow, type FlowResult } from "@/lib/whatsapp/flow";
import {
  readWatiFallbackPolicy,
  recordWatiFallbackObservation,
} from "@/lib/whatsapp/fallback-circuit";
import {
  sendWatiButtons,
  sendWatiList,
  sendWatiTemplate,
  sendWatiText,
  WatiApiError,
} from "@/lib/whatsapp/wati";

type WhatsAppJob = {
  id: string;
  conversation_id: string;
  registration_id: string;
  job_type: string;
  payload: Record<string, unknown>;
  dedupe_key: string;
  attempts: number;
  max_attempts: number;
};

type Conversation = {
  id: string;
  registration_id: string;
  ambassador_id: string;
  assigned_sales_id: string;
  team_id: string;
  wa_id: string;
  wati_conversation_id: string | null;
  wati_ticket_id: string | null;
  state: string;
  flow_step: string;
  lead_score: number;
  bot_paused: boolean;
  unknown_reply_count: number;
  opted_in_at: string | null;
  opted_out_at: string | null;
  conversation_window_expires_at: string | null;
};

type RegistrationContext = {
  id: string;
  name: string;
  phone: string;
  preferred_domain: string;
  credited_sales_id: string;
  credited_team_id: string;
  owner_sales_id: string;
  owner_team_id: string;
  ambassador_id: string;
  ambassador: { name: string } | Array<{ name: string }> | null;
};

type SendResult = {
  localMessageId: string | null;
  whatsappMessageId: string | null;
  conversationId: string | null;
  ticketId: string | null;
};

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function errorText(error: unknown) {
  if (error instanceof WatiApiError) {
    return `${error.message}${error.status ? ` (HTTP ${error.status})` : ""}`.slice(0, 2_000);
  }
  return (error instanceof Error ? error.message : "Unknown WhatsApp error").slice(0, 2_000);
}

async function loadJobContext(job: WhatsAppJob) {
  const admin = createAdminSupabase();
  const [conversationResult, registrationResult] = await Promise.all([
    admin.from("whatsapp_conversations").select("*").eq("id", job.conversation_id).maybeSingle(),
    admin
      .from("registrations")
      .select(
        "id,name,phone,preferred_domain,credited_sales_id,credited_team_id,owner_sales_id,owner_team_id,ambassador_id,ambassador:ambassadors(name)",
      )
      .eq("id", job.registration_id)
      .maybeSingle(),
  ]);
  if (conversationResult.error || registrationResult.error) {
    throw new Error("Unable to load the WhatsApp job context.");
  }
  if (!conversationResult.data || !registrationResult.data) {
    throw new Error("The WhatsApp job no longer has a registration.");
  }
  const conversation = conversationResult.data as Conversation;
  const { data: employee, error: employeeError } = await admin
    .from("profiles")
    .select("active,wati_enabled")
    .eq("id", conversation.assigned_sales_id)
    .maybeSingle();
  if (employeeError || !employee) {
    throw new Error("The assigned employee is unavailable for WhatsApp.");
  }
  return {
    conversation,
    registration: registrationResult.data as unknown as RegistrationContext,
    employeeWatiEnabled: Boolean(employee.active && employee.wati_enabled),
  };
}

async function createOutboundMessage(
  job: WhatsAppJob,
  input: { body: string; messageType: string; templateName?: string; intent?: string },
) {
  const admin = createAdminSupabase();
  const { data: existing } = await admin
    .from("whatsapp_messages")
    .select("id,status")
    .eq("job_id", job.id)
    .maybeSingle();

  if (existing && ["sending", "sent", "delivered", "read"].includes(existing.status)) {
    return { id: existing.id as string, alreadyAttempted: true };
  }

  if (existing) {
    const { data, error } = await admin
      .from("whatsapp_messages")
      .update({
        status: "sending",
        body: input.body,
        message_type: input.messageType,
        template_name: input.templateName ?? null,
        intent: input.intent ?? null,
        error_detail: null,
      })
      .eq("id", existing.id)
      .select("id")
      .single();
    if (error) throw new Error("Unable to prepare the WhatsApp message.");
    return { id: data.id as string, alreadyAttempted: false };
  }

  const { data, error } = await admin
    .from("whatsapp_messages")
    .insert({
      conversation_id: job.conversation_id,
      registration_id: job.registration_id,
      job_id: job.id,
      direction: "outbound",
      message_type: input.messageType,
      body: input.body,
      template_name: input.templateName ?? null,
      intent: input.intent ?? null,
      status: "sending",
    })
    .select("id")
    .single();
  if (error) throw new Error("Unable to prepare the WhatsApp message.");
  return { id: data.id as string, alreadyAttempted: false };
}

async function markMessageSent(
  messageId: string,
  conversation: Conversation,
  result: SendResult,
) {
  const admin = createAdminSupabase();
  const now = new Date().toISOString();
  const [messageUpdate, conversationUpdate] = await Promise.all([
    admin
      .from("whatsapp_messages")
      .update({
        status: "sent",
        wati_local_message_id: result.localMessageId,
        whatsapp_message_id: result.whatsappMessageId,
        sent_at: now,
      })
      .eq("id", messageId),
    admin
      .from("whatsapp_conversations")
      .update({
        last_outbound_at: now,
        last_message_status: "sent",
        wati_conversation_id: result.conversationId ?? conversation.wati_conversation_id,
        wati_ticket_id: result.ticketId ?? conversation.wati_ticket_id,
        last_error: null,
        state: conversation.state === "queued" ? "sent" : conversation.state,
      })
      .eq("id", conversation.id),
  ]);
  if (messageUpdate.error || conversationUpdate.error) {
    throw new Error("WATI sent the message, but its local status could not be saved.");
  }
}

async function markMessageFailed(jobId: string, error: unknown) {
  const admin = createAdminSupabase();
  await admin
    .from("whatsapp_messages")
    .update({ status: "failed", error_detail: errorText(error) })
    .eq("job_id", jobId);
}

async function scheduleWelcomeReminders(job: WhatsAppJob) {
  const admin = createAdminSupabase();
  const now = Date.now();
  await admin.from("whatsapp_jobs").upsert(
    [
      {
        conversation_id: job.conversation_id,
        registration_id: job.registration_id,
        job_type: "send_template",
        payload: { template_key: "reminder" },
        dedupe_key: `welcome-reminder:${job.registration_id}`,
        scheduled_for: new Date(now + 4 * 60 * 60 * 1000).toISOString(),
      },
      {
        conversation_id: job.conversation_id,
        registration_id: job.registration_id,
        job_type: "send_template",
        payload: { template_key: "final_reminder" },
        dedupe_key: `welcome-final:${job.registration_id}`,
        scheduled_for: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
      },
    ],
    { onConflict: "dedupe_key", ignoreDuplicates: true },
  );
}

async function sendTemplateJob(
  job: WhatsAppJob,
  conversation: Conversation,
  registration: RegistrationContext,
) {
  const templateKey = String(job.payload.template_key ?? "welcome");
  if (!conversation.opted_in_at || conversation.opted_out_at) return;
  if (
    templateKey !== "welcome" &&
    (conversation.bot_paused ||
      ["engaged", "qualifying", "qualified", "advisor_requested", "enrollment_ready", "converted", "not_interested", "opted_out"].includes(conversation.state))
  ) {
    return;
  }

  const config = watiEnv();
  const templateName =
    templateKey === "welcome"
      ? config.welcomeTemplate
      : templateKey === "final_reminder"
        ? config.finalReminderTemplate
        : config.reminderTemplate;
  const body =
    templateKey === "welcome"
      ? `Registration acknowledgement for ${registration.name} (${registration.preferred_domain})`
      : `Internship enquiry reminder for ${registration.name}`;
  const prepared = await createOutboundMessage(job, {
    body,
    messageType: "template",
    templateName,
    intent: templateKey,
  });
  if (prepared.alreadyAttempted) return;

  const ambassador = firstRelation(registration.ambassador);
  const result = await sendWatiTemplate({
    phone: registration.phone,
    templateName,
    broadcastName: `persevex_${templateKey}_${job.id.slice(0, 8)}`,
    parameters:
      templateKey === "welcome"
        ? [
            { name: "name", value: registration.name },
            { name: "domain", value: registration.preferred_domain },
            {
              name: "ambassador_name",
              value: ambassador?.name ?? "your campus representative",
            },
          ]
        : [
            { name: "name", value: registration.name },
            { name: "domain", value: registration.preferred_domain },
          ],
  });
  await markMessageSent(prepared.id, conversation, result);

  if (templateKey === "welcome") {
    await scheduleWelcomeReminders(job);
  }
}

async function sendManualTextJob(
  job: WhatsAppJob,
  conversation: Conversation,
  registration: RegistrationContext,
) {
  if (
    !conversation.conversation_window_expires_at ||
    Date.parse(conversation.conversation_window_expires_at) <= Date.now()
  ) {
    throw new WatiApiError("The 24-hour WhatsApp session has expired.", 400, false);
  }
  const body = String(job.payload.message ?? "").trim();
  if (!body) throw new WatiApiError("The WhatsApp message is empty.", 400, false);
  const prepared = await createOutboundMessage(job, {
    body,
    messageType: "text",
    intent: "manual_reply",
  });
  if (prepared.alreadyAttempted) return;
  const result = await sendWatiText(registration.phone, body);
  await markMessageSent(prepared.id, conversation, result);
}

const fallbackConversationColumns = new Set([
  "unknown_reply_count",
  "opted_out_at",
  "follow_up_at",
]);

function safeFallbackUpdates(result: FlowResult) {
  return Object.fromEntries(
    Object.entries(result.updates).filter(([key]) =>
      fallbackConversationColumns.has(key),
    ),
  );
}

async function nativeReplyAlreadyHandled(
  conversationId: string,
  inboundMessageId: string,
) {
  const admin = createAdminSupabase();
  const { data: inbound, error: inboundError } = await admin
    .from("whatsapp_messages")
    .select("id,body,created_at,sent_at")
    .eq("id", inboundMessageId)
    .eq("conversation_id", conversationId)
    .eq("direction", "inbound")
    .maybeSingle();
  if (inboundError) throw new Error("Unable to inspect the inbound WhatsApp message.");
  if (!inbound) {
    throw new WatiApiError("The inbound WhatsApp message no longer exists.", 404, false);
  }

  const receivedAt = inbound.sent_at ?? inbound.created_at;
  const [newerInboundResult, outboundResult] = await Promise.all([
    admin
      .from("whatsapp_messages")
      .select("id")
      .eq("conversation_id", conversationId)
      .eq("direction", "inbound")
      .gt("created_at", inbound.created_at)
      .limit(1)
      .maybeSingle(),
    admin
      .from("whatsapp_messages")
      .select("id")
      .eq("conversation_id", conversationId)
      .eq("direction", "outbound")
      .in("status", ["sending", "sent", "delivered", "read"])
      .gt("created_at", receivedAt)
      .limit(1)
      .maybeSingle(),
  ]);
  if (newerInboundResult.error || outboundResult.error) {
    throw new Error("Unable to verify the WATI native response.");
  }

  return {
    inboundBody: String(inbound.body ?? ""),
    handled: Boolean(newerInboundResult.data || outboundResult.data),
  };
}

async function cancelPendingAutomation(
  job: WhatsAppJob,
  result: FlowResult,
) {
  if (!result.cancelPending) return;
  await createAdminSupabase()
    .from("whatsapp_jobs")
    .update({
      status: "cancelled",
      completed_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
      last_error: "Cancelled after the student replied.",
    })
    .eq("conversation_id", job.conversation_id)
    .eq("status", "pending")
    .eq("job_type", "send_template");
}

async function sendInboundFallbackJob(
  job: WhatsAppJob,
  conversation: Conversation,
  registration: RegistrationContext,
) {
  if (job.payload.response_mode !== "wati_native_fallback") {
    // Drain process_inbound jobs created by older application versions
    // without reviving the retired always-on internal responder.
    return;
  }
  const inboundMessageId = String(job.payload.inbound_message_id ?? "").trim();
  if (!inboundMessageId) {
    throw new WatiApiError("The fallback job has no inbound message.", 400, false);
  }

  const check = await nativeReplyAlreadyHandled(conversation.id, inboundMessageId);
  const flow = nextWhatsAppFlow(
    {
      conversation,
      name: registration.name,
      domain: registration.preferred_domain,
    },
    check.inboundBody,
  );
  const recognized = flow.recognized !== false;
  const policy = await readWatiFallbackPolicy();

  if (check.handled) {
    if (recognized && policy.mode === "auto") {
      await recordWatiFallbackObservation("hit");
    }
    return;
  }
  if (policy.mode === "wati") return;
  if (recognized && policy.mode === "auto" && !policy.effectiveInternal) {
    await recordWatiFallbackObservation("miss");
  }

  const prepared = await createOutboundMessage(job, {
    body: flow.message.body,
    messageType: flow.message.kind,
    intent: "internal_fallback",
  });
  if (prepared.alreadyAttempted) return;

  const result = flow.message.kind === "buttons"
    ? await sendWatiButtons({
        target: registration.phone,
        header: flow.message.header,
        body: flow.message.body,
        buttons: flow.message.buttons,
      })
    : flow.message.kind === "list"
      ? await sendWatiList({
          target: registration.phone,
          header: flow.message.header,
          body: flow.message.body,
          buttonText: flow.message.buttonText,
          sectionTitle: flow.message.sectionTitle,
          rows: flow.message.rows,
        })
      : await sendWatiText(registration.phone, flow.message.body);

  await markMessageSent(prepared.id, conversation, result);
  const updates = safeFallbackUpdates(flow);
  if (Object.keys(updates).length) {
    const { error } = await createAdminSupabase()
      .from("whatsapp_conversations")
      .update(updates)
      .eq("id", conversation.id);
    if (error) {
      // The reply has already left WATI. Do not retry and risk sending it
      // twice merely because a non-critical local flow-field update failed.
      console.error("Unable to save non-critical WhatsApp fallback flow fields", error);
    }
  }
  await cancelPendingAutomation(job, flow);
}

async function executeJob(job: WhatsAppJob) {
  const { conversation, registration, employeeWatiEnabled } = await loadJobContext(job);
  if (!employeeWatiEnabled) {
    await createAdminSupabase()
      .from("whatsapp_conversations")
      .update({ bot_paused: true })
      .eq("id", conversation.id);
    return;
  }
  if (job.job_type === "send_template") {
    await sendTemplateJob(job, conversation, registration);
  } else if (job.job_type === "process_inbound") {
    await sendInboundFallbackJob(job, conversation, registration);
  } else if (job.job_type === "manual_text") {
    await sendManualTextJob(job, conversation, registration);
  } else {
    throw new Error(`Unsupported WhatsApp job type: ${job.job_type}`);
  }
}

async function completeJob(job: WhatsAppJob) {
  const admin = createAdminSupabase();
  await admin
    .from("whatsapp_jobs")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
      last_error: null,
    })
    .eq("id", job.id);
}

async function failJob(job: WhatsAppJob, error: unknown) {
  const admin = createAdminSupabase();
  const attempts = job.attempts + 1;
  const retryable = !(error instanceof WatiApiError) || error.retryable;
  const willRetry = retryable && attempts < job.max_attempts;
  const exponentialDelayMs = job.job_type === "process_inbound"
    ? [10_000, 30_000, 60_000, 5 * 60_000][Math.min(attempts - 1, 3)]
    : Math.min(60, 2 ** attempts) * 60_000;
  const retryDelayMs =
    error instanceof WatiApiError && error.retryAfterMs !== null
      ? Math.max(exponentialDelayMs, error.retryAfterMs)
      : exponentialDelayMs;
  await Promise.all([
    admin
      .from("whatsapp_jobs")
      .update({
        attempts,
        status: willRetry ? "pending" : "failed",
        scheduled_for: willRetry
          ? new Date(Date.now() + retryDelayMs).toISOString()
          : new Date().toISOString(),
        locked_at: null,
        locked_by: null,
        last_error: errorText(error),
      })
      .eq("id", job.id),
    admin
      .from("whatsapp_conversations")
      .update({ last_error: errorText(error), ...(willRetry ? {} : { state: "failed" }) })
      .eq("id", job.conversation_id),
    markMessageFailed(job.id, error),
  ]);
}

export async function dispatchWhatsAppJobs(options?: { limit?: number }) {
  if (!watiConfigured()) {
    return { configured: false, claimed: 0, completed: 0, failed: 0 };
  }

  const admin = createAdminSupabase();
  const workerId = `next:${randomUUID()}`;
  const { data, error } = await admin.rpc("claim_whatsapp_jobs", {
    p_limit: Math.min(50, Math.max(1, options?.limit ?? 10)),
    p_worker_id: workerId,
  });
  if (error) throw new Error("Unable to claim WhatsApp jobs.");
  const jobs = (data ?? []) as WhatsAppJob[];
  const outcomes = await mapWithConcurrency(
    jobs,
    watiEnv().dispatchConcurrency,
    async (job) => {
      try {
        await executeJob(job);
        await completeJob(job);
        return "completed" as const;
      } catch (jobError) {
        await failJob(job, jobError);
        return "failed" as const;
      }
    },
  );
  const completed = outcomes.filter((outcome) => outcome === "completed").length;
  const failed = outcomes.length - completed;

  return { configured: true, claimed: jobs.length, completed, failed };
}

export async function dispatchWhatsAppJob(jobId: string) {
  if (!watiConfigured()) {
    return { configured: false, claimed: 0, completed: 0, failed: 0 };
  }

  const admin = createAdminSupabase();
  const workerId = `immediate:${randomUUID()}`;
  const { data, error } = await admin
    .from("whatsapp_jobs")
    .update({
      status: "processing",
      locked_at: new Date().toISOString(),
      locked_by: workerId,
    })
    .eq("id", jobId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();

  if (error) throw new Error("Unable to claim the immediate WhatsApp job.");
  if (!data) {
    // Another worker already claimed or completed this job.
    return { configured: true, claimed: 0, completed: 0, failed: 0 };
  }

  const job = data as WhatsAppJob;
  try {
    await executeJob(job);
    await completeJob(job);
    return { configured: true, claimed: 1, completed: 1, failed: 0 };
  } catch (jobError) {
    await failJob(job, jobError);
    return { configured: true, claimed: 1, completed: 0, failed: 1 };
  }
}
