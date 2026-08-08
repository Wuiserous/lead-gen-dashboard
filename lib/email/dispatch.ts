import { randomUUID } from "node:crypto";
import { resendConfigured, resendEnv } from "@/lib/env";
import { createResend } from "@/lib/email/resend";
import {
  internalNewLeadEmail,
  studentRegistrationEmail,
  studentStatusEmail,
  type EmailRegistration,
  type EmailTemplate,
} from "@/lib/email/templates";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { validEmail } from "@/lib/validation";

type EmailJob = {
  id: string;
  registration_id: string;
  job_type: "student_registration" | "internal_new_lead" | "student_status";
  payload: Record<string, unknown>;
  dedupe_key: string;
  attempts: number;
  max_attempts: number;
};

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function uniqueEmails(values: Array<string | null | undefined>) {
  return [...new Set(
    values
      .map((value) => value?.trim().toLowerCase() ?? "")
      .filter((value) => value && validEmail(value)),
  )];
}

function errorText(error: unknown) {
  return (error instanceof Error ? error.message : "Unknown Resend error").slice(0, 2_000);
}

async function loadRegistration(job: EmailJob): Promise<EmailRegistration> {
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("registrations")
    .select(
      "id,name,phone,email,preferred_domain,status,credited_sales_id,ambassador:ambassadors(name,college,public_slug)",
    )
    .eq("id", job.registration_id)
    .maybeSingle();
  if (error || !data) throw new Error("The email job no longer has a registration.");

  const registration = data as unknown as {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    preferred_domain: string;
    status: string;
    credited_sales_id: string;
    ambassador: EmailRegistration["ambassador"] | EmailRegistration["ambassador"][];
  };
  const { data: employee, error: employeeError } = await admin
    .from("profiles")
    .select("full_name,email")
    .eq("id", registration.credited_sales_id)
    .maybeSingle();
  if (employeeError) throw new Error("Unable to load the assigned employee.");

  return {
    id: registration.id,
    name: registration.name,
    phone: registration.phone,
    email: registration.email,
    preferred_domain: registration.preferred_domain,
    status: registration.status,
    ambassador: firstRelation(registration.ambassador),
    employee: employee ?? null,
  };
}

function prepareEmail(job: EmailJob, registration: EmailRegistration) {
  const config = resendEnv();
  let recipients: string[] = [];
  let template: EmailTemplate;

  if (job.job_type === "internal_new_lead") {
    recipients = uniqueEmails([
      registration.employee?.email,
      ...config.adminRecipients,
    ]);
    template = internalNewLeadEmail(registration);
  } else if (job.job_type === "student_status") {
    recipients = uniqueEmails([registration.email]);
    template = studentStatusEmail(registration, String(job.payload.status ?? "follow_up"));
  } else {
    recipients = uniqueEmails([registration.email]);
    template = studentRegistrationEmail(registration);
  }

  return { recipients, template };
}

async function cancelJob(job: EmailJob, reason: string) {
  const admin = createAdminSupabase();
  await admin
    .from("email_jobs")
    .update({
      status: "cancelled",
      completed_at: new Date().toISOString(),
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

  const registration = await loadRegistration(job);
  const { recipients, template } = prepareEmail(job, registration);
  if (!recipients.length) {
    await cancelJob(job, "No valid recipient email is available.");
    return "cancelled" as const;
  }

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
      .update({
        recipients,
        subject: template.subject,
        status: "sending",
        last_error: null,
      })
      .eq("id", existing.id);
    if (error) throw new Error("Unable to prepare the local email record.");
  } else {
    const { error } = await admin.from("email_messages").insert({
      registration_id: job.registration_id,
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
