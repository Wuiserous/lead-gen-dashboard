import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentProfile();
  if (!user) {
    return NextResponse.json(
      { error: "This account is inactive or unavailable." },
      { status: 401 },
    );
  }
  return NextResponse.json({ user });
}
