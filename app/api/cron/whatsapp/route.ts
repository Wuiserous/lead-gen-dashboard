import { NextResponse } from "next/server";
import { cronSecret } from "@/lib/env";
import { dispatchWhatsAppJobs } from "@/lib/whatsapp/dispatch";

export const dynamic = "force-dynamic";

async function run(request: Request) {
  const configuredSecret = cronSecret();
  const authorization = request.headers.get("authorization") ?? "";
  if (!configuredSecret || authorization !== `Bearer ${configuredSecret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const result = await dispatchWhatsAppJobs({ limit: 50 });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("WhatsApp cron failed", error);
    return NextResponse.json({ error: "WhatsApp dispatch failed." }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
