"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Building2,
  CheckCircle2,
  Crown,
  Medal,
  RefreshCw,
  Sparkles,
  Target,
  Trophy,
  UserRound,
  Users,
} from "lucide-react";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type {
  EmployeeLeaderboardEntry,
  LeaderboardPeriod,
  PerformanceLeaderboard,
  TeamLeaderboardEntry,
} from "@/lib/types";

const periodLabels: Record<LeaderboardPeriod, string> = {
  day: "Today",
  week: "This week",
  month: "This month",
  year: "This year",
};

function rankMovement(previousRank: number | null, rank: number) {
  if (previousRank === null) {
    return <span className="leaderboard-new"><Sparkles size={12} /> New</span>;
  }
  const movement = previousRank - rank;
  if (movement > 0) {
    return <span className="leaderboard-up"><ArrowUp size={12} /> {movement}</span>;
  }
  if (movement < 0) {
    return <span className="leaderboard-down"><ArrowDown size={12} /> {Math.abs(movement)}</span>;
  }
  return <span className="leaderboard-steady">—</span>;
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function PerformanceLeaderboard({ currentUserId }: { currentUserId: string }) {
  const [period, setPeriod] = useState<LeaderboardPeriod>("day");
  const [view, setView] = useState<"employees" | "teams">("employees");
  const [data, setData] = useState<PerformanceLeaderboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const requestSequence = useRef(0);
  const refreshTimer = useRef<number | undefined>(undefined);

  const load = useCallback(async (quiet = false) => {
    const requestId = ++requestSequence.current;
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const response = await fetch(`/api/leaderboard?period=${period}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Unable to load the leaderboard.");
      const result = (await response.json()) as PerformanceLeaderboard;
      if (requestId !== requestSequence.current) return;
      setData(result);
      setError("");
    } catch (loadError) {
      if (requestId !== requestSequence.current) return;
      setError(loadError instanceof Error ? loadError.message : "Unable to load the leaderboard.");
    } finally {
      if (requestId === requestSequence.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [period]);

  const scheduleLiveRefresh = useCallback(() => {
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => void load(true), 350);
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const supabase = createBrowserSupabase();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | undefined;

    void (async () => {
      try {
        await supabase.realtime.setAuth();
        if (cancelled) return;
        channel = supabase
          .channel("leaderboard:company", { config: { private: true } })
          .on("broadcast", { event: "score_changed" }, scheduleLiveRefresh)
          .subscribe();
      } catch {
        // The focus and five-minute reconciliation below remain available.
      }
    })();

    const reconcile = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    const interval = window.setInterval(reconcile, 5 * 60_000);
    window.addEventListener("focus", reconcile);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", reconcile);
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [load, scheduleLiveRefresh]);

  const currentEntry = useMemo(
    () => data?.employees.find((entry) => entry.id === currentUserId) ?? null,
    [currentUserId, data?.employees],
  );

  if (loading && !data) {
    return (
      <section className="leaderboard-loading panel">
        <RefreshCw className="spin" />
        <strong>Calculating the rankings...</strong>
      </section>
    );
  }

  const employees = data?.employees ?? [];
  const teams = data?.teams ?? [];
  const topEmployees = employees.slice(0, 3);

  return (
    <section className="leaderboard-page">
      <div className="leaderboard-hero">
        <div>
          <span className="eyebrow light">LIVE PERFORMANCE ARENA</span>
          <h2>Every lead moves the board.</h2>
          <p>Capture valid registrations, convert real opportunities, and earn your position.</p>
        </div>
        <div className="leaderboard-hero-trophy"><Trophy size={43} /></div>
      </div>

      <div className="leaderboard-controls">
        <div className="leaderboard-periods" aria-label="Leaderboard period">
          {(Object.keys(periodLabels) as LeaderboardPeriod[]).map((item) => (
            <button
              type="button"
              key={item}
              className={period === item ? "active" : ""}
              onClick={() => setPeriod(item)}
            >
              {periodLabels[item]}
            </button>
          ))}
        </div>
        <div className="leaderboard-view-toggle">
          <button
            type="button"
            className={view === "employees" ? "active" : ""}
            onClick={() => setView("employees")}
          ><UserRound size={15} /> Employees</button>
          <button
            type="button"
            className={view === "teams" ? "active" : ""}
            onClick={() => setView("teams")}
          ><Building2 size={15} /> Teams</button>
        </div>
        <button
          type="button"
          className="icon-button"
          title="Refresh leaderboard"
          onClick={() => void load(true)}
          disabled={refreshing}
        >
          <RefreshCw size={17} className={refreshing ? "spin" : ""} />
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}

      {view === "employees" && (
        <>
          {topEmployees.length ? (
            <div className={`leaderboard-podium count-${topEmployees.length}`}>
              {topEmployees.map((entry) => (
                <PodiumCard key={entry.id} entry={entry} isCurrent={entry.id === currentUserId} />
              ))}
            </div>
          ) : (
            <LeaderboardEmpty label={periodLabels[period]} />
          )}

          <PersonalPosition entry={currentEntry} period={period} />

          {!!employees.length && (
            <div className="leaderboard-table-card">
              <div className="leaderboard-table-head">
                <div>
                  <span className="eyebrow">COMPANY RANKING</span>
                  <h3>{periodLabels[period]} performers</h3>
                </div>
                <span><Users size={15} /> {employees.length} ranked</span>
              </div>
              <div className="leaderboard-table-labels employee">
                <span>Rank</span><span>Employee</span><span>Registrations</span>
                <span>Conversions</span><span>Rate</span><span>Points</span>
              </div>
              <div className="leaderboard-rows">
                {employees.map((entry) => (
                  <EmployeeRow
                    key={entry.id}
                    entry={entry}
                    isCurrent={entry.id === currentUserId}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {view === "teams" && (
        teams.length ? (
          <div className="leaderboard-table-card team-board">
            <div className="leaderboard-table-head">
              <div>
                <span className="eyebrow">TEAM COMPETITION</span>
                <h3>{periodLabels[period]} team standings</h3>
              </div>
              <span><Building2 size={15} /> {teams.length} ranked</span>
            </div>
            <div className="leaderboard-table-labels team">
              <span>Rank</span><span>Team</span><span>Members</span>
              <span>Registrations</span><span>Conversions</span><span>Avg.</span><span>Points</span>
            </div>
            <div className="leaderboard-rows">
              {teams.map((entry) => <TeamRow key={entry.id} entry={entry} />)}
            </div>
          </div>
        ) : <LeaderboardEmpty label={periodLabels[period]} />
      )}

      <div className="leaderboard-scoring">
        <span><Target size={16} /><strong>+1</strong> valid registration</span>
        <span><CheckCircle2 size={16} /><strong>+5</strong> conversion</span>
        <p>Invalid or deleted registrations do not count. Conversion points are awarded when a human marks the lead converted.</p>
      </div>
    </section>
  );
}

function PodiumCard({
  entry,
  isCurrent,
}: {
  entry: EmployeeLeaderboardEntry;
  isCurrent: boolean;
}) {
  return (
    <article className={`podium-card rank-${entry.rank} ${isCurrent ? "current" : ""}`}>
      <span className="podium-medal">
        {entry.rank === 1 ? <Crown size={22} /> : <Medal size={21} />}
      </span>
      <span className="podium-avatar">{initials(entry.name)}</span>
      <strong>{entry.name}{isCurrent ? " · You" : ""}</strong>
      <small>{entry.teamName ?? "Unassigned team"}</small>
      <div><b>{entry.score}</b><span>points</span></div>
      <footer>
        <span>{entry.registrations} leads</span>
        <span>{entry.conversions} converted</span>
      </footer>
    </article>
  );
}

function PersonalPosition({
  entry,
  period,
}: {
  entry: EmployeeLeaderboardEntry | null;
  period: LeaderboardPeriod;
}) {
  return (
    <div className="personal-rank-card">
      <span className="personal-rank-icon"><Target size={20} /></span>
      <div>
        <span className="eyebrow">YOUR POSITION</span>
        {entry ? (
          <strong>#{entry.rank} in the company · {entry.score} points</strong>
        ) : (
          <strong>Not ranked {period === "day" ? "today" : `this ${period}`}</strong>
        )}
        <small>{entry ? `${entry.registrations} registrations · ${entry.conversions} conversions` : "Your first valid registration puts you on the board."}</small>
      </div>
      {entry && rankMovement(entry.previousRank, entry.rank)}
    </div>
  );
}

function EmployeeRow({
  entry,
  isCurrent,
}: {
  entry: EmployeeLeaderboardEntry;
  isCurrent: boolean;
}) {
  return (
    <article className={`leaderboard-row employee ${isCurrent ? "current" : ""}`}>
      <div className="leaderboard-rank"><strong>#{entry.rank}</strong>{rankMovement(entry.previousRank, entry.rank)}</div>
      <div className="leaderboard-person">
        <span>{initials(entry.name)}</span>
        <div><strong>{entry.name}{isCurrent ? " · You" : ""}</strong><small>{entry.teamName ?? "Unassigned"} · {entry.role === "team_lead" ? "Team Lead" : "Sales Executive"}</small></div>
      </div>
      <span data-label="Registrations">{entry.registrations}</span>
      <span data-label="Conversions">{entry.conversions}</span>
      <span data-label="Conversion rate">{entry.conversionRate}%</span>
      <strong className="leaderboard-score" data-label="Points">{entry.score}</strong>
    </article>
  );
}

function TeamRow({ entry }: { entry: TeamLeaderboardEntry }) {
  return (
    <article className="leaderboard-row team">
      <div className="leaderboard-rank"><strong>#{entry.rank}</strong>{rankMovement(entry.previousRank, entry.rank)}</div>
      <div className="leaderboard-person team-name"><span><Building2 size={16} /></span><div><strong>{entry.name}</strong><small>{entry.activeMembers} active members</small></div></div>
      <span data-label="Members">{entry.activeMembers}</span>
      <span data-label="Registrations">{entry.registrations}</span>
      <span data-label="Conversions">{entry.conversions}</span>
      <span data-label="Average">{entry.averageScore}</span>
      <strong className="leaderboard-score" data-label="Points">{entry.score}</strong>
    </article>
  );
}

function LeaderboardEmpty({ label }: { label: string }) {
  return (
    <div className="leaderboard-empty panel">
      <Trophy size={30} />
      <strong>The board is wide open</strong>
      <p>No one has scored during {label.toLowerCase()} yet. The first valid registration takes the lead.</p>
    </div>
  );
}
