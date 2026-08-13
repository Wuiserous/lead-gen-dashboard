import { registrationRateLimitSecret } from "@/lib/env";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { cleanText, secureHash } from "@/lib/validation";

export const publicFunnelEventTypes = [
  "page_view",
  "form_open",
  "domain_selected",
] as const;

export type PublicFunnelEventType = (typeof publicFunnelEventTypes)[number];

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validTrackingUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

export function requestIpHash(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || "unknown";
  return secureHash(ip, registrationRateLimitSecret());
}

export async function recordFunnelEvent(input: {
  slug: unknown;
  visitorId: unknown;
  sessionId: unknown;
  eventId: unknown;
  eventType: string;
  domain?: unknown;
  creativeId?: unknown;
  registrationId?: string | null;
  metadata?: Record<string, unknown>;
  request: Request;
}) {
  if (
    !validTrackingUuid(input.visitorId) ||
    !validTrackingUuid(input.sessionId) ||
    !validTrackingUuid(input.eventId)
  ) {
    return { recorded: false, invalid: true } as const;
  }

  const slug = cleanText(input.slug, 100);
  if (!slug) return { recorded: false, invalid: true } as const;

  const { data, error } = await createAdminSupabase().rpc(
    "record_public_funnel_event",
    {
      p_slug: slug,
      p_visitor_id: input.visitorId,
      p_session_id: input.sessionId,
      p_event_id: input.eventId,
      p_event_type: input.eventType,
      p_domain: cleanText(input.domain, 100) || null,
      p_creative_id: cleanText(input.creativeId, 80) || null,
      p_registration_id: input.registrationId ?? null,
      p_ip_hash: requestIpHash(input.request),
      p_metadata: input.metadata ?? {},
    },
  );

  if (error) {
    if (error.message.includes("FUNNEL_RATE_LIMITED")) {
      return { recorded: false, rateLimited: true } as const;
    }
    if (error.message.includes("INVITATION_UNAVAILABLE")) {
      return { recorded: false, unavailable: true } as const;
    }
    throw error;
  }

  return { recorded: Boolean(data) } as const;
}
