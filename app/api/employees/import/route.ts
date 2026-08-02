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

  const created: Array<{
    row: number;
    email: string;
    employee: Awaited<ReturnType<typeof createEmployee>>;
  }> = [];
  const errors: Array<{ row: number; error: string }> = [];

  const batchSize = 5;
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const results = await Promise.all(
      batch.map(async (row, batchIndex) => {
        const rowNumber = start + batchIndex + 2;
        try {
          const employee = await createEmployee(row, user.id);
          return { ok: true as const, row: rowNumber, employee };
        } catch (error) {
          return {
            ok: false as const,
            row: rowNumber,
            error: error instanceof Error ? error.message : "Import failed.",
          };
        }
      }),
    );
    results.forEach((result) => {
      if (result.ok) {
        created.push({
          row: result.row,
          email: result.employee.email,
          employee: result.employee,
        });
      } else {
        errors.push({ row: result.row, error: result.error });
      }
    });
  }

  return NextResponse.json(
    { created, errors },
    { status: created.length ? 200 : 400 },
  );
}
