"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Download,
  Eye,
  Filter,
  MessageCircle,
  RefreshCw,
  Target,
  UserCheck,
} from "lucide-react";
import type {
  AdminFunnelAnalytics,
  FunnelBreakdownRow,
  FunnelInsight,
} from "@/lib/types";

type DateRange = "today" | "7d" | "30d" | "all";
type Breakdown = "executives" | "ambassadors" | "teams";

function pct(numerator: number, denominator: number) {
  return denominator ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function insightLabel(insight: FunnelInsight) {
  if (insight.level === "ca") return "Campus Ambassador";
  if (insight.level === "executive") return "Executive";
  if (insight.level === "team") return "Team";
  return "Organization";
}

export function AdminFunnelAnalyticsPanel({ dateRange }: { dateRange: DateRange }) {
  const [data, setData] = useState<AdminFunnelAnalytics | null>(null);
  const [teamId, setTeamId] = useState("all");
  const [memberId, setMemberId] = useState("all");
  const [ambassadorId, setAmbassadorId] = useState("all");
  const [breakdown, setBreakdown] = useState<Breakdown>("executives");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const params = useMemo(() => {
    const value = new URLSearchParams({ dateRange });
    if (teamId !== "all") value.set("teamId", teamId);
    if (memberId !== "all") value.set("memberId", memberId);
    if (ambassadorId !== "all") value.set("ambassadorId", ambassadorId);
    return value;
  }, [ambassadorId, dateRange, memberId, teamId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/funnel?${params.toString()}`, {
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to load funnel intelligence.");
      setData(result as AdminFunnelAnalytics);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load funnel intelligence.");
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const members = data?.options.members.filter(
    (member) => teamId === "all" || member.teamId === teamId,
  ) ?? [];
  const ambassadors = data?.options.ambassadors.filter(
    (ambassador) =>
      (teamId === "all" || ambassador.teamId === teamId) &&
      (memberId === "all" || ambassador.salesId === memberId),
  ) ?? [];
  const rows = data
    ? breakdown === "teams"
      ? data.teams
      : breakdown === "ambassadors"
        ? data.ambassadors
        : data.members
    : [];
  const scopeLabel = ambassadorId !== "all"
    ? (data?.options.ambassadors.find((item) => item.id === ambassadorId)?.name ?? "Selected CA")
    : memberId !== "all"
      ? (data?.options.members.find((item) => item.id === memberId)?.name ?? "Selected executive")
      : teamId !== "all"
        ? (data?.options.teams.find((item) => item.id === teamId)?.name ?? "Selected team")
        : "All teams";

  function exportCsv() {
    if (!data) return;
    const headers = [
      "Level", "Name", "College", "Team", "Executive", "Campus Ambassadors",
      "Unique Visitors", "Form Opens", "Domain Selections", "Submit Attempts",
      "Registrations", "WhatsApp Delivered", "WhatsApp Replies", "Advisor Requests",
      "Enrolled", "Visit to Registration %", "Registration to Reply %",
      "Advisor to Enrollment %", "Attention Flag", "Recommended Action",
    ];
    const insights = new Map<string, FunnelInsight[]>();
    for (const item of data.insights) {
      const key = `${item.level}:${item.entityId}`;
      insights.set(key, [...(insights.get(key) ?? []), item]);
    }
    const exportRows: Array<[string, FunnelBreakdownRow]> = [
      ...data.teams.map((row) => ["team", row] as [string, FunnelBreakdownRow]),
      ...data.members.map((row) => ["executive", row] as [string, FunnelBreakdownRow]),
      ...data.ambassadors.map((row) => ["ca", row] as [string, FunnelBreakdownRow]),
    ];
    const lines = [headers.map(csvCell).join(",")];
    for (const [level, row] of exportRows) {
      const rowInsights = insights.get(`${level}:${row.id}`) ?? [];
      lines.push([
        level, row.name, row.college ?? "", row.teamName ?? "", row.salesName ?? "",
        row.ambassadors, row.visitors, row.formOpens, row.domainSelections, row.attempts,
        row.registrations, row.whatsappDelivered, row.whatsappReplies,
        row.advisorRequests, row.enrolled, row.visitToRegistrationRate,
        row.registrationToReplyRate, row.advisorToEnrollmentRate,
        rowInsights.map((item) => item.title).join(" | "),
        rowInsights.map((item) => item.recommendation).join(" | "),
      ].map(csvCell).join(","));
    }
    const blob = new Blob([`\uFEFF${lines.join("\r\n")}`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `persevex-funnel-${dateRange}-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="funnel-intelligence">
      <div className="funnel-section-head">
        <div>
          <span className="eyebrow">ADMIN-ONLY FUNNEL INTELLIGENCE</span>
          <h2>Find where every lead is leaking.</h2>
          <p>{scopeLabel} · {dateRange === "today" ? "Today" : dateRange === "all" ? "All time" : `Last ${dateRange.replace("d", " days")}`} · Drill from company performance to the exact executive and Campus Ambassador responsible for each stage.</p>
        </div>
        <div className="funnel-head-actions">
          <button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={16} className={loading ? "spin" : ""} /> Refresh
          </button>
          <button className="primary-button" type="button" onClick={exportCsv} disabled={!data}>
            <Download size={16} /> Export insights CSV
          </button>
        </div>
      </div>

      <div className="funnel-filter-bar">
        <span><Filter size={17} /> Scope</span>
        <label>Team<select value={teamId} onChange={(event) => { setTeamId(event.target.value); setMemberId("all"); setAmbassadorId("all"); }}><option value="all">All teams</option>{data?.options.teams.map((team) => <option value={team.id} key={team.id}>{team.name}</option>)}</select></label>
        <label>Executive<select value={memberId} onChange={(event) => { setMemberId(event.target.value); setAmbassadorId("all"); }}><option value="all">All executives</option>{members.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}</select></label>
        <label>Campus Ambassador<select value={ambassadorId} onChange={(event) => setAmbassadorId(event.target.value)}><option value="all">All CAs</option>{ambassadors.map((ambassador) => <option value={ambassador.id} key={ambassador.id}>{ambassador.name} · {ambassador.college}</option>)}</select></label>
      </div>

      {error && <div className="alert error">{error}</div>}
      {loading && !data ? (
        <div className="statistics-loading"><RefreshCw className="spin" /><p>Tracing the complete lead journey...</p></div>
      ) : data && (
        <>
          {!data.trackingStartedAt && data.overview.registrations > 0 && (
            <div className="funnel-tracking-note"><AlertTriangle size={18} /><span><strong>Top-of-funnel tracking starts with this release.</strong> Historical registrations, WhatsApp activity and enrolments remain accurate; historical link visits cannot be reconstructed.</span></div>
          )}

          <div className="funnel-stage-grid">
            {data.stages.map((stage, index) => (
              <article key={stage.key} className={stage.key === "enrolled" ? "success" : ""}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <small>{stage.label}</small>
                <strong>{stage.count.toLocaleString("en-IN")}</strong>
                <p>{index ? `${stage.rateFromPrevious}% from previous stage` : "Tracked referral visitors"}</p>
                {index > 0 && <i><b style={{ width: `${Math.min(100, stage.rateFromPrevious)}%` }} /></i>}
              </article>
            ))}
          </div>

          <div className="funnel-rate-cards">
            <article><Eye size={18} /><span><small>Visit → registration</small><strong>{pct(data.overview.registrations, data.overview.visitors)}%</strong></span></article>
            <article><MessageCircle size={18} /><span><small>Registration → reply</small><strong>{pct(data.overview.whatsappReplies, data.overview.registrations)}%</strong></span></article>
            <article><Target size={18} /><span><small>Reply → advisor</small><strong>{pct(data.overview.advisorRequests, data.overview.whatsappReplies)}%</strong></span></article>
            <article><UserCheck size={18} /><span><small>Advisor → enrolled</small><strong>{pct(data.overview.enrolled, data.overview.advisorRequests)}%</strong></span></article>
          </div>

          <section className="funnel-insights-panel">
            <div className="statistics-panel-head"><div><span className="eyebrow">ACTIONABLE DIAGNOSIS</span><h2>What needs Admin attention</h2></div><AlertTriangle size={22} /></div>
            <div className="funnel-insight-grid">
              {data.insights.slice(0, 12).map((insight, index) => (
                <article className={`funnel-insight ${insight.severity}`} key={`${insight.level}-${insight.entityId}-${index}`}>
                  <span>{insightLabel(insight)} · {insight.entityName}</span>
                  <h3>{insight.title}</h3>
                  <p>{insight.detail}</p>
                  <div><CheckCircle2 size={15} /><strong>{insight.recommendation}</strong></div>
                </article>
              ))}
              {!data.insights.length && <article className="funnel-insight positive"><span>Current scope</span><h3>No major leak crossed the alert threshold.</h3><p>Keep monitoring as more tracked traffic enters the funnel.</p></article>}
            </div>
          </section>

          <section className="funnel-breakdown-panel">
            <div className="funnel-breakdown-head">
              <div><span className="eyebrow">GRANULAR PERFORMANCE</span><h2>See exactly who owns the outcome</h2></div>
              <div className="funnel-breakdown-toggle">
                <button className={breakdown === "executives" ? "active" : ""} onClick={() => setBreakdown("executives")}>Executives</button>
                <button className={breakdown === "ambassadors" ? "active" : ""} onClick={() => setBreakdown("ambassadors")}>Campus Ambassadors</button>
                <button className={breakdown === "teams" ? "active" : ""} onClick={() => setBreakdown("teams")}>Teams</button>
              </div>
            </div>
            <div className="funnel-table">
              <div className="funnel-table-row head"><span>Name</span><span>Visitors</span><span>Registered</span><span>WhatsApp replies</span><span>Advisor</span><span>Enrolled</span><span>Key rates</span></div>
              {rows.map((row) => (
                <article className="funnel-table-row" key={row.id}>
                  <span><strong>{row.name}</strong><small>{row.college ?? row.teamName ?? `${row.ambassadors} Campus Ambassadors`}{row.salesName ? ` · ${row.salesName}` : ""}</small></span>
                  <span><b>{row.visitors}</b><small>{row.formOpens} form opens</small></span>
                  <span><b>{row.registrations}</b><small>{row.visitToRegistrationRate}% of visits</small></span>
                  <span><b>{row.whatsappReplies}</b><small>{row.registrationToReplyRate}% of registrations</small></span>
                  <span><b>{row.advisorRequests}</b><small>high intent</small></span>
                  <span className="enrolled"><b>{row.enrolled}</b><small>{row.advisorToEnrollmentRate}% of advisor</small></span>
                  <span><small>Visit→Reg</small><strong>{row.visitToRegistrationRate}%</strong><small>Reg→Reply</small><strong>{row.registrationToReplyRate}%</strong></span>
                </article>
              ))}
              {!rows.length && <div className="funnel-empty"><BarChart3 size={24} /><strong>No performance data in this scope.</strong></div>}
            </div>
          </section>
        </>
      )}
    </section>
  );
}
