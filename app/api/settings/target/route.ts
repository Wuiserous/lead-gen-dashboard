import { NextResponse } from "next/server";
import { requireApiProfile } from "@/lib/auth";
import { assertSameOrigin, errorResponse } from "@/lib/http";
import { createAdminSupabase } from "@/lib/supabase/admin";

export async function PATCH(request: Request) {
  if (!assertSameOrigin(request)) return errorResponse("Invalid request.", 403);
  const actor = await requireApiProfile(["admin"]);
  if (!actor) return errorResponse("Unauthorized.", 401);

  const body = await request.json();
  const target = Number(body.target);
  if (!Number.isInteger(target) || target < 1 || target > 10000) {
    return errorResponse("Target must be a whole number between 1 and 10,000.");
  }

  const admin = createAdminSupabase();
  const { error } = await admin
    .from("app_settings")
    .upsert({
      key: "default_ambassador_target",
      value: target,
      updated_by: actor.id,
      updated_at: new Date().toISOString(),
    });
  if (error) return errorResponse("Unable to update the target.", 500);

  await admin.from("activity_events").insert({
    event_type: "settings_updated",
    actor_id: actor.id,
  });

  return NextResponse.json({ target });
}
