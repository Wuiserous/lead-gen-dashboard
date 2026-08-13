import { after, NextResponse } from "next/server";
import { dispatchEmailJobs } from "@/lib/email/dispatch";
import { registrationRateLimitSecret } from "@/lib/env";
import { isInternshipDomain } from "@/lib/domains";
import { errorResponse } from "@/lib/http";
import { createAdminSupabase } from "@/lib/supabase/admin";
import {
  cleanText,
  normalizeIndianPhone,
  secureHash,
} from "@/lib/validation";
import { dispatchWhatsAppJob } from "@/lib/whatsapp/dispatch";
import { recordFunnelEvent } from "@/lib/funnel-events";

export async function POST(request: Request) {
  const body = await request.json();
  if (body.website) return NextResponse.json({ registered: true });

  const slug = cleanText(body.slug, 100);
  const name = cleanText(body.name, 100);
  const phone = normalizeIndianPhone(body.phone);
  const domain = cleanText(body.domain, 100);
  if (!slug || name.length < 2 || !phone || !isInternshipDomain(domain)) {
    return errorResponse(
      "Enter your full name, a valid Indian mobile number, and select an internship domain.",
    );
  }

  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || "unknown";
  const secret = registrationRateLimitSecret();
  const ipHash = secureHash(ip, secret);
  const phoneHash = secureHash(phone, secret);
  const admin = createAdminSupabase();
  const tracking = body.tracking && typeof body.tracking === "object"
    ? body.tracking as Record<string, unknown>
    : null;
  if (tracking) {
    await recordFunnelEvent({
      slug,
      visitorId: tracking.visitorId,
      sessionId: tracking.sessionId,
      eventId: tracking.eventId,
      eventType: "registration_attempt",
      domain,
      creativeId: tracking.creativeId,
      request,
    }).catch((eventError) => {
      console.error("Unable to record registration attempt", eventError);
    });
  }
  const { data: attemptId, error: attemptError } = await admin.rpc(
    "reserve_registration_attempt",
    {
      p_slug: slug,
      p_ip_hash: ipHash,
      p_phone_hash: phoneHash,
    },
  );

  if (attemptError) {
    if (attemptError.message.includes("RATE_LIMITED")) {
      return errorResponse(
        "Too many registration attempts. Please try again shortly.",
        429,
      );
    }
    if (attemptError.message.includes("INVITATION_UNAVAILABLE")) {
      return errorResponse("This invitation is no longer active.", 404);
    }
    return errorResponse("Unable to complete registration right now.", 500);
  }

  const { data, error } = await admin.rpc("register_student", {
    p_slug: slug,
    p_name: name,
    p_phone: phone,
    p_email: "",
    p_domain: domain,
    p_ip_hash: ipHash,
    p_phone_hash: phoneHash,
    p_attempt_id: attemptId,
  });

  if (error) {
    if (error.message.includes("DUPLICATE_PHONE")) {
      return errorResponse(
        "This mobile number has already been registered with Persevex.",
        409,
      );
    }
    if (error.message.includes("RATE_LIMITED")) {
      return errorResponse(
        "Too many registration attempts. Please try again shortly.",
        429,
      );
    }
    if (error.message.includes("INVITATION_UNAVAILABLE")) {
      return errorResponse("This invitation is no longer active.", 404);
    }
    return errorResponse("Unable to complete registration right now.", 500);
  }

  if (tracking) {
    await recordFunnelEvent({
      slug,
      visitorId: tracking.visitorId,
      sessionId: tracking.sessionId,
      eventId: crypto.randomUUID(),
      eventType: "registration_completed",
      domain,
      creativeId: tracking.creativeId,
      registrationId: data,
      request,
    }).catch((eventError) => {
      console.error("Unable to record registration completion", eventError);
    });
  }

  const { data: queuedJob } = await admin
    .from("whatsapp_jobs")
    .select("id")
    .eq("registration_id", data)
    .eq("status", "pending")
    .limit(1)
    .maybeSingle();
  const whatsappQueued = Boolean(queuedJob?.id);

  after(async () => {
    const results = await Promise.allSettled([
      whatsappQueued
        ? dispatchWhatsAppJob(queuedJob!.id)
        : Promise.resolve(null),
      dispatchEmailJobs({ limit: 10 }),
    ]);
    for (const result of results) {
      if (result.status === "rejected") {
        console.error("Immediate communications dispatch failed", result.reason);
      }
    }
  });

  return NextResponse.json({
    registered: true,
    registrationId: data,
    whatsappQueued,
  });
}
