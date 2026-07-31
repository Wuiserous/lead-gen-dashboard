import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/http";
import { createAdminSupabase } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ key: string }> },
) {
  const { key } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(key)) {
    return errorResponse("Progress link not found.", 404);
  }

  const admin = createAdminSupabase();
  const { data: progress } = await admin
    .from("ambassador_progress")
    .select(
      "ambassador_id,progress_key,registration_count,target,qualified,updated_at",
    )
    .eq("progress_key", key)
    .maybeSingle();
  if (!progress) return errorResponse("Progress link not found.", 404);

  const { data: ambassador } = await admin
    .from("ambassadors")
    .select("name,college,status")
    .eq("id", progress.ambassador_id)
    .maybeSingle();
  if (!ambassador) return errorResponse("Progress link not found.", 404);

  return NextResponse.json(
    { ...progress, ambassador },
    { headers: { "Cache-Control": "no-store" } },
  );
}
