import { NextResponse } from "next/server";
import { requireApiProfile } from "@/lib/auth";
import { createEmployee, type EmployeeInput } from "@/lib/employees";
import { assertSameOrigin, errorResponse } from "@/lib/http";

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return errorResponse("Invalid request.", 403);
  const user = await requireApiProfile(["admin"]);
  if (!user) return errorResponse("Unauthorized.", 401);

  const body = (await request.json()) as { rows?: EmployeeInput[] };
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 200) : [];
  if (!rows.length) return errorResponse("Upload at least one employee row.");

  const created: Array<{ row: number; email: string }> = [];
  const errors: Array<{ row: number; error: string }> = [];

  for (let index = 0; index < rows.length; index += 1) {
    try {
      const employee = await createEmployee(rows[index], user.id);
      created.push({ row: index + 2, email: employee.email });
    } catch (error) {
      errors.push({
        row: index + 2,
        error: error instanceof Error ? error.message : "Import failed.",
      });
    }
  }

  return NextResponse.json(
    { created, errors },
    { status: created.length ? 200 : 400 },
  );
}
