import { randomUUID } from "node:crypto";
import { resendConfigured, resendEnv } from "@/lib/env";
import { createResend } from "@/lib/email/resend";
import {
  ambassadorMilestoneEmail,
  ambassadorWelcomeEmail,
  type EmailAmbassador,
  type EmailTemplate,
} from "@/lib/email/templates";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { validEmail } from "@/lib/validation";

type EmailJob = {
  id: string;
  registration_id: string | null;
  ambassador_id: string | null;
  job_type: "ambassador_welcome" | "ambassador_milestone";
  payload: Record<string, unknown>;
  dedupe_key: string;
  attempts: number;
  max_attempts: number;
};

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function errorText(error: unknown) {
  return (error instanceof Error ? error.message : "Unknown Resend error").slice(0, 2_000);
}

async function loadAmbassador(job: EmailJob): Promise<EmailAmbassador> {
  if (!job.ambassador_id) throw new Error("The email job has no Campus Ambassador.");
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("ambassadors")
    .select(
      "id,name,email,phone,college,city,course_year,public_slug,progress_key,target,sales_id,progress:ambassador_progress(registration_count,qualified)",
    )
    .eq("id", job.ambassador_id)
    .maybeSingle();
  if (error || !data) throw new Error("The email job no longer has a Campus Ambassador.");

  const ambassador = data as unknown as Omit<EmailAmbassador, "employee" | "registration_count" | "qualified"> & {
    sales_id: string;
    progress: { registration_count: number; qualified: boolean } | Array<{ registration_count: number; qualified: boolean }> | null;
  };
  const progress = firstRelation(ambassador.progress);
  const { data: employee, error: employeeError } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", ambassador.sales_id)
    .maybeSingle();
  if (employeeError) throw new Error("Unable to load the assigned employee.");

  return {
    id: ambassador.id,
    name: ambassador.name,
    email: ambassador.email,
    phone: ambassador.phone,
    college: ambassador.college,
    city: ambassador.city,
    course_year: ambassador.course_year,
    public_slug: ambassador.public_slug,
    progress_key: ambassador.progress_key,
    target: ambassador.target,
    registration_count: progress?.registration_count ?? 0,
    qualified: progress?.qualified ?? false,
    employee: employee ?? null,
  };
}

function prepareEmail(job: EmailJob, ambassador: EmailAmbassador): EmailTemplate {
  if (job.job_type === "ambassador_milestone") {
    const milestone = Number(job.payload.milestone) || ambassador.registration_count;
    const count = Number(job.payload.registration_count) || ambassador.registration_count;
    return ambassadorMilestoneEmail(ambassador, milestone, count);
  }
  return ambassadorWelcomeEmail(ambassador);
}

async function cancelJob(job: EmailJob, reason: string) {
  const admin = createAdminSupabase();
  await admin
    .from("email_jobs")
    .update({
      status: "cancelled",
      completed_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
      last_error: reason,
    })
    .eq("id", job.id);
}

async function markJobFailed(job: EmailJob, error: unknown) {
  const admin = createAdminSupabase();
  const finalAttempt = job.attempts >= job.max_attempts;
  const retryMinutes = [1, 5, 30, 120, 300][Math.max(0, job.attempts - 1)] ?? 300;
  await Promise.all([
    admin
      .from("email_jobs")
      .update({
        status: finalAttempt ? "failed" : "pending",
        scheduled_for: new Date(Date.now() + retryMinutes * 60_000).toISOString(),
        locked_at: null,
        locked_by: null,
        last_error: errorText(error),
      })
      .eq("id", job.id),
    admin
      .from("email_messages")
      .update({ status: "failed", last_error: errorText(error) })
      .eq("job_id", job.id),
  ]);
}

async function processEmailJob(job: EmailJob) {
  const admin = createAdminSupabase();
  const config = resendEnv();
  if (!config.fromEmail) throw new Error("RESEND_FROM_EMAIL is not configured.");
  if (!job.ambassador_id) {
    await cancelJob(job, "Legacy non-CA email job is no longer active.");
    return "cancelled" as const;
  }

  const ambassador = await loadAmbassador(job);
  const recipient = ambassador.email?.trim().toLowerCase() ?? "";
  if (!validEmail(recipient)) {
    await cancelJob(job, "No valid Campus Ambassador email is available.");
    return "cancelled" as const;
  }
  const template = prepareEmail(job, ambassador);
  const recipients = [recipient];

  const { data: existing, error: existingError } = await admin
    .from("email_messages")
    .select("id,status,resend_email_id")
    .eq("job_id", job.id)
    .maybeSingle();
  if (existingError) throw new Error("Unable to load the local email record.");
  if (
    existing &&
    existing.resend_email_id &&
    ["sent", "delivered", "opened", "clicked"].includes(existing.status)
  ) {
    await admin
      .from("email_jobs")
      .update({ status: "completed", completed_at: new Date().toISOString(), last_error: null })
      .eq("id", job.id);
    return "already_sent" as const;
  }

  if (existing) {
    const { error } = await admin
      .from("email_messages")
      .update({ recipients, subject: template.subject, status: "sending", last_error: null })
      .eq("id", existing.id);
    if (error) throw new Error("Unable to prepare the local email record.");
  } else {
    const { error } = await admin.from("email_messages").insert({
      registration_id: null,
      ambassador_id: job.ambassador_id,
      job_id: job.id,
      message_type: job.job_type,
      recipients,
      subject: template.subject,
      status: "sending",
    });
    if (error) throw new Error("Unable to create the local email record.");
  }

  const result = await createResend().emails.send(
    {
      from: config.fromEmail,
      to: recipients,
      replyTo: config.replyTo ?? undefined,
      subject: template.subject,
      html: template.html,
      text: template.text,
      tags: [
        { name: "job_id", value: job.id },
        { name: "message_type", value: job.job_type },
      ],
    },
    { idempotencyKey: `persevex-${job.id}` },
  );
  if (result.error || !result.data?.id) {
    throw new Error(result.error?.message ?? "Resend did not return an email ID.");
  }

  const now = new Date().toISOString();
  const [messageUpdate, jobUpdate] = await Promise.all([
    admin
      .from("email_messages")
      .update({
        resend_email_id: result.data.id,
        status: "sent",
        sent_at: now,
        last_event_at: now,
        last_error: null,
      })
      .eq("job_id", job.id),
    admin
      .from("email_jobs")
      .update({ status: "completed", completed_at: now, last_error: null })
      .eq("id", job.id),
  ]);
  if (messageUpdate.error || jobUpdate.error) {
    throw new Error("Resend accepted the email, but its local status could not be saved.");
  }
  return "sent" as const;
}

export async function dispatchEmailJobs(options?: { limit?: number }) {
  if (!resendConfigured()) {
    return { configured: false, claimed: 0, sent: 0, cancelled: 0, failed: 0 };
  }

  const admin = createAdminSupabase();
  const workerId = `email:${randomUUID()}`;
  const { data, error } = await admin.rpc("claim_email_jobs", {
    p_limit: Math.min(100, Math.max(1, options?.limit ?? 25)),
    p_worker_id: workerId,
  });
  if (error) throw new Error(`Unable to claim email jobs: ${error.message}`);

  const jobs = (data ?? []) as EmailJob[];
  let sent = 0;
  let cancelled = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      const result = await processEmailJob(job);
      if (result === "cancelled") cancelled += 1;
      else sent += 1;
    } catch (jobError) {
      failed += 1;
      await markJobFailed(job, jobError);
      console.error("Email dispatch failed", { jobId: job.id, error: errorText(jobError) });
    }
  }

  return { configured: true, claimed: jobs.length, sent, cancelled, failed };
}
