import { NextResponse } from "next/server";
import { requireApiProfile } from "@/lib/auth";
import { assertSameOrigin, errorResponse } from "@/lib/http";
import { createAdminSupabase } from "@/lib/supabase/admin";
import {
  readWatiFallbackPolicy,
  recordWatiFallbackObservation,
  type WatiReplyMode,
} from "@/lib/whatsapp/fallback-circuit";

export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await requireApiProfile(["admin"]);
  if (!actor) return errorResponse("Unauthorized.", 401);

  try {
    return NextResponse.json(await readWatiFallbackPolicy());
  } catch {
    return errorResponse("Unable to load the WhatsApp reply engine.", 500);
  }
}

export async function PATCH(request: Request) {
  if (!assertSameOrigin(request)) return errorResponse("Invalid request.", 403);
  const actor = await requireApiProfile(["admin"]);
  if (!actor) return errorResponse("Unauthorized.", 401);

  const body = await request.json().catch(() => null) as { mode?: unknown } | null;
  const mode = body?.mode;
  if (mode !== "auto" && mode !== "wati" && mode !== "internal") {
    return errorResponse("Choose automatic, WATI only, or internal only.");
  }

  const admin = createAdminSupabase();
  const { error } = await admin.from("app_settings").upsert({
    key: "wati_reply_mode",
    value: mode satisfies WatiReplyMode,
    updated_by: actor.id,
    updated_at: new Date().toISOString(),
  });
  if (error) return errorResponse("Unable to update the WhatsApp reply engine.", 500);

  try {
    const policy = await recordWatiFallbackObservation("reset");
    await admin.from("activity_events").insert({
      event_type: "wati_reply_mode_updated",
      actor_id: actor.id,
    });
    return NextResponse.json(policy);
  } catch {
    return errorResponse("The reply mode changed, but its circuit could not be reset.", 500);
  }
}
