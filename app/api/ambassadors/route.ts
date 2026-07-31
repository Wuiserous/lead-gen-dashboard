import { NextResponse } from "next/server";
import { requireApiProfile } from "@/lib/auth";
import { assertSameOrigin, errorResponse } from "@/lib/http";
import { createAdminSupabase } from "@/lib/supabase/admin";
import {
  cleanText,
  createSlug,
  normalizeIndianPhone,
} from "@/lib/validation";

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return errorResponse("Invalid request.", 403);
  const user = await requireApiProfile(["sales", "team_lead"]);
  if (!user) return errorResponse("Unauthorized.", 401);
  if (!user.team_id) return errorResponse("No team is assigned.", 409);

  const body = await request.json();
  const name = cleanText(body.name, 100);
  const phone = normalizeIndianPhone(body.phone);
  const college = cleanText(body.college, 150);
  const city = cleanText(body.city, 100);
  const courseYear = cleanText(body.courseYear, 120);
  if (name.length < 2 || !phone || college.length < 2) {
    return errorResponse(
      "Name, valid Indian phone number, and college are required.",
    );
  }

  const admin = createAdminSupabase();
  const { data: setting } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "default_ambassador_target")
    .maybeSingle();
  const target = Number(setting?.value ?? 30);

  const { data, error } = await admin
    .from("ambassadors")
    .insert({
      sales_id: user.id,
      team_id: user.team_id,
      name,
      phone,
      college,
      city,
      course_year: courseYear,
      public_slug: createSlug(name, college),
      target,
    })
    .select("*")
    .single();

  if (error || !data) {
    return errorResponse("Unable to create the Campus Ambassador.", 500);
  }

  await admin.from("activity_events").insert({
    event_type: "ambassador_created",
    actor_id: user.id,
    team_id: user.team_id,
    sales_id: user.id,
    ambassador_id: data.id,
    entity_id: data.id,
  });

  return NextResponse.json({ ambassador: data }, { status: 201 });
}
