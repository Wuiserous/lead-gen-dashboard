import { NextResponse } from "next/server";
import {
  publicFunnelEventTypes,
  recordFunnelEvent,
} from "@/lib/funnel-events";
import { assertSameOrigin, errorResponse } from "@/lib/http";

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return errorResponse("Invalid request.", 403);

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || !publicFunnelEventTypes.includes(body.eventType as never)) {
    return errorResponse("Invalid analytics event.");
  }

  try {
    const result = await recordFunnelEvent({
      slug: body.slug,
      visitorId: body.visitorId,
      sessionId: body.sessionId,
      eventId: body.eventId,
      eventType: body.eventType as string,
      domain: body.domain,
      creativeId: body.creativeId,
      request,
    });
    if (result.invalid) return errorResponse("Invalid analytics event.");
    return NextResponse.json({ recorded: result.recorded });
  } catch (error) {
    console.error("Unable to record funnel event", error);
    return NextResponse.json({ recorded: false });
  }
}
