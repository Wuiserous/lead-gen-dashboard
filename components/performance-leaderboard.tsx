"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Building2,
  CheckCircle2,
  Crown,
  Flame,
  Medal,
  RefreshCw,
  Sparkles,
  Target,
  Trophy,
  UserRound,
  Users,
  Zap,
} from "lucide-react";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type {
  AppRole,
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

export function PerformanceLeaderboard({
  currentUserId,
  currentUserRole,
}: {
  currentUserId: string;
  currentUserRole: AppRole;
}) {
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
        // Focus and periodic reconciliation remain available.
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
  const activeEntries = view === "employees" ? employees : teams;
  const totalRegistrations = activeEntries.reduce(
    (sum, entry) => sum + entry.registrations,
    0,
  );
  const totalConversions = activeEntries.reduce(
    (sum, entry) => sum + entry.conversions,
    0,
  );
  const leadingScore = activeEntries[0]?.score ?? 0;

  return (
    <section className="leaderboard-page leaderboard-v2">
      <div className="leaderboard-hero">
        <div className="leaderboard-hero-copy">
          <span className="leaderboard-live-race"><i /> Rankings update live</span>
          <span className="eyebrow light">PERSEVEX PERFORMANCE ARENA</span>
          <h2>The race for #1 is live.</h2>
          <p>
            {currentUserRole === "admin"
              ? "Watch every employee and team compete on registrations, conversions, and consistent execution."
              : "Every valid registration earns a point. Every conversion accelerates your climb. Take the next position."}
          </p>
          <div className="leaderboard-hero-metrics">
            <span><strong>{activeEntries.length}</strong> active competitors</span>
            <span><strong>{totalRegistrations}</strong> registrations</span>
            <span><strong>{totalConversions}</strong> conversions</span>
          </div>
        </div>
        <div className="leaderboard-hero-score">
          <span><Crown size={18} /> Leading score</span>
          <strong>{leadingScore}</strong>
          <small>{periodLabels[period]} · {view === "employees" ? "employee race" : "team race"}</small>
          <Trophy className="leaderboard-hero-watermark" size={100} />
        </div>
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
          className="icon-button leaderboard-refresh"
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
              {topEmployees.map((entry, index) => (
                <PodiumCard
                  key={entry.id}
                  entry={entry}
                  isCurrent={entry.id === currentUserId}
                  higherScore={index ? employees[index - 1].score : null}
                  lowerScore={employees[index + 1]?.score ?? null}
                />
              ))}
            </div>
          ) : (
            <LeaderboardEmpty label={periodLabels[period]} />
          )}

          {currentUserRole !== "admin" && (
            <PersonalPosition
              entry={currentEntry}
              period={period}
              employees={employees}
            />
          )}

          {!!employees.length && (
            <div className="leaderboard-table-card">
              <div className="leaderboard-table-head">
                <div>
                  <span className="eyebrow">COMPANY RANKING</span>
                  <h3>{periodLabels[period]} performers</h3>
                </div>
                <span><Users size={15} /> {employees.length} in the race</span>
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
                    maxScore={employees[0]?.score ?? 1}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {view === "teams" && (
        teams.length ? (
          <>
            <div className="team-leaderboard-spotlights">
              {teams.slice(0, 3).map((entry, index) => (
                <TeamSpotlight
                  key={entry.id}
                  entry={entry}
                  higherScore={index ? teams[index - 1].score : null}
                />
              ))}
            </div>
            <div className="leaderboard-table-card team-board">
              <div className="leaderboard-table-head">
                <div>
                  <span className="eyebrow">TEAM COMPETITION</span>
                  <h3>{periodLabels[period]} team standings</h3>
                </div>
                <span><Building2 size={15} /> {teams.length} teams in the race</span>
              </div>
              <div className="leaderboard-table-labels team">
                <span>Rank</span><span>Team</span><span>Members</span>
                <span>Registrations</span><span>Conversions</span><span>Avg.</span><span>Points</span>
              </div>
              <div className="leaderboard-rows">
                {teams.map((entry) => (
                  <TeamRow
                    key={entry.id}
                    entry={entry}
                    maxScore={teams[0]?.score ?? 1}
                  />
                ))}
              </div>
            </div>
          </>
        ) : <LeaderboardEmpty label={periodLabels[period]} />
      )}

      <div className="leaderboard-scoring">
        <span><Target size={18} /><b><strong>+1</strong> Valid registration</b><small>Get on the board</small></span>
        <span><Zap size={18} /><b><strong>+5</strong> Human conversion</b><small>Make the decisive move</small></span>
        <span><CheckCircle2 size={18} /><b>Quality protected</b><small>Invalid and deleted leads never count</small></span>
      </div>
    </section>
  );
}

function PodiumCard({
  entry,
  isCurrent,
  higherScore,
  lowerScore,
}: {
  entry: EmployeeLeaderboardEntry;
  isCurrent: boolean;
  higherScore: number | null;
  lowerScore: number | null;
}) {
  const pressureText = entry.rank === 1
    ? lowerScore === null
      ? "Setting the pace"
      : `${Math.max(0, entry.score - lowerScore)} pts ahead`
    : `${Math.max(1, (higherScore ?? entry.score) - entry.score + 1)} pts to overtake`;
  return (
    <article className={`podium-card rank-${entry.rank} ${isCurrent ? "current" : ""}`}>
      <span className="podium-place">#{entry.rank} <small>{entry.rank === 1 ? "Leader" : "Challenger"}</small></span>
      <span className="podium-medal">
        {entry.rank === 1 ? <Crown size={24} /> : <Medal size={22} />}
      </span>
      <span className="podium-avatar">{initials(entry.name)}</span>
      <strong>{entry.name}{isCurrent ? " · You" : ""}</strong>
      <small>{entry.teamName ?? "Unassigned team"}</small>
      <div><b>{entry.score}</b><span>points</span></div>
      <footer>
        <span><strong>{entry.registrations}</strong> registrations</span>
        <span><strong>{entry.conversions}</strong> converted</span>
      </footer>
      <p className="podium-pressure"><Flame size={13} /> {pressureText}</p>
    </article>
  );
}

function PersonalPosition({
  entry,
  period,
  employees,
}: {
  entry: EmployeeLeaderboardEntry | null;
  period: LeaderboardPeriod;
  employees: EmployeeLeaderboardEntry[];
}) {
  const entryIndex = entry
    ? employees.findIndex((employee) => employee.id === entry.id)
    : -1;
  const higher = entryIndex > 0 ? employees[entryIndex - 1] : null;
  const pointsToNext = entry && higher
    ? Math.max(1, higher.score - entry.score + 1)
    : 0;
  const periodCopy = period === "day" ? "today" : `this ${period}`;

  return (
    <div className="personal-rank-card">
      <span className="personal-rank-icon"><Target size={22} /></span>
      <div className="personal-rank-copy">
        <span className="eyebrow">YOUR LIVE POSITION</span>
        {entry ? (
          <strong>{entry.rank === 1 ? `You are leading ${periodCopy}` : `You are #${entry.rank} ${periodCopy}`}</strong>
        ) : (
          <strong>Your first point is waiting.</strong>
        )}
        <small>{entry ? `${entry.registrations} registrations · ${entry.conversions} conversions` : "One valid registration puts your name on the board."}</small>
      </div>
      <div className="personal-rank-pressure">
        {entry ? (
          entry.rank === 1 ? (
            <><Crown size={18} /><strong>Defend #1</strong><span>{entry.score} points</span></>
          ) : (
            <><Flame size={18} /><strong>{pointsToNext} pts</strong><span>to take #{entry.rank - 1}</span></>
          )
        ) : (
          <><Zap size={18} /><strong>+1 point</strong><span>to enter the race</span></>
        )}
      </div>
      {entry && <div className="personal-rank-movement">{rankMovement(entry.previousRank, entry.rank)}</div>}
    </div>
  );
}

function EmployeeRow({
  entry,
  isCurrent,
  maxScore,
}: {
  entry: EmployeeLeaderboardEntry;
  isCurrent: boolean;
  maxScore: number;
}) {
  return (
    <article className={`leaderboard-row employee rank-tone-${Math.min(entry.rank, 4)} ${isCurrent ? "current" : ""}`}>
      <span className="leaderboard-row-meter" aria-hidden="true"><i style={{ width: `${Math.max(3, (entry.score / maxScore) * 100)}%` }} /></span>
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

function TeamRow({
  entry,
  maxScore,
}: {
  entry: TeamLeaderboardEntry;
  maxScore: number;
}) {
  return (
    <article className={`leaderboard-row team rank-tone-${Math.min(entry.rank, 4)}`}>
      <span className="leaderboard-row-meter" aria-hidden="true"><i style={{ width: `${Math.max(3, (entry.score / maxScore) * 100)}%` }} /></span>
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

function TeamSpotlight({
  entry,
  higherScore,
}: {
  entry: TeamLeaderboardEntry;
  higherScore: number | null;
}) {
  const pressure = entry.rank === 1
    ? "Team to beat"
    : `${Math.max(1, (higherScore ?? entry.score) - entry.score + 1)} points to advance`;
  return (
    <article className={`team-spotlight rank-${entry.rank}`}>
      <span className="team-spotlight-rank">#{entry.rank}</span>
      <span className="team-spotlight-icon">
        {entry.rank === 1 ? <Crown size={20} /> : <Building2 size={18} />}
      </span>
      <div><strong>{entry.name}</strong><small>{entry.activeMembers} active members</small></div>
      <p><strong>{entry.score}</strong><span>points</span></p>
      <footer><Flame size={12} /> {pressure}</footer>
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
