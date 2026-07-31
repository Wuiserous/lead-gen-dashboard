import { NextResponse } from "next/server";
import { requireApiProfile } from "@/lib/auth";
import { assertSameOrigin, errorResponse } from "@/lib/http";
import { createAdminSupabase } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return errorResponse("Invalid request.", 403);
  const profile = await requireApiProfile();
  if (!profile) return errorResponse("Unauthorized.", 401);

  const { error } = await createAdminSupabase()
    .from("profiles")
    .update({ must_change_password: false })
    .eq("id", profile.id);

  if (error) return errorResponse("Unable to finish password setup.", 500);
  return NextResponse.json({ ok: true });
}
