"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Award,
  BarChart3,
  BriefcaseBusiness,
  CheckCircle2,
  Layers3,
  RefreshCw,
  Target,
  TrendingUp,
  UserCheck,
  Users,
  UsersRound,
} from "lucide-react";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type {
  AdminStatistics as AdminStatisticsData,
  Profile,
  RegistrationStatus,
} from "@/lib/types";
import { AdminFunnelAnalyticsPanel } from "@/components/admin-funnel-analytics";

type StatisticsRange = "all" | "today" | "7d" | "30d";

const statusLabels: Record<RegistrationStatus, string> = {
  new: "New",
  contacted: "Contacted",
  interested: "Interested",
  follow_up: "Follow-up",
  converted: "Converted",
  not_interested: "Not interested",
  invalid: "Invalid",
};

function rate(converted: number, registrations: number) {
  return registrations ? Math.round((converted / registrations) * 1000) / 10 : 0;
}

function compactNumber(value: number) {
  return new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function AdminStatistics({ user }: { user: Profile }) {
  const [data, setData] = useState<AdminStatisticsData | null>(null);
  const [dateRange, setDateRange] = useState<StatisticsRange>("30d");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [live, setLive] = useState(false);
  const reconcileTimer = useRef<number | undefined>(undefined);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const response = await fetch(`/api/admin/statistics?dateRange=${dateRange}`, {
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to load statistics.");
      setData(result as AdminStatisticsData);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load statistics.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [dateRange]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const supabase = createBrowserSupabase();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | undefined;

    void (async () => {
      await supabase.realtime.setAuth();
      if (cancelled) return;
      channel = supabase
        .channel(`admin-statistics:${user.id}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "activity_events" },
          () => {
            if (reconcileTimer.current) window.clearTimeout(reconcileTimer.current);
            reconcileTimer.current = window.setTimeout(() => void load(true), 350);
          },
        )
        .subscribe((status: string) => setLive(status === "SUBSCRIBED"));
    })().catch(() => setLive(false));

    return () => {
      cancelled = true;
      if (reconcileTimer.current) window.clearTimeout(reconcileTimer.current);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [load, user.id]);

  const maxDaily = useMemo(
    () => Math.max(1, ...(data?.daily.map((item) => item.registrations) ?? [1])),
    [data?.daily],
  );
  const maxDomain = useMemo(
    () => Math.max(1, ...(data?.domainBreakdown.map((item) => item.registrations) ?? [1])),
    [data?.domainBreakdown],
  );
  const statusTotal = useMemo(
    () => data?.statusBreakdown.reduce((sum, item) => sum + item.count, 0) ?? 0,
    [data?.statusBreakdown],
  );

  return (
    <main className="statistics-page">
      <header className="statistics-header">
        <div className="statistics-header-inner">
          <div className="statistics-brand">
            <Image src="/persevex-logo.png" alt="Persevex" width={865} height={375} priority />
            <span>Organization intelligence</span>
          </div>
          <div className="statistics-header-actions">
            <span className={`live-pill ${live ? "connected" : ""}`}><i /> {live ? "Live" : "Connecting"}</span>
            <button type="button" className="icon-button" title="Refresh statistics" onClick={() => void load(true)}>
              <RefreshCw size={17} className={refreshing ? "spin" : ""} />
            </button>
            <Link href="/admin" className="statistics-back"><ArrowLeft size={17} /> Dashboard</Link>
          </div>
        </div>
      </header>

      <section className="statistics-hero">
        <div>
          <span className="eyebrow light">ADMIN STATISTICS</span>
          <h1>Every team. Every group. Every conversion.</h1>
          <p>One production view of acquisition, conversion, team output, campus ambassador performance, and student demand.</p>
        </div>
        <div className="statistics-range" aria-label="Statistics date range">
          {(["today", "7d", "30d", "all"] as StatisticsRange[]).map((rangeValue) => (
            <button
              type="button"
              key={rangeValue}
              className={dateRange === rangeValue ? "active" : ""}
              onClick={() => setDateRange(rangeValue)}
            >
              {rangeValue === "today" ? "Today" : rangeValue === "all" ? "All time" : rangeValue.toUpperCase()}
            </button>
          ))}
        </div>
      </section>

      <div className="statistics-content">
        <AdminFunnelAnalyticsPanel dateRange={dateRange} />
        {error && <div className="alert error">{error}</div>}
        {loading || !data ? (
          <div className="statistics-loading"><RefreshCw className="spin" /><p>Calculating organization performance...</p></div>
        ) : (
          <>
            <section className="statistics-metrics" aria-label="Organization summary">
              <article><span><Users size={19} /></span><small>Registrations</small><strong>{compactNumber(data.overview.registrations)}</strong><p>{data.overview.todayRegistrations} today</p></article>
              <article className="success"><span><UserCheck size={19} /></span><small>Converted</small><strong>{compactNumber(data.overview.converted)}</strong><p>{data.overview.conversionRate}% conversion</p></article>
              <article><span><Layers3 size={19} /></span><small>Active groups</small><strong>{data.overview.activeAmbassadors}</strong><p>{data.overview.qualifiedAmbassadors} qualified</p></article>
              <article><span><UsersRound size={19} /></span><small>Active employees</small><strong>{data.overview.activeEmployees}</strong><p>Across {data.overview.activeTeams} teams</p></article>
              <article><span><Award size={19} /></span><small>Qualified CAs</small><strong>{data.overview.qualifiedAmbassadors}</strong><p>Reached 30+ or target</p></article>
              <article><span><TrendingUp size={19} /></span><small>Conversion rate</small><strong>{data.overview.conversionRate}%</strong><p>Of valid registrations</p></article>
            </section>

            <section className="statistics-grid statistics-grid-top">
              <article className="statistics-panel statistics-trend-panel">
                <div className="statistics-panel-head"><div><span className="eyebrow">REGISTRATION TREND</span><h2>Daily acquisition and conversions</h2></div><BarChart3 size={22} /></div>
                <div className="statistics-chart">
                  {data.daily.map((item) => (
                    <div className="statistics-chart-column" key={item.date} title={`${item.registrations} registrations · ${item.converted} converted`}>
                      <div className="statistics-chart-value">{item.registrations || ""}</div>
                      <div className="statistics-chart-bars">
                        <span className="registrations" style={{ height: `${Math.max(item.registrations ? 5 : 0, (item.registrations / maxDaily) * 100)}%` }} />
                        <span className="converted" style={{ height: `${Math.max(item.converted ? 4 : 0, (item.converted / maxDaily) * 100)}%` }} />
                      </div>
                      <small>{new Date(`${item.date}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</small>
                    </div>
                  ))}
                </div>
                <div className="statistics-legend"><span><i className="registrations" /> Registrations</span><span><i className="converted" /> Converted</span></div>
              </article>

              <article className="statistics-panel statistics-funnel-panel">
                <div className="statistics-panel-head"><div><span className="eyebrow">LEAD PIPELINE</span><h2>Status distribution</h2></div><Target size={22} /></div>
                <div className="statistics-status-list">
                  {data.statusBreakdown.map((item) => (
                    <div key={item.status}>
                      <span><b>{statusLabels[item.status]}</b><small>{item.count}</small></span>
                      <div><i className={`status-${item.status}`} style={{ width: `${statusTotal ? (item.count / statusTotal) * 100 : 0}%` }} /></div>
                    </div>
                  ))}
                </div>
              </article>
            </section>

            <section className="statistics-grid statistics-grid-middle">
              <article className="statistics-panel">
                <div className="statistics-panel-head"><div><span className="eyebrow">TEAM PERFORMANCE</span><h2>Team-by-team output</h2></div><UsersRound size={22} /></div>
                <div className="statistics-table statistics-team-table">
                  <div className="statistics-table-row head"><span>Team</span><span>Members</span><span>Groups</span><span>Qualified</span><span>Registrations</span><span>Converted</span><span>Rate</span></div>
                  {data.teams.map((team) => (
                    <div className="statistics-table-row" key={team.id}>
                      <span><strong>{team.name}</strong></span><span>{team.members}</span><span>{team.ambassadors}</span><span>{team.qualified_ambassadors}</span><span>{team.registrations}</span><span>{team.converted}</span><span><b>{rate(team.converted, team.registrations)}%</b></span>
                    </div>
                  ))}
                </div>
              </article>

              <article className="statistics-panel statistics-domain-panel">
                <div className="statistics-panel-head"><div><span className="eyebrow">STUDENT DEMAND</span><h2>Top internship domains</h2></div><BriefcaseBusiness size={22} /></div>
                <div className="statistics-domain-list">
                  {data.domainBreakdown.slice(0, 12).map((item) => (
                    <div key={item.domain}>
                      <span><strong>{item.domain}</strong><small>{item.registrations} · {item.converted} converted</small></span>
                      <div><i style={{ width: `${(item.registrations / maxDomain) * 100}%` }} /></div>
                    </div>
                  ))}
                </div>
              </article>
            </section>

            <section className="statistics-grid statistics-grid-bottom">
              <article className="statistics-panel">
                <div className="statistics-panel-head"><div><span className="eyebrow">EMPLOYEE LEADERBOARD</span><h2>Individual performance</h2></div><TrendingUp size={22} /></div>
                <div className="statistics-ranking-list">
                  {data.members.slice(0, 15).map((member, index) => (
                    <div key={member.id}>
                      <span className="statistics-rank">{String(index + 1).padStart(2, "0")}</span>
                      <span className="statistics-ranking-person"><strong>{member.name}</strong><small>{member.team_name ?? "No team"} · {member.role === "team_lead" ? "Team Lead" : "Sales"}</small></span>
                      <span><strong>{member.registrations}</strong><small>registrations</small></span>
                      <span><strong>{member.converted}</strong><small>converted</small></span>
                      <span><strong>{rate(member.converted, member.registrations)}%</strong><small>rate</small></span>
                    </div>
                  ))}
                </div>
              </article>

              <article className="statistics-panel">
                <div className="statistics-panel-head"><div><span className="eyebrow">CAMPUS AMBASSADORS</span><h2>Top registration sources</h2></div><Award size={22} /></div>
                <div className="statistics-ranking-list">
                  {data.ambassadors.slice(0, 15).map((ambassador, index) => (
                    <div key={ambassador.id}>
                      <span className="statistics-rank">{String(index + 1).padStart(2, "0")}</span>
                      <span className="statistics-ranking-person"><strong>{ambassador.name}</strong><small>{ambassador.college} · {ambassador.creator_name ?? "Team member"}</small></span>
                      <span><strong>{ambassador.registrations}</strong><small>registrations</small></span>
                      <span><strong>{ambassador.converted}</strong><small>converted</small></span>
                      <span className={ambassador.qualified ? "qualified" : ""}>{ambassador.qualified ? <CheckCircle2 size={15} /> : <Target size={15} />}<small>{ambassador.qualified ? "qualified" : `${ambassador.target} target`}</small></span>
                    </div>
                  ))}
                </div>
              </article>
            </section>

            <p className="statistics-generated">Calculated from production data · Updated {new Date(data.generatedAt).toLocaleString("en-IN")}</p>
          </>
        )}
      </div>
    </main>
  );
}
