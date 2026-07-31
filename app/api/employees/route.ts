import { NextResponse } from "next/server";
import { requireApiProfile } from "@/lib/auth";
import { createEmployee } from "@/lib/employees";
import { assertSameOrigin, errorResponse } from "@/lib/http";

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return errorResponse("Invalid request.", 403);
  const user = await requireApiProfile(["admin"]);
  if (!user) return errorResponse("Unauthorized.", 401);

  try {
    const employee = await createEmployee(await request.json(), user.id);
    return NextResponse.json({ employee }, { status: 201 });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Unable to create employee.",
      400,
    );
  }
}
