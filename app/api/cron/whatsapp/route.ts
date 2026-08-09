import { NextResponse } from "next/server";
import { dispatchEmailJobs } from "@/lib/email/dispatch";
import { cronSecret } from "@/lib/env";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { dispatchWhatsAppJobs } from "@/lib/whatsapp/dispatch";

export const dynamic = "force-dynamic";

async function run(request: Request) {
  const configuredSecret = cronSecret();
  const authorization = request.headers.get("authorization") ?? "";
  if (!configuredSecret || authorization !== `Bearer ${configuredSecret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const [whatsapp, email, cleanup] = await Promise.allSettled([
      dispatchWhatsAppJobs({ limit: 50 }),
      dispatchEmailJobs({ limit: 50 }),
      createAdminSupabase().rpc("cleanup_communication_events", {
        p_webhook_retention_days: 30,
        p_activity_retention_days: 14,
      }),
    ]);
    const failures = [whatsapp, email, cleanup].filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    failures.forEach((failure) =>
      console.error("Communications cron dispatcher failed", failure.reason),
    );
    return NextResponse.json({
      whatsapp: whatsapp.status === "fulfilled" ? whatsapp.value : null,
      email: email.status === "fulfilled" ? email.value : null,
      cleanup: cleanup.status === "fulfilled" ? cleanup.value.data : null,
      failedDispatchers: failures.length,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Communications cron failed", error);
    return NextResponse.json({ error: "Communications dispatch failed." }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
