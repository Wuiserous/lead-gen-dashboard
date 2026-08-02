export type ReportingDateRange = "all" | "today" | "7d" | "30d";

const reportingTimeZone = "Asia/Kolkata";

function indiaCalendarParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: reportingTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value);

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
  };
}

export function reportingRangeStart(
  value: string | null,
  now = new Date(),
) {
  const daysBack =
    value === "today" ? 0 : value === "7d" ? 6 : value === "30d" ? 29 : null;
  if (daysBack === null) return null;

  const { year, month, day } = indiaCalendarParts(now);
  const indiaMidnightUtc = Date.UTC(year, month - 1, day) - 330 * 60 * 1000;
  return new Date(indiaMidnightUtc - daysBack * 86_400_000);
}

export function isWithinReportingRange(
  value: string,
  range: ReportingDateRange,
  now = new Date(),
) {
  if (range === "all") return true;
  const timestamp = Date.parse(value);
  const start = reportingRangeStart(range, now);
  return (
    Number.isFinite(timestamp) &&
    start !== null &&
    timestamp >= start.getTime() &&
    timestamp <= now.getTime()
  );
}
