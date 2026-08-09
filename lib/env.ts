function required(value: string | undefined, name: string) {
  value = value?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

export function publicSupabaseEnv() {
  return {
    url: required(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      "NEXT_PUBLIC_SUPABASE_URL",
    ),
    publishableKey: required(
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    ),
  };
}

export function serverSupabaseEnv() {
  return {
    ...publicSupabaseEnv(),
    secretKey: required(process.env.SUPABASE_SECRET_KEY, "SUPABASE_SECRET_KEY"),
  };
}

export function registrationRateLimitSecret() {
  return (
    process.env.REGISTRATION_RATE_LIMIT_SECRET?.trim() ||
    serverSupabaseEnv().secretKey
  );
}

function optional(value: string | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

export function watiEnv() {
  return {
    endpoint: optional(process.env.WATI_API_ENDPOINT)?.replace(/\/$/, "") ?? null,
    token: optional(process.env.WATI_API_TOKEN),
    channel: optional(process.env.WATI_CHANNEL),
    apiVersion: optional(process.env.WATI_API_VERSION) === "v3" ? "v3" : "v1",
    webhookSecret: optional(process.env.WATI_WEBHOOK_SECRET),
    welcomeTemplate:
      optional(process.env.WATI_WELCOME_TEMPLATE) ?? "persevex_lead_welcome_v1",
    reminderTemplate:
      optional(process.env.WATI_REMINDER_TEMPLATE) ?? "persevex_lead_reminder_v1",
    finalReminderTemplate:
      optional(process.env.WATI_FINAL_REMINDER_TEMPLATE) ??
      "persevex_lead_final_reminder_v1",
  };
}

export function watiConfigured() {
  const config = watiEnv();
  return Boolean(config.endpoint && config.token);
}

export function cronSecret() {
  return optional(process.env.CRON_SECRET);
}

export function resendEnv() {
  return {
    apiKey: optional(process.env.RESEND_API_KEY),
    fromEmail: optional(process.env.RESEND_FROM_EMAIL),
    replyTo: optional(process.env.RESEND_REPLY_TO),
    webhookSecret: optional(process.env.RESEND_WEBHOOK_SECRET),
  };
}

export function resendConfigured() {
  const config = resendEnv();
  return Boolean(config.apiKey && config.fromEmail);
}
