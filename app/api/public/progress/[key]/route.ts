import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/http";
import { createAdminSupabase } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ key: string }> },
) {
  const { key } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(key)) {
    return errorResponse("Progress link not found.", 404);
  }

  const admin = createAdminSupabase();
  const requestedLimit = Number(new URL(request.url).searchParams.get("limit"));
  const limit = Math.min(500, Math.max(50, requestedLimit || 50));
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

  const [registrationResult, convertedResult] = await Promise.all([
    admin
      .from("registrations")
      .select("id,name,preferred_domain,status,created_at,updated_at", {
        count: "exact",
      })
      .eq("ambassador_id", progress.ambassador_id)
      .neq("status", "invalid")
      .order("created_at", { ascending: false })
      .range(0, limit - 1),
    admin
      .from("registrations")
      .select("id", { count: "exact", head: true })
      .eq("ambassador_id", progress.ambassador_id)
      .eq("status", "converted"),
  ]);
  if (registrationResult.error || convertedResult.error) {
    return errorResponse("Unable to load registrations.", 500);
  }

  return NextResponse.json(
    {
      ...progress,
      ambassador,
      registrations: registrationResult.data ?? [],
      registration_total: registrationResult.count ?? 0,
      converted_count: convertedResult.count ?? 0,
      visible_limit: limit,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
