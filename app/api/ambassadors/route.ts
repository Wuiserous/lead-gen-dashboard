import { after, NextResponse } from "next/server";
import { dispatchEmailJobs } from "@/lib/email/dispatch";
import { requireApiProfile } from "@/lib/auth";
import { assertSameOrigin, errorResponse } from "@/lib/http";
import { createAdminSupabase } from "@/lib/supabase/admin";
import {
  cleanText,
  createSlug,
  normalizeIndianPhone,
  validEmail,
} from "@/lib/validation";
import { canManageTeam, resolveOperationalTeam } from "@/lib/team-access";

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return errorResponse("Invalid request.", 403);
  const user = await requireApiProfile(["sales", "team_lead"]);
  if (!user) return errorResponse("Unauthorized.", 401);
  const body = await request.json();
  const requestedTeamId = cleanText(body.teamId, 80) || null;
  const teamId = resolveOperationalTeam(user, requestedTeamId);
  if (!teamId) return errorResponse("No team is assigned.", 409);
  if (!canManageTeam(user, teamId)) return errorResponse("Unauthorized.", 403);
  const name = cleanText(body.name, 100);
  const email = cleanText(body.email, 254).toLowerCase();
  const phone = normalizeIndianPhone(body.phone);
  const college = cleanText(body.college, 150);
  const city = cleanText(body.city, 100);
  const courseYear = cleanText(body.courseYear, 120);
  if (name.length < 2 || !validEmail(email) || !phone || college.length < 2) {
    return errorResponse(
      "Name, valid email, valid Indian phone number, and college are required.",
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
      team_id: teamId,
      name,
      email,
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
    team_id: teamId,
    sales_id: user.id,
    ambassador_id: data.id,
    entity_id: data.id,
  });

  after(async () => {
    try {
      await dispatchEmailJobs({ limit: 10 });
    } catch (dispatchError) {
      console.error("Immediate CA welcome email dispatch failed", dispatchError);
    }
  });

  return NextResponse.json({ ambassador: data }, { status: 201 });
}
