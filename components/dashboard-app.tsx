"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Award,
  BarChart3,
  Building2,
  CalendarDays,
  ChevronRight,
  Clipboard,
  Copy,
  LayoutDashboard,
  Layers3,
  Link2,
  LogOut,
  Menu,
  PauseCircle,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Target,
  Trash2,
  Upload,
  UserPlus,
  Users,
  UsersRound,
  X,
} from "lucide-react";
import Papa from "papaparse";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  isWithinReportingRange,
  type ReportingDateRange,
} from "@/lib/reporting-date";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import {
  clearDashboardBootstrap,
  peekDashboardBootstrap,
} from "@/lib/dashboard-bootstrap";
import type {
  AmbassadorPerformance,
  AppRole,
  DashboardActivityEvent,
  DashboardData,
  DashboardLiveUpdate,
  Profile,
  Registration,
  RegistrationStatus,
  TeamPerformance,
} from "@/lib/types";

type Tab = "overview" | "teams" | "employees" | "ambassadors" | "leads";
type ModalName = "team" | "employee" | "import" | "ambassador" | null;
type DateRange = ReportingDateRange;
type DashboardUpdater = (updater: (current: DashboardData) => DashboardData) => void;

const statusLabels: Record<RegistrationStatus, string> = {
  new: "New",
  contacted: "Contacted",
  interested: "Interested",
  follow_up: "Follow-up",
  converted: "Converted",
  not_interested: "Not interested",
  invalid: "Invalid",
};

function roleLabel(role: AppRole) {
  if (role === "admin") return "Admin";
  if (role === "team_lead") return "Team Lead";
  return "Sales Executive";
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function inDateRange(value: string, range: DateRange) {
  return isWithinReportingRange(value, range);
}

function registrationMatchesView(
  lead: Registration,
  filters: {
    teamId: string;
    memberId: string;
    groupId: string;
    dateRange: DateRange;
    search: string;
  },
) {
  const needle = filters.search.toLowerCase();
  return (
    (filters.teamId === "all" || lead.credited_team_id === filters.teamId) &&
    (filters.memberId === "all" || lead.credited_sales_id === filters.memberId) &&
    (filters.groupId === "all" || lead.ambassador_id === filters.groupId) &&
    inDateRange(lead.created_at, filters.dateRange) &&
    (
      !needle ||
      lead.name.toLowerCase().includes(needle) ||
      lead.phone.includes(needle) ||
      lead.preferred_domain.toLowerCase().includes(needle) ||
      ambassadorLabel(lead).toLowerCase().includes(needle)
    )
  );
}

function upsertById<T extends { id: string }>(items: T[], value: T) {
  return [value, ...items.filter((item) => item.id !== value.id)];
}

function publicBaseUrl() {
  return typeof window === "undefined"
    ? ""
    : window.location.origin.replace(/\/$/, "");
}

async function readError(response: Response) {
  try {
    const result = await response.json();
    return result.error ?? "Something went wrong.";
  } catch {
    return "Something went wrong.";
  }
}

async function dashboardMutation(input: RequestInfo | URL, init?: RequestInit) {
  try {
    return await fetch(input, init);
  } catch {
    return new Response(
      JSON.stringify({ error: "Unable to reach the server. Your change was reverted." }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }
}

export function DashboardApp({ expectedRole }: { expectedRole: AppRole }) {
  const router = useRouter();
  const initialData = useMemo(() => {
    const cached = peekDashboardBootstrap();
    return cached?.user.role === expectedRole ? cached : null;
  }, [expectedRole]);
  const [data, setData] = useState<DashboardData | null>(initialData);
  const [tab, setTab] = useState<Tab>("overview");
  const [modal, setModal] = useState<ModalName>(null);
  const [loading, setLoading] = useState(!initialData);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [live, setLive] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [memberFilter, setMemberFilter] = useState("all");
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [page, setPage] = useState(1);
  const loadedOnce = useRef(Boolean(initialData));
  const loadSequence = useRef(0);
  const visibleLoadInFlight = useRef(false);
  const dataRevision = useRef(0);
  const processedLiveEvents = useRef(new Set<number>());
  const latestSummaryEvent = useRef(0);
  const reconcileTimer = useRef<number | undefined>(undefined);
  const reportingViewKey = [
    teamFilter,
    memberFilter,
    groupFilter,
    dateRange,
    debouncedSearch,
    page,
  ].join("|");
  const reportingViewKeyRef = useRef(reportingViewKey);

  const updateDashboard = useCallback(
    (updater: (current: DashboardData) => DashboardData) => {
      dataRevision.current += 1;
      setData((current) => (current ? updater(current) : current));
    },
    [],
  );

  useEffect(() => {
    reportingViewKeyRef.current = reportingViewKey;
  }, [reportingViewKey]);

  useEffect(() => {
    clearDashboardBootstrap();
  }, []);

  const load = useCallback(async (quiet = false, silent = false) => {
    if (silent && visibleLoadInFlight.current) return;
    const requestId = ++loadSequence.current;
    const revisionAtStart = dataRevision.current;
    if (!silent) {
      visibleLoadInFlight.current = true;
      if (quiet || loadedOnce.current) setRefreshing(true);
      else setLoading(true);
    }
    const params = new URLSearchParams({ page: String(page), pageSize: "50" });
    if (teamFilter !== "all") params.set("teamId", teamFilter);
    if (memberFilter !== "all") params.set("memberId", memberFilter);
    if (groupFilter !== "all") params.set("groupId", groupFilter);
    if (dateRange !== "all") params.set("dateRange", dateRange);
    if (debouncedSearch) params.set("search", debouncedSearch);
    let response: Response;
    try {
      response = await fetch(`/api/dashboard?${params.toString()}`, {
        cache: "no-store",
      });
    } catch {
      if (requestId === loadSequence.current && !silent) {
        visibleLoadInFlight.current = false;
        setError("Unable to reach the dashboard. Check your connection.");
        setLoading(false);
        setRefreshing(false);
      }
      return;
    }
    if (requestId !== loadSequence.current) return;
    if (!response.ok) {
      if (response.status === 401) {
        router.replace("/");
        return;
      }
      setError(await readError(response));
      if (!silent) {
        visibleLoadInFlight.current = false;
        setLoading(false);
        setRefreshing(false);
      }
      return;
    }
    const result = (await response.json()) as DashboardData;
    if (
      requestId !== loadSequence.current ||
      revisionAtStart !== dataRevision.current
    ) {
      if (!silent) {
        visibleLoadInFlight.current = false;
        setLoading(false);
        setRefreshing(false);
      }
      return;
    }
    if (result.user.role !== expectedRole) {
      router.replace(
        result.user.role === "admin"
          ? "/admin"
          : result.user.role === "team_lead"
            ? "/team"
            : "/sales",
      );
      return;
    }
    setData(result);
    setPage(result.pagination.page);
    loadedOnce.current = true;
    setError("");
    if (!silent) {
      visibleLoadInFlight.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [dateRange, debouncedSearch, expectedRole, groupFilter, memberFilter, page, router, teamFilter]);

  const scheduleReconciliation = useCallback(() => {
    if (reconcileTimer.current) window.clearTimeout(reconcileTimer.current);
    reconcileTimer.current = window.setTimeout(() => void load(true, true), 4_000);
  }, [load]);

  const loadLiveEvent = useCallback(async (event: DashboardActivityEvent) => {
    const viewKeyAtStart = reportingViewKey;
    if (processedLiveEvents.current.has(event.id)) return;
    processedLiveEvents.current.add(event.id);
    if (processedLiveEvents.current.size > 250) {
      const oldest = processedLiveEvents.current.values().next().value;
      if (typeof oldest === "number") processedLiveEvents.current.delete(oldest);
    }

    const isRegistrationEvent = event.event_type.startsWith("registration_");
    const isAmbassadorEvent = event.event_type.startsWith("ambassador_");
    const isEmployeeEvent = event.event_type.startsWith("employee_");
    const isTeamEvent = event.event_type.startsWith("team_");
    if (!isRegistrationEvent && !isAmbassadorEvent && !isEmployeeEvent && !isTeamEvent) {
      await load(true, true);
      scheduleReconciliation();
      return;
    }

    const affectedGroupId =
      event.ambassador_id ?? (isAmbassadorEvent ? event.entity_id : null);
    const affectedTeamId = event.team_id ?? (isTeamEvent ? event.entity_id : null);
    const managementEvent = isTeamEvent || isEmployeeEvent;
    const matchesScope = managementEvent ||
      ((teamFilter === "all" || affectedTeamId === teamFilter) &&
        (memberFilter === "all" || event.sales_id === memberFilter) &&
        (groupFilter === "all" || affectedGroupId === groupFilter));
    if (!matchesScope) return;

    const params = new URLSearchParams({
      eventId: String(event.id),
      page: String(page),
      pageSize: "50",
    });
    if (teamFilter !== "all") params.set("teamId", teamFilter);
    if (memberFilter !== "all") params.set("memberId", memberFilter);
    if (groupFilter !== "all") params.set("groupId", groupFilter);
    if (dateRange !== "all") params.set("dateRange", dateRange);
    if (debouncedSearch) params.set("search", debouncedSearch);

    let response: Response;
    try {
      response = await fetch(`/api/dashboard/live?${params.toString()}`, {
        cache: "no-store",
      });
    } catch {
      await load(true, true);
      scheduleReconciliation();
      return;
    }
    if (!response.ok) {
      await load(true, true);
      scheduleReconciliation();
      return;
    }

    const update = (await response.json()) as DashboardLiveUpdate;
    if (reportingViewKeyRef.current !== viewKeyAtStart) return;
    const applySummary = Boolean(update.summary && update.pagination) &&
      update.event.id >= latestSummaryEvent.current;
    if (applySummary) latestSummaryEvent.current = update.event.id;
    dataRevision.current += 1;
    setData((current) => {
      if (!current) return current;

      let registrations = current.registrations;
      if (isRegistrationEvent && update.event.entity_id) {
        const existed = registrations.some(
          (lead) => lead.id === update.event.entity_id,
        );
        registrations = registrations.filter(
          (lead) => lead.id !== update.event.entity_id,
        );
        if (
          update.registration &&
          registrationMatchesView(update.registration, {
            teamId: teamFilter,
            memberId: memberFilter,
            groupId: groupFilter,
            dateRange,
            search: debouncedSearch,
          }) &&
          (existed || current.pagination.page === 1)
        ) {
          registrations = [update.registration, ...registrations]
            .sort(
              (left, right) =>
                Date.parse(right.created_at) - Date.parse(left.created_at),
            )
            .slice(0, current.pagination.pageSize);
        }
      }

      let ambassadors = current.ambassadors;
      if (
        update.event.event_type === "ambassador_deleted" &&
        update.event.entity_id
      ) {
        ambassadors = ambassadors.filter(
          (item) => item.id !== update.event.entity_id,
        );
      }
      if (update.ambassador) {
        ambassadors = upsertById(ambassadors, update.ambassador).sort(
          (left, right) => Date.parse(right.created_at) - Date.parse(left.created_at),
        );
      }

      let employees = current.employees;
      if (update.event.event_type === "employee_deleted" && update.event.entity_id) {
        employees = employees.filter((item) => item.id !== update.event.entity_id);
      }
      if (update.profile) {
        const profileIsVisible =
          current.user.role === "admin" ||
          update.profile.team_id === current.user.team_id;
        employees = profileIsVisible
          ? upsertById(employees, update.profile).sort(
              (left, right) => Date.parse(right.created_at) - Date.parse(left.created_at),
            )
          : employees.filter((item) => item.id !== update.profile?.id);
      }

      let teams = current.teams;
      if (update.event.event_type === "team_deleted" && update.event.entity_id) {
        teams = teams.filter((item) => item.id !== update.event.entity_id);
      }
      if (update.teamPerformance) {
        teams = upsertById(teams, update.teamPerformance).sort((left, right) =>
          left.name.localeCompare(right.name),
        );
      }
      let salesPerformance = current.salesPerformance;
      if (update.event.event_type === "employee_deleted" && update.event.entity_id) {
        salesPerformance = salesPerformance.filter(
          (item) => item.id !== update.event.entity_id,
        );
      }
      if (update.salesPerformance) {
        salesPerformance = upsertById(
          salesPerformance,
          update.salesPerformance,
        ).sort((left, right) => right.registration_count - left.registration_count);
      }

      return {
        ...current,
        registrations,
        ambassadors,
        employees,
        teams,
        salesPerformance,
        summary: applySummary && update.summary ? update.summary : current.summary,
        pagination: applySummary && update.pagination ? update.pagination : current.pagination,
      };
    });
    if (applySummary && update.pagination && update.pagination.page !== page) {
      setPage(update.pagination.page);
    }
    scheduleReconciliation();
  }, [dateRange, debouncedSearch, groupFilter, load, memberFilter, page, reportingViewKey, scheduleReconciliation, teamFilter]);

  const loadLiveEventRef = useRef(loadLiveEvent);

  useEffect(() => {
    loadLiveEventRef.current = loadLiveEvent;
  }, [loadLiveEvent]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (loadedOnce.current) return;
    const initialLoad = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [load]);

  useEffect(() => {
    const userId = data?.user.id;
    if (!userId) return;
    const supabase = createBrowserSupabase();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | undefined;
    void (async () => {
      try {
        await supabase.realtime.setAuth();
        if (cancelled) return;
        channel = supabase
          .channel(`dashboard:user:${userId}`, { config: { private: true } })
          .on(
            "broadcast",
            { event: "dashboard_changed" },
            (message: { payload?: DashboardActivityEvent }) => {
              if (message.payload) void loadLiveEventRef.current(message.payload);
            },
          )
          .subscribe((status: string) => setLive(status === "SUBSCRIBED"));
      } catch {
        if (!cancelled) setLive(false);
      }
    })();
    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [data?.user.id]);

  useEffect(() => {
    const reconcile = () => {
      if (document.visibilityState === "visible") void load(true, true);
    };
    const interval = window.setInterval(reconcile, 60_000);
    document.addEventListener("visibilitychange", reconcile);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", reconcile);
      if (reconcileTimer.current) window.clearTimeout(reconcileTimer.current);
    };
  }, [load]);

  async function logout() {
    await createBrowserSupabase().auth.signOut();
    router.replace("/");
    router.refresh();
  }

  if (loading || !data) {
    return (
      <main className="dashboard-loading">
        <Image src="/persevex-logo.png" alt="Persevex" width={865} height={375} priority />
        <RefreshCw className="spin" />
        <p>Opening your dashboard...</p>
      </main>
    );
  }

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: "overview", label: "Overview", icon: <LayoutDashboard size={18} /> },
    ...(data.user.role === "admin"
      ? [{ id: "teams" as Tab, label: "Teams", icon: <Building2 size={18} /> }]
      : []),
    ...(data.user.role !== "sales"
      ? [
          {
            id: "employees" as Tab,
            label: data.user.role === "admin" ? "Employees" : "My team",
            icon: <UsersRound size={18} />,
          },
        ]
      : []),
    { id: "ambassadors", label: "Groups & CAs", icon: <Layers3 size={18} /> },
    { id: "leads", label: "Registrations", icon: <Clipboard size={18} /> },
  ];

  const filteredAmbassadors = data.ambassadors.filter((ambassador) => {
    return (
      (teamFilter === "all" || ambassador.team_id === teamFilter) &&
      (memberFilter === "all" || ambassador.sales_id === memberFilter) &&
      (groupFilter === "all" || ambassador.id === groupFilter) &&
      inDateRange(ambassador.created_at, dateRange)
    );
  });

  const filteredRegistrations = data.registrations.filter((lead) => {
    const needle = search.toLowerCase();
    return (
      (teamFilter === "all" || lead.credited_team_id === teamFilter) &&
      (memberFilter === "all" || lead.credited_sales_id === memberFilter) &&
      (groupFilter === "all" || lead.ambassador_id === groupFilter) &&
      inDateRange(lead.created_at, dateRange) &&
      (
        !needle ||
        lead.name.toLowerCase().includes(needle) ||
        lead.phone.includes(needle) ||
        lead.preferred_domain.toLowerCase().includes(needle) ||
        ambassadorLabel(lead).toLowerCase().includes(needle)
      )
    );
  });

  return (
    <div className="dashboard-shell">
      <aside className={`dashboard-sidebar ${sidebar ? "open" : ""}`}>
        <div className="sidebar-brand">
          <Image src="/persevex-logo.png" alt="Persevex" width={865} height={375} priority />
          <button className="icon-button mobile-only" onClick={() => setSidebar(false)}>
            <X size={20} />
          </button>
        </div>
        <div className="role-card">
          <span className="role-icon"><ShieldCheck size={18} /></span>
          <div>
            <strong>{roleLabel(data.user.role)}</strong>
            <span>Official access</span>
          </div>
        </div>
        <nav>
          {tabs.map((item) => (
            <button
              key={item.id}
              className={tab === item.id ? "active" : ""}
              onClick={() => {
                setTab(item.id);
                setSidebar(false);
              }}
            >
              {item.icon}
              {item.label}
              {tab === item.id && <ChevronRight size={16} />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="user-mini">
            <span>{data.user.full_name.slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>{data.user.full_name}</strong>
              <small>{data.user.email}</small>
            </div>
          </div>
          <button className="logout-button" onClick={logout}>
            <LogOut size={17} /> Sign out
          </button>
        </div>
      </aside>

      <main className="dashboard-main">
        <header className="dashboard-header">
          <button className="icon-button mobile-only" onClick={() => setSidebar(true)}>
            <Menu size={21} />
          </button>
          <div>
            <span className="eyebrow">{roleLabel(data.user.role).toUpperCase()}</span>
            <h1>{pageTitle(tab, data.user.role)}</h1>
          </div>
          <div className="header-actions">
            <span className={`live-pill ${live ? "connected" : ""}`}>
              <i /> {live ? "Live" : "Connecting"}
            </span>
            <button
              className="icon-button"
              title="Refresh"
              onClick={() => void load(true)}
              disabled={refreshing}
            >
              <RefreshCw size={18} className={refreshing ? "spin" : ""} />
            </button>
            {data.user.role === "admin" && tab === "teams" && (
              <button className="primary-button" onClick={() => setModal("team")}>
                <Plus size={17} /> Create team
              </button>
            )}
            {data.user.role === "admin" && tab === "employees" && (
              <>
                <button className="secondary-button" onClick={() => setModal("import")}>
                  <Upload size={17} /> Import CSV
                </button>
                <button className="primary-button" onClick={() => setModal("employee")}>
                  <UserPlus size={17} /> Add employee
                </button>
              </>
            )}
            {(data.user.role === "sales" || data.user.role === "team_lead") &&
              tab === "ambassadors" && (
              <button className="primary-button" onClick={() => setModal("ambassador")}>
                <Plus size={17} /> Create group
              </button>
            )}
          </div>
        </header>

        {error && <div className="alert error">{error}</div>}

        <div className="dashboard-content">
          {tab === "overview" && (
            <Overview
              data={data}
              ambassadors={filteredAmbassadors}
              filters={
                <ReportingFilters
                  data={data}
                  teamFilter={teamFilter}
                  groupFilter={groupFilter}
                  memberFilter={memberFilter}
                  dateRange={dateRange}
                  onGroupChange={(value) => {
                    setGroupFilter(value);
                    setPage(1);
                  }}
                  onTeamChange={(value) => {
                    setTeamFilter(value);
                    setMemberFilter("all");
                    setGroupFilter("all");
                    setPage(1);
                  }}
                  onMemberChange={(value) => {
                    setMemberFilter(value);
                    setGroupFilter("all");
                    setPage(1);
                  }}
                  onDateRangeChange={(value) => {
                    setDateRange(value);
                    setPage(1);
                  }}
                />
              }
              onUpdate={updateDashboard}
              onReconcile={scheduleReconciliation}
            />
          )}
          {tab === "teams" && (
            <TeamsView
              data={data}
              onViewTeam={(id) => {
                setTeamFilter(id);
                setMemberFilter("all");
                setGroupFilter("all");
                setDateRange("all");
                setPage(1);
                setTab("overview");
              }}
              onUpdate={updateDashboard}
              onReconcile={scheduleReconciliation}
            />
          )}
          {tab === "employees" && (
            <EmployeesView
              data={data}
              onViewMember={(id) => {
                const employee = data.employees.find((item) => item.id === id);
                setTeamFilter(employee?.team_id ?? "all");
                setMemberFilter(id);
                setGroupFilter("all");
                setPage(1);
                setTab("ambassadors");
              }}
              onUpdate={updateDashboard}
              onReconcile={scheduleReconciliation}
            />
          )}
          {tab === "ambassadors" && (
            <AmbassadorsView
              data={data}
              ambassadors={filteredAmbassadors}
              filters={
                <ReportingFilters
                  data={data}
                  teamFilter={teamFilter}
                  groupFilter={groupFilter}
                  memberFilter={memberFilter}
                  dateRange={dateRange}
                  onGroupChange={(value) => {
                    setGroupFilter(value);
                    setPage(1);
                  }}
                  onTeamChange={(value) => {
                    setTeamFilter(value);
                    setMemberFilter("all");
                    setGroupFilter("all");
                    setPage(1);
                  }}
                  onMemberChange={(value) => {
                    setMemberFilter(value);
                    setGroupFilter("all");
                    setPage(1);
                  }}
                  onDateRangeChange={(value) => {
                    setDateRange(value);
                    setPage(1);
                  }}
                />
              }
              onViewGroup={(id) => {
                setGroupFilter(id);
                setPage(1);
                setTab("leads");
              }}
              onUpdate={updateDashboard}
              onReconcile={scheduleReconciliation}
            />
          )}
          {tab === "leads" && (
            <section>
              <div className="table-toolbar">
                <div>
                  <h2>Student registrations</h2>
                  <p>{data.pagination.totalRows} registrations in this view</p>
                </div>
                <label className="search-box">
                  <Search size={17} />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search student, phone, or domain"
                  />
                </label>
              </div>
              <ReportingFilters
                data={data}
                teamFilter={teamFilter}
                groupFilter={groupFilter}
                memberFilter={memberFilter}
                dateRange={dateRange}
                onGroupChange={(value) => {
                  setGroupFilter(value);
                  setPage(1);
                }}
                onTeamChange={(value) => {
                  setTeamFilter(value);
                  setMemberFilter("all");
                  setGroupFilter("all");
                  setPage(1);
                }}
                onMemberChange={(value) => {
                  setMemberFilter(value);
                  setGroupFilter("all");
                  setPage(1);
                }}
                onDateRangeChange={(value) => {
                  setDateRange(value);
                  setPage(1);
                }}
              />
              <LeadViewSummary summary={data.summary} />
              <LeadsTable
                registrations={filteredRegistrations}
                canDelete={data.user.role !== "sales"}
                onUpdate={updateDashboard}
                onReconcile={scheduleReconciliation}
              />
              <Pagination
                page={data.pagination.page}
                totalPages={data.pagination.totalPages}
                totalRows={data.pagination.totalRows}
                onPageChange={setPage}
              />
            </section>
          )}
        </div>
      </main>

      {modal && (
        <Modal onClose={() => setModal(null)}>
          {modal === "team" && (
            <TeamForm
              onPending={(team) => {
                setModal(null);
                updateDashboard((current) => ({
                  ...current,
                  teams: upsertById(current.teams, team).sort((left, right) =>
                    left.name.localeCompare(right.name),
                  ),
                }));
              }}
              onDone={(pendingId, team) => {
                updateDashboard((current) => ({
                  ...current,
                  teams: upsertById(
                    current.teams.filter((item) => item.id !== pendingId),
                    team,
                  ).sort((left, right) => left.name.localeCompare(right.name)),
                }));
                scheduleReconciliation();
              }}
              onFailed={(pendingId, message) => {
                updateDashboard((current) => ({
                  ...current,
                  teams: current.teams.filter((item) => item.id !== pendingId),
                }));
                setError(message);
              }}
            />
          )}
          {modal === "employee" && (
            <EmployeeForm
              teams={data.teams}
              onPending={(employee) => {
                setModal(null);
                updateDashboard((current) => {
                  const performance = {
                    id: employee.id,
                    full_name: employee.full_name,
                    email: employee.email,
                    phone: employee.phone,
                    team_id: employee.team_id,
                    active: true,
                    ambassador_count: 0,
                    active_ambassador_count: 0,
                    registration_count: 0,
                    qualified_ambassador_count: 0,
                  };
                  return {
                    ...current,
                    employees: upsertById(current.employees, employee),
                    teams: current.teams.map((team) =>
                      team.id === employee.team_id && employee.role === "sales"
                        ? { ...team, sales_count: team.sales_count + 1 }
                        : team,
                    ),
                    salesPerformance:
                      employee.role === "sales"
                        ? upsertById(current.salesPerformance, performance)
                        : current.salesPerformance,
                  };
                });
              }}
              onDone={(pendingId, employee) => {
                updateDashboard((current) => ({
                  ...current,
                  employees: upsertById(
                    current.employees.filter((item) => item.id !== pendingId),
                    employee,
                  ),
                  salesPerformance: current.salesPerformance.map((member) =>
                    member.id === pendingId
                      ? {
                          ...member,
                          id: employee.id,
                          full_name: employee.full_name,
                          email: employee.email,
                          phone: employee.phone,
                          team_id: employee.team_id,
                        }
                      : member,
                  ),
                }));
                scheduleReconciliation();
              }}
              onFailed={(pendingEmployee, message) => {
                updateDashboard((current) => ({
                  ...current,
                  employees: current.employees.filter(
                    (item) => item.id !== pendingEmployee.id,
                  ),
                  salesPerformance: current.salesPerformance.filter(
                    (member) => member.id !== pendingEmployee.id,
                  ),
                  teams: current.teams.map((team) =>
                    pendingEmployee.role === "sales" &&
                    team.id === pendingEmployee.team_id
                      ? { ...team, sales_count: Math.max(0, team.sales_count - 1) }
                      : team,
                  ),
                }));
                setError(message);
              }}
            />
          )}
          {modal === "import" && (
            <EmployeeImport
              teams={data.teams}
              onDone={(employees) => {
                updateDashboard((current) => {
                  const newEmployees = employees.filter(
                    (employee) => !current.employees.some((item) => item.id === employee.id),
                  );
                  const sales = newEmployees.filter((employee) => employee.role === "sales");
                  return {
                    ...current,
                    employees: [
                      ...newEmployees,
                      ...current.employees.filter(
                        (employee) => !newEmployees.some((item) => item.id === employee.id),
                      ),
                    ],
                    teams: current.teams.map((team) => ({
                      ...team,
                      sales_count:
                        team.sales_count +
                        sales.filter((employee) => employee.team_id === team.id).length,
                    })),
                    salesPerformance: [
                      ...sales.map((employee) => ({
                        id: employee.id,
                        full_name: employee.full_name,
                        email: employee.email,
                        phone: employee.phone,
                        team_id: employee.team_id,
                        active: true,
                        ambassador_count: 0,
                        active_ambassador_count: 0,
                        registration_count: 0,
                        qualified_ambassador_count: 0,
                      })),
                      ...current.salesPerformance.filter(
                        (member) => !sales.some((employee) => employee.id === member.id),
                      ),
                    ],
                  };
                });
                scheduleReconciliation();
              }}
            />
          )}
          {modal === "ambassador" && (
            <AmbassadorForm
              user={data.user}
              target={data.defaultTarget}
              onPending={(ambassador) => {
                setModal(null);
                updateDashboard((current) => {
                  return {
                    ...current,
                    ambassadors: upsertById(current.ambassadors, ambassador),
                    teams: current.teams.map((team) =>
                      team.id === ambassador.team_id
                        ? { ...team, ambassador_count: team.ambassador_count + 1 }
                        : team,
                    ),
                    salesPerformance: current.salesPerformance.map((member) =>
                      member.id === ambassador.sales_id
                        ? {
                            ...member,
                            ambassador_count: member.ambassador_count + 1,
                            active_ambassador_count: member.active_ambassador_count + 1,
                          }
                        : member,
                    ),
                    summary: {
                      ...current.summary,
                      ambassadorCount: current.summary.ambassadorCount + 1,
                      activeAmbassadorCount: current.summary.activeAmbassadorCount + 1,
                    },
                  };
                });
              }}
              onDone={(pendingId, ambassador) => {
                updateDashboard((current) => ({
                  ...current,
                  ambassadors: upsertById(
                    current.ambassadors.filter((item) => item.id !== pendingId),
                    ambassador,
                  ),
                }));
                scheduleReconciliation();
              }}
              onFailed={(pendingAmbassador, message) => {
                updateDashboard((current) => ({
                  ...current,
                  ambassadors: current.ambassadors.filter(
                    (item) => item.id !== pendingAmbassador.id,
                  ),
                  teams: current.teams.map((team) =>
                    team.id === pendingAmbassador.team_id
                      ? {
                          ...team,
                          ambassador_count: Math.max(0, team.ambassador_count - 1),
                        }
                      : team,
                  ),
                  salesPerformance: current.salesPerformance.map((member) =>
                    member.id === pendingAmbassador.sales_id
                      ? {
                          ...member,
                          ambassador_count: Math.max(0, member.ambassador_count - 1),
                          active_ambassador_count: Math.max(
                            0,
                            member.active_ambassador_count - 1,
                          ),
                        }
                      : member,
                  ),
                  summary: {
                    ...current.summary,
                    ambassadorCount: Math.max(0, current.summary.ambassadorCount - 1),
                    activeAmbassadorCount: Math.max(
                      0,
                      current.summary.activeAmbassadorCount - 1,
                    ),
                  },
                }));
                setError(message);
              }}
            />
          )}
        </Modal>
      )}
    </div>
  );
}

function pageTitle(tab: Tab, role: AppRole) {
  if (tab === "overview") {
    return role === "admin"
      ? "Organization overview"
      : role === "team_lead"
        ? "Team performance"
        : "Your lead generation";
  }
  if (tab === "teams") return "Teams";
  if (tab === "employees") return role === "admin" ? "Employees" : "Team members";
  if (tab === "ambassadors") return "Groups & Campus Ambassadors";
  return "Registrations";
}

function Overview({
  data,
  ambassadors,
  filters,
  onUpdate,
  onReconcile,
}: {
  data: DashboardData;
  ambassadors: DashboardData["ambassadors"];
  filters: React.ReactNode;
  onUpdate: DashboardUpdater;
  onReconcile: () => void;
}) {
  return (
    <section className="overview-stack">
      {filters}
      <div className="metric-grid">
        <MetricCard
          label="Registrations"
          value={data.summary.registrationCount}
          detail="Valid registrations in your scope"
          icon={<Clipboard size={21} />}
        />
        <MetricCard
          label="Campus Ambassadors"
          value={data.summary.ambassadorCount}
          detail={`${data.summary.activeAmbassadorCount} currently active`}
          icon={<Users size={21} />}
        />
        <MetricCard
          label="Qualified"
          value={data.summary.qualifiedAmbassadorCount}
          detail={`Reached their individual target`}
          icon={<Award size={21} />}
        />
        <MetricCard
          label={data.user.role === "admin" ? "Group creators" : "Team target"}
          value={
            data.user.role === "admin"
              ? data.summary.groupCreatorCount
              : data.defaultTarget
          }
          detail={
            data.user.role === "admin"
              ? "Members represented in this view"
              : "Default registrations per ambassador"
          }
          icon={<Target size={21} />}
        />
      </div>

      <div
        className={`overview-grid ${
          data.user.role === "admin" ? "" : "single-column"
        }`}
      >
        <div className="panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">PERFORMANCE</span>
              <h2>Ambassador progress</h2>
            </div>
            <span className="panel-count">{ambassadors.length}</span>
          </div>
          <div className="progress-list">
            {ambassadors.slice(0, 6).map((ambassador) => (
              <div key={ambassador.id} className="progress-list-row">
                <div className="avatar">{ambassador.name[0]}</div>
                <div className="progress-list-main">
                  <div>
                    <strong>{ambassador.name}</strong>
                    <span>{ambassador.college}</span>
                  </div>
                  <div className="mini-track">
                    <span
                      style={{
                        width: `${Math.min(100, (ambassador.registration_count / ambassador.target) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
                <strong>
                  {ambassador.registration_count}/{ambassador.target}
                </strong>
              </div>
            ))}
            {!ambassadors.length && (
              <EmptyState
                title="No groups in view"
                text="No groups match the selected team, member, group, and date filters."
              />
            )}
          </div>
        </div>

        {data.user.role === "admin" && (
          <div className="panel settings-panel">
            <DefaultTargetForm
              value={data.defaultTarget}
              onChange={(target) =>
                onUpdate((current) => ({ ...current, defaultTarget: target }))
              }
              onReconcile={onReconcile}
            />
          </div>
        )}
      </div>
      <ReportingInsights data={data} />
    </section>
  );
}

function ReportingFilters({
  data,
  teamFilter,
  groupFilter,
  memberFilter,
  dateRange,
  onTeamChange,
  onGroupChange,
  onMemberChange,
  onDateRangeChange,
}: {
  data: DashboardData;
  teamFilter: string;
  groupFilter: string;
  memberFilter: string;
  dateRange: DateRange;
  onTeamChange: (value: string) => void;
  onGroupChange: (value: string) => void;
  onMemberChange: (value: string) => void;
  onDateRangeChange: (value: DateRange) => void;
}) {
  const creators = data.employees.filter(
    (employee) =>
      (employee.role === "sales" || employee.role === "team_lead") &&
      (teamFilter === "all" || employee.team_id === teamFilter) &&
      data.ambassadors.some((ambassador) => ambassador.sales_id === employee.id),
  );
  const groups = data.ambassadors.filter(
    (ambassador) =>
      (teamFilter === "all" || ambassador.team_id === teamFilter) &&
      (memberFilter === "all" || ambassador.sales_id === memberFilter),
  );

  return (
    <div className="reporting-filters">
      <div className="filter-heading">
        <BarChart3 size={17} />
        <span><strong>Reporting view</strong><small>Filter every number below</small></span>
      </div>
      {data.user.role === "admin" && (
        <label>
          Team
          <select
            value={teamFilter}
            onChange={(event) => onTeamChange(event.target.value)}
          >
            <option value="all">All teams</option>
            {data.teams.map((team) => (
              <option key={team.id} value={team.id}>{team.name}</option>
            ))}
          </select>
        </label>
      )}
      {creators.length > 1 && (
        <label>
          Team member
          <select value={memberFilter} onChange={(event) => onMemberChange(event.target.value)}>
            <option value="all">All team members</option>
            {creators.map((creator) => (
              <option key={creator.id} value={creator.id}>{creator.full_name}</option>
            ))}
          </select>
        </label>
      )}
      <label>
        Group / Campus Ambassador
        <select value={groupFilter} onChange={(event) => onGroupChange(event.target.value)}>
          <option value="all">All groups</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name} · {group.college}
            </option>
          ))}
        </select>
      </label>
      <label>
        Date
        <select
          value={dateRange}
          onChange={(event) => onDateRangeChange(event.target.value as DateRange)}
        >
          <option value="all">All time</option>
          <option value="today">Today</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>
      </label>
    </div>
  );
}

function LeadViewSummary({ summary }: { summary: DashboardData["summary"] }) {
  return (
    <div className="lead-view-summary">
      <span><strong>{summary.registrationCount}</strong> Valid registrations</span>
      <span><strong>{summary.todayRegistrationCount}</strong> Today</span>
      <span><strong>{summary.groupsRepresentedCount}</strong> Groups represented</span>
      <span><strong>{summary.convertedCount}</strong> Converted</span>
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  totalRows,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  totalRows: number;
  onPageChange: (page: number) => void;
}) {
  if (totalRows <= 50) return null;
  return (
    <div className="pagination-bar">
      <span>
        Page <strong>{page}</strong> of <strong>{totalPages}</strong>
      </span>
      <div>
        <button
          className="secondary-button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </button>
        <button
          className="secondary-button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

function ReportingInsights({ data }: { data: DashboardData }) {
  const creatorNames = new Map(
    data.employees.map((employee) => [employee.id, employee.full_name]),
  );
  const days = data.summary.daily.map((item) => ({
    date: new Date(`${item.date}T00:00:00+05:30`),
    count: item.count,
  }));
  const max = Math.max(1, ...days.map((day) => day.count));
  const ambassadorsById = new Map(
    data.ambassadors.map((item) => [item.id, item]),
  );
  const groupRows = data.summary.groupRankings.flatMap((ranking) => {
    const ambassador = ambassadorsById.get(ranking.ambassadorId);
    return ambassador
      ? [{ ...ambassador, visibleCount: ranking.registrationCount }]
      : [];
  });

  return (
    <div className="insights-grid">
      <section className="panel daily-panel">
        <div className="panel-head">
          <div><span className="eyebrow">DAY-WISE VIEW</span><h2>Last 14 days</h2></div>
          <CalendarDays size={20} />
        </div>
        <div className="daily-chart">
          {days.map((day) => (
            <div className="daily-bar-column" key={day.date.toISOString()}>
              <span className="daily-count">{day.count || ""}</span>
              <span
                className="daily-bar"
                style={{ height: `${Math.max(5, (day.count / max) * 100)}%` }}
              />
              <small>{day.date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</small>
            </div>
          ))}
        </div>
      </section>
      <section className="panel group-ranking-panel">
        <div className="panel-head">
          <div><span className="eyebrow">GROUP-WISE VIEW</span><h2>Registration sources</h2></div>
          <Layers3 size={20} />
        </div>
        <div className="group-ranking-list">
          {groupRows.map((group) => (
            <div key={group.id}>
              <span className="avatar">{group.name[0]}</span>
              <span><strong>{group.name}</strong><small>{creatorNames.get(group.sales_id) ?? "Team member"} · {group.college}</small></span>
              <b>{group.visibleCount}</b>
            </div>
          ))}
          {!groupRows.length && <EmptyState title="No groups in view" text="Adjust the filters or create a group." />}
        </div>
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: number;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <article className="metric-card">
      <div className="metric-top">
        <span>{label}</span>
        <span className="metric-icon">{icon}</span>
      </div>
      <strong>{value.toLocaleString("en-IN")}</strong>
      <p>{detail}</p>
    </article>
  );
}

function TeamsView({
  data,
  onViewTeam,
  onUpdate,
  onReconcile,
}: {
  data: DashboardData;
  onViewTeam: (id: string) => void;
  onUpdate: DashboardUpdater;
  onReconcile: () => void;
}) {
  const teamLeadByTeam = new Map(
    data.employees
      .filter((employee) => employee.role === "team_lead")
      .map((employee) => [employee.team_id, employee]),
  );
  async function toggleTeam(id: string, active: boolean) {
    onUpdate((current) => ({
      ...current,
      teams: current.teams.map((team) =>
        team.id === id ? { ...team, active } : team,
      ),
    }));
    const response = await dashboardMutation(`/api/teams/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
    if (!response.ok) {
      onUpdate((current) => ({
        ...current,
        teams: current.teams.map((team) =>
          team.id === id ? { ...team, active: !active } : team,
        ),
      }));
      window.alert(await readError(response));
      return;
    }
    onReconcile();
  }

  async function removeTeam(id: string, name: string) {
    const confirmed = window.confirm(
      `Permanently delete the ${name} team? Delete its employees and groups first. This cannot be undone.`,
    );
    if (!confirmed) return;

    const removedTeam = data.teams.find((team) => team.id === id);
    onUpdate((current) => ({
      ...current,
      teams: current.teams.filter((team) => team.id !== id),
    }));
    const response = await dashboardMutation(`/api/teams/${id}`, { method: "DELETE" });
    if (!response.ok) {
      if (removedTeam) {
        onUpdate((current) => ({
          ...current,
          teams: [removedTeam, ...current.teams].sort((left, right) =>
            left.name.localeCompare(right.name),
          ),
        }));
      }
      window.alert(await readError(response));
      return;
    }
    onReconcile();
  }
  return (
    <section>
      <div className="table-toolbar">
        <div>
          <h2>Organization teams</h2>
          <p>Create teams, then assign one Team Lead and Sales members.</p>
        </div>
      </div>
      <div className="card-grid">
        {data.teams.map((team) => {
          const lead = teamLeadByTeam.get(team.id);
          const pending = team.id.startsWith("pending-");
          return (
            <article className="team-card" key={team.id}>
              <div className="team-card-head">
                <span className="team-icon"><Building2 size={21} /></span>
                <span className={`status-dot ${team.active ? "active" : ""}`}>
                  {pending ? "Creating" : team.active ? "Active" : "Inactive"}
                </span>
              </div>
              <h3>{team.name}</h3>
              <p>{lead ? `Led by ${lead.full_name}` : "Team Lead not assigned"}</p>
              <div className="team-stats">
                <span><strong>{team.sales_count}</strong> Sales</span>
                <span><strong>{team.ambassador_count}</strong> CAs</span>
                <span><strong>{team.registration_count}</strong> Registrations</span>
              </div>
              <div className="team-card-actions">
                <button
                  className="primary-button"
                  onClick={() => onViewTeam(team.id)}
                  disabled={pending}
                >
                  <BarChart3 size={16} /> View performance
                </button>
                <button
                  className="team-toggle"
                  onClick={() => void toggleTeam(team.id, !team.active)}
                  disabled={pending}
                >
                  {team.active ? "Deactivate team" : "Reactivate team"}
                </button>
                <button
                  className="danger-button"
                  onClick={() => void removeTeam(team.id, team.name)}
                  disabled={pending}
                >
                  <Trash2 size={16} /> Delete team
                </button>
              </div>
            </article>
          );
        })}
        {!data.teams.length && (
          <EmptyState title="No teams yet" text="Create the first team to begin." />
        )}
      </div>
    </section>
  );
}

function EmployeesView({
  data,
  onViewMember,
  onUpdate,
  onReconcile,
}: {
  data: DashboardData;
  onViewMember: (id: string) => void;
  onUpdate: DashboardUpdater;
  onReconcile: () => void;
}) {
  const teamNames = new Map(data.teams.map((team) => [team.id, team.name]));

  async function patchEmployee(id: string, body: Record<string, unknown>) {
    const previous = data.employees.find((employee) => employee.id === id);
    if (!previous) return;
    const previousPerformance = data.salesPerformance.find(
      (member) => member.id === id,
    );
    const nextTeamId =
      typeof body.teamId === "string" ? body.teamId : previous.team_id;
    const nextActive =
      typeof body.active === "boolean" ? body.active : previous.active;
    const teamChanged = nextTeamId !== previous.team_id;
    const ambassadorCount = previousPerformance?.ambassador_count ?? 0;
    onUpdate((current) => ({
      ...current,
      employees: current.employees.map((employee) =>
        employee.id === id
          ? {
              ...employee,
              ...(typeof body.active === "boolean" ? { active: body.active } : {}),
              ...(typeof body.teamId === "string" ? { team_id: body.teamId } : {}),
            }
          : employee,
      ),
      salesPerformance: current.salesPerformance.map((member) =>
        member.id === id
          ? { ...member, team_id: nextTeamId, active: nextActive }
          : member,
      ),
      ambassadors: teamChanged
        ? current.ambassadors.map((ambassador) =>
            ambassador.sales_id === id && nextTeamId
              ? { ...ambassador, team_id: nextTeamId }
              : ambassador,
          )
        : current.ambassadors,
      teams: current.teams.map((team) => {
        if (previous.role !== "sales") return team;
        const salesDelta =
          (nextActive && team.id === nextTeamId ? 1 : 0) -
          (previous.active && team.id === previous.team_id ? 1 : 0);
        const ambassadorDelta = teamChanged
          ? (team.id === nextTeamId ? ambassadorCount : 0) -
            (team.id === previous.team_id ? ambassadorCount : 0)
          : 0;
        return salesDelta || ambassadorDelta
          ? {
              ...team,
              sales_count: Math.max(0, team.sales_count + salesDelta),
              ambassador_count: Math.max(
                0,
                team.ambassador_count + ambassadorDelta,
              ),
            }
          : team;
      }),
    }));
    const response = await dashboardMutation(`/api/employees/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      onUpdate((current) => ({
        ...current,
        employees: current.employees.map((employee) =>
          employee.id === id ? previous : employee,
        ),
        salesPerformance: current.salesPerformance.map((member) =>
          member.id === id && previousPerformance ? previousPerformance : member,
        ),
        ambassadors: teamChanged
          ? current.ambassadors.map((ambassador) =>
              ambassador.sales_id === id && previous.team_id
                ? { ...ambassador, team_id: previous.team_id }
                : ambassador,
            )
          : current.ambassadors,
        teams: current.teams.map((team) => {
          if (previous.role !== "sales") return team;
          const salesDelta =
            (previous.active && team.id === previous.team_id ? 1 : 0) -
            (nextActive && team.id === nextTeamId ? 1 : 0);
          const ambassadorDelta = teamChanged
            ? (team.id === previous.team_id ? ambassadorCount : 0) -
              (team.id === nextTeamId ? ambassadorCount : 0)
            : 0;
          return salesDelta || ambassadorDelta
            ? {
                ...team,
                sales_count: Math.max(0, team.sales_count + salesDelta),
                ambassador_count: Math.max(
                  0,
                  team.ambassador_count + ambassadorDelta,
                ),
              }
            : team;
        }),
      }));
      window.alert(await readError(response));
      return;
    }
    onReconcile();
  }

  async function removeEmployee(id: string, name: string) {
    const confirmed = window.confirm(
      `Permanently delete ${name}'s employee account? Delete their groups first. This cannot be undone.`,
    );
    if (!confirmed) return;

    const removedEmployee = data.employees.find((employee) => employee.id === id);
    const removedPerformance = data.salesPerformance.find((member) => member.id === id);
    onUpdate((current) => ({
      ...current,
      employees: current.employees.filter((employee) => employee.id !== id),
      salesPerformance: current.salesPerformance.filter((member) => member.id !== id),
      teams: current.teams.map((team) =>
        removedEmployee?.role === "sales" && team.id === removedEmployee.team_id
          ? { ...team, sales_count: Math.max(0, team.sales_count - 1) }
          : team,
      ),
    }));
    const response = await dashboardMutation(`/api/employees/${id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      if (removedEmployee) {
        onUpdate((current) => ({
          ...current,
          employees: [removedEmployee, ...current.employees],
          salesPerformance: removedPerformance
            ? [removedPerformance, ...current.salesPerformance]
            : current.salesPerformance,
          teams: current.teams.map((team) =>
            removedEmployee.role === "sales" && team.id === removedEmployee.team_id
              ? { ...team, sales_count: team.sales_count + 1 }
              : team,
          ),
        }));
      }
      window.alert(await readError(response));
      return;
    }
    onReconcile();
  }

  return (
    <section>
      <div className="table-toolbar">
        <div>
          <h2>{data.user.role === "admin" ? "Employee access" : "Assigned team"}</h2>
          <p>
            {data.user.role === "admin"
              ? "Create accounts, assign teams, and suspend access."
              : "Performance and assignments inside your team."}
          </p>
        </div>
      </div>
      <div className="data-table">
        <div className="data-row employee-grid table-header">
          <span>Employee</span><span>Role</span><span>Team</span><span>Status</span><span>Performance</span><span />
        </div>
        {data.employees.map((employee) => {
          const pending = employee.id.startsWith("pending-");
          const performance = data.salesPerformance.find(
            (item) => item.id === employee.id,
          );
          return (
            <div className="data-row employee-grid" key={employee.id}>
              <div className="identity-cell">
                <span className="avatar">{employee.full_name[0]}</span>
                <div><strong>{employee.full_name}</strong><small>{employee.email}</small></div>
              </div>
              <span className="role-tag">{roleLabel(employee.role)}</span>
              {data.user.role === "admin" && employee.role !== "admin" ? (
                <select
                  value={employee.team_id ?? ""}
                  disabled={pending}
                  onChange={(event) =>
                    void patchEmployee(employee.id, { teamId: event.target.value })
                  }
                >
                  <option value="" disabled>Select team</option>
                  {data.teams.map((team) => (
                    <option key={team.id} value={team.id}>{team.name}</option>
                  ))}
                </select>
              ) : (
                <span>{employee.team_id ? teamNames.get(employee.team_id) : "All teams"}</span>
              )}
              <span className={`status-dot ${employee.active ? "active" : ""}`}>
                {pending ? "Creating" : employee.active ? "Active" : "Suspended"}
              </span>
              <span>
                {performance
                  ? `${performance.registration_count} registrations`
                  : employee.role === "team_lead"
                    ? "Team oversight"
                    : "Organization access"}
              </span>
              <div className="row-actions">
                {(employee.role === "sales" || employee.role === "team_lead") &&
                  data.ambassadors.some((item) => item.sales_id === employee.id) && (
                    <button className="text-button" onClick={() => onViewMember(employee.id)}>
                      View groups
                    </button>
                  )}
                {data.user.role === "admin" && employee.role !== "admin" && (
                  <>
                    <button
                      className="text-button danger-text"
                      disabled={pending}
                      onClick={() =>
                        void patchEmployee(employee.id, { active: !employee.active })
                      }
                    >
                      {employee.active ? "Suspend" : "Reactivate"}
                    </button>
                    <button
                      className="icon-button danger-icon"
                      title="Delete employee"
                      disabled={pending}
                      onClick={() =>
                        void removeEmployee(employee.id, employee.full_name)
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AmbassadorsView({
  data,
  ambassadors,
  filters,
  onViewGroup,
  onUpdate,
  onReconcile,
}: {
  data: DashboardData;
  ambassadors: DashboardData["ambassadors"];
  filters: React.ReactNode;
  onViewGroup: (id: string) => void;
  onUpdate: DashboardUpdater;
  onReconcile: () => void;
}) {
  const creatorNames = new Map(
    data.employees.map((employee) => [employee.id, employee.full_name]),
  );
  async function update(id: string, body: Record<string, unknown>) {
    const previous = data.ambassadors.find((ambassador) => ambassador.id === id);
    const optimisticStatus =
      body.status === "active" || body.status === "paused" ? body.status : null;
    if (optimisticStatus) {
      onUpdate((current) => ({
        ...current,
        ambassadors: current.ambassadors.map((ambassador) =>
          ambassador.id === id ? { ...ambassador, status: optimisticStatus } : ambassador,
        ),
      }));
    }
    const response = await dashboardMutation(`/api/ambassadors/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      if (previous) {
        onUpdate((current) => ({
          ...current,
          ambassadors: current.ambassadors.map((ambassador) =>
            ambassador.id === id ? previous : ambassador,
          ),
        }));
      }
      window.alert(await readError(response));
      return;
    }
    const payload = await response.json() as {
      ambassador?: Partial<AmbassadorPerformance> & { id: string };
    };
    if (payload.ambassador) {
      onUpdate((current) => ({
        ...current,
        ambassadors: current.ambassadors.map((ambassador) =>
          ambassador.id === id ? { ...ambassador, ...payload.ambassador } : ambassador,
        ),
      }));
    }
    onReconcile();
  }

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
  }

  async function remove(
    id: string,
    name: string,
    registrationCount: number,
  ) {
    const confirmed = window.confirm(
      `Permanently delete ${name}'s group and its ${registrationCount} registration${registrationCount === 1 ? "" : "s"}? This cannot be undone.`,
    );
    if (!confirmed) return;

    const removedAmbassador = data.ambassadors.find((item) => item.id === id);
    const removedRegistrations = data.registrations.filter(
      (registration) => registration.ambassador_id === id,
    );
    onUpdate((current) => ({
      ...current,
      ambassadors: current.ambassadors.filter((item) => item.id !== id),
      registrations: current.registrations.filter(
        (registration) => registration.ambassador_id !== id,
      ),
      teams: current.teams.map((team) =>
        removedAmbassador && team.id === removedAmbassador.team_id
          ? {
              ...team,
              ambassador_count: Math.max(0, team.ambassador_count - 1),
              registration_count: Math.max(
                0,
                team.registration_count - removedAmbassador.registration_count,
              ),
            }
          : team,
      ),
    }));
    const response = await dashboardMutation(`/api/ambassadors/${id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      if (removedAmbassador) {
        onUpdate((current) => ({
          ...current,
          ambassadors: [removedAmbassador, ...current.ambassadors],
          registrations: [...removedRegistrations, ...current.registrations].sort(
            (left, right) => Date.parse(right.created_at) - Date.parse(left.created_at),
          ),
          teams: current.teams.map((team) =>
            team.id === removedAmbassador.team_id
              ? {
                  ...team,
                  ambassador_count: team.ambassador_count + 1,
                  registration_count:
                    team.registration_count + removedAmbassador.registration_count,
                }
              : team,
          ),
        }));
      }
      window.alert(await readError(response));
      return;
    }
    onReconcile();
  }

  return (
    <section>
      <div className="table-toolbar">
        <div>
          <h2>Groups and Campus Ambassadors</h2>
          <p>One Campus Ambassador equals one group and one registration source.</p>
        </div>
      </div>
      {filters}
      <div className="ambassador-grid">
        {ambassadors.map((ambassador) => {
          const pending = ambassador.id.startsWith("pending-");
          const link = `${publicBaseUrl()}/join/${ambassador.public_slug}`;
          const progressLink = `${publicBaseUrl()}/ca/${ambassador.progress_key}`;
          const draft = `Hi! Persevex is accepting student registrations for internship and career opportunities across 23 domains, real-world projects, live mentor access, and up to INR 18,000-25,000 stipend based upon performance.\n\nChoose your preferred domain and register through my official invitation:\n${link}`;
          const percentage = Math.min(
            100,
            Math.round((ambassador.registration_count / ambassador.target) * 100),
          );
          return (
            <article className="ambassador-card" key={ambassador.id}>
              <div className="ambassador-head">
                <span className="avatar large">{ambassador.name[0]}</span>
                <div>
                  <h3>{ambassador.name}</h3>
                  <p>{ambassador.college}</p>
                  <small>Created by {creatorNames.get(ambassador.sales_id) ?? "Team member"}</small>
                </div>
                <span className={`status-dot ${ambassador.status === "active" ? "active" : ""}`}>
                  {pending ? "creating" : ambassador.status}
                </span>
              </div>
              <div className="ambassador-progress-line">
                <div>
                  <strong>{ambassador.registration_count}</strong>
                  <span>of {ambassador.target} to qualify</span>
                </div>
                <span className={ambassador.qualified ? "qualified-badge" : "goal-badge"}>
                  {ambassador.qualified ? "Qualified" : `${percentage}%`}
                </span>
              </div>
              <div className="mini-track large"><span style={{ width: `${percentage}%` }} /></div>
              <div className="link-actions">
                <button disabled={pending} onClick={() => void copy(draft)}><Copy size={16} /> WhatsApp draft</button>
                <button disabled={pending} onClick={() => void copy(link)}><Link2 size={16} /> Referral link</button>
                <button disabled={pending} onClick={() => void copy(progressLink)}><Target size={16} /> Progress link</button>
              </div>
              <button
                className="view-group-button"
                onClick={() => onViewGroup(ambassador.id)}
                disabled={pending}
              >
                View registrations from this group <ChevronRight size={16} />
              </button>
              <div className="ambassador-footer">
                <span>{ambassador.phone}</span>
                <div>
                  <button
                    className="icon-button"
                    disabled={pending}
                    title={ambassador.status === "active" ? "Pause link" : "Reactivate link"}
                    onClick={() =>
                      void update(ambassador.id, {
                        status: ambassador.status === "active" ? "paused" : "active",
                      })
                    }
                  >
                    <PauseCircle size={17} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={pending}
                    title="Regenerate private progress link"
                    onClick={() => {
                      if (window.confirm("Replace the existing private progress link?")) {
                        void update(ambassador.id, { regenerateProgressLink: true });
                      }
                    }}
                  >
                    <RefreshCw size={17} />
                  </button>
                  {data.user.role !== "sales" && (
                    <button
                      className="icon-button danger-icon"
                      disabled={pending}
                      title="Delete group and registrations"
                      onClick={() =>
                        void remove(
                          ambassador.id,
                          ambassador.name,
                          ambassador.registration_count,
                        )
                      }
                    >
                      <Trash2 size={17} />
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
        {!ambassadors.length && (
          <EmptyState
            title="No groups in view"
            text="No groups match the selected team, member, group, and date filters."
          />
        )}
      </div>
    </section>
  );
}

function LeadsTable({
  registrations,
  canDelete,
  onUpdate,
  onReconcile,
}: {
  registrations: Registration[];
  canDelete: boolean;
  onUpdate: DashboardUpdater;
  onReconcile: () => void;
}) {
  return (
    <div className="data-table">
      <div className="data-row lead-grid table-header">
        <span>Student</span><span>Group / CA</span><span>Domain</span><span>Registered</span><span>Status</span><span>Follow-up note</span><span />
      </div>
      {registrations.map((lead) => (
        <LeadRow
          key={lead.id}
          lead={lead}
          canDelete={canDelete}
          onUpdate={onUpdate}
          onReconcile={onReconcile}
        />
      ))}
      {!registrations.length && (
        <EmptyState
          title="No registrations found"
          text="New student registrations will appear here."
        />
      )}
    </div>
  );
}

function LeadRow({
  lead,
  canDelete,
  onUpdate,
  onReconcile,
}: {
  lead: Registration;
  canDelete: boolean;
  onUpdate: DashboardUpdater;
  onReconcile: () => void;
}) {
  const [status, setStatus] = useState<RegistrationStatus>(lead.status);
  const [note, setNote] = useState(lead.note);
  const [saving, setSaving] = useState(false);

  async function save() {
    const previousStatus = lead.status;
    const previousNote = lead.note;
    onUpdate((current) => ({
      ...current,
      registrations: current.registrations.map((registration) =>
        registration.id === lead.id
          ? { ...registration, status, note, updated_at: new Date().toISOString() }
          : registration,
      ),
    }));
    setSaving(true);
    const response = await dashboardMutation(`/api/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, note }),
    });
    setSaving(false);
    if (!response.ok) {
      onUpdate((current) => ({
        ...current,
        registrations: current.registrations.map((registration) =>
          registration.id === lead.id
            ? { ...registration, status: previousStatus, note: previousNote }
            : registration,
        ),
      }));
      setStatus(previousStatus);
      setNote(previousNote);
      window.alert(await readError(response));
      return;
    }
    onReconcile();
  }

  async function remove() {
    const confirmed = window.confirm(
      `Permanently delete ${lead.name}'s registration? This cannot be undone.`,
    );
    if (!confirmed) return;

    onUpdate((current) => ({
      ...current,
      registrations: current.registrations.filter(
        (registration) => registration.id !== lead.id,
      ),
      summary: {
        ...current.summary,
        registrationRowCount: Math.max(0, current.summary.registrationRowCount - 1),
        registrationCount: Math.max(
          0,
          current.summary.registrationCount - (lead.status === "invalid" ? 0 : 1),
        ),
        convertedCount: Math.max(
          0,
          current.summary.convertedCount - (lead.status === "converted" ? 1 : 0),
        ),
      },
      pagination: {
        ...current.pagination,
        totalRows: Math.max(0, current.pagination.totalRows - 1),
      },
    }));
    setSaving(true);
    const response = await dashboardMutation(`/api/leads/${lead.id}`, {
      method: "DELETE",
    });
    setSaving(false);
    if (!response.ok) {
      onUpdate((current) => ({
        ...current,
        registrations: [lead, ...current.registrations].sort(
          (left, right) => Date.parse(right.created_at) - Date.parse(left.created_at),
        ),
        summary: {
          ...current.summary,
          registrationRowCount: current.summary.registrationRowCount + 1,
          registrationCount:
            current.summary.registrationCount + (lead.status === "invalid" ? 0 : 1),
          convertedCount:
            current.summary.convertedCount + (lead.status === "converted" ? 1 : 0),
        },
        pagination: {
          ...current.pagination,
          totalRows: current.pagination.totalRows + 1,
        },
      }));
      window.alert(await readError(response));
      return;
    }
    onReconcile();
  }

  return (
    <div className="data-row lead-grid">
      <div className="identity-cell">
        <span className="avatar">{lead.name[0]}</span>
        <div><strong>{lead.name}</strong><small>{lead.phone}</small></div>
      </div>
      <span>{ambassadorLabel(lead)}</span>
      <span className="domain-tag">{lead.preferred_domain}</span>
      <span>{formatDate(lead.created_at)}</span>
      <select value={status} onChange={(event) => setStatus(event.target.value as RegistrationStatus)}>
        {Object.entries(statusLabels).map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
      <input
        className="table-note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Add a follow-up note"
        maxLength={2000}
      />
      <div className="row-actions compact-actions">
        <button className="text-button" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving" : "Save"}
        </button>
        {canDelete && (
          <button
            className="icon-button danger-icon"
            title="Delete registration"
            onClick={() => void remove()}
            disabled={saving}
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

function ambassadorLabel(lead: Registration) {
  const value = lead.ambassador as
    | { name: string; college: string }
    | Array<{ name: string; college: string }>
    | null
    | undefined;
  const ambassador = Array.isArray(value) ? value[0] : value;
  return ambassador ? `${ambassador.name} - ${ambassador.college}` : "Ambassador";
}

function Modal({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal-card" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose}><X size={19} /></button>
        {children}
      </div>
    </div>
  );
}

function TeamForm({
  onPending,
  onDone,
  onFailed,
}: {
  onPending: (team: TeamPerformance) => void;
  onDone: (pendingId: string, team: TeamPerformance) => void;
  onFailed: (pendingId: string, message: string) => void;
}) {
  const [name, setName] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const pendingTeam: TeamPerformance = {
      id: `pending-${crypto.randomUUID()}`,
      name: name.trim(),
      active: true,
      sales_count: 0,
      ambassador_count: 0,
      registration_count: 0,
    };
    onPending(pendingTeam);
    try {
      const response = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) return onFailed(pendingTeam.id, await readError(response));
      const payload = await response.json() as {
        team: { id: string; name: string; active: boolean };
      };
      onDone(pendingTeam.id, {
        ...payload.team,
        sales_count: 0,
        ambassador_count: 0,
        registration_count: 0,
      });
    } catch {
      onFailed(pendingTeam.id, "Unable to reach the server. The team was not created.");
    }
  }

  return (
    <>
      <span className="eyebrow">ORGANIZATION</span>
      <h2>Create a team</h2>
      <p className="muted">Employees can be assigned after the team is created.</p>
      <form className="stack-form" onSubmit={submit}>
        <label>Team name<input className="plain-input" value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <button className="primary-button wide">Create team</button>
      </form>
    </>
  );
}

function EmployeeForm({
  teams,
  onPending,
  onDone,
  onFailed,
}: {
  teams: DashboardData["teams"];
  onPending: (employee: Profile) => void;
  onDone: (pendingId: string, employee: Profile) => void;
  onFailed: (employee: Profile, message: string) => void;
}) {
  const [form, setForm] = useState({
    fullName: "", email: "", phone: "", role: "sales", teamId: "", password: "",
  });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const pendingEmployee: Profile = {
      id: `pending-${crypto.randomUUID()}`,
      full_name: form.fullName.trim(),
      email: form.email.trim().toLowerCase(),
      phone: form.phone.trim(),
      role: form.role as AppRole,
      team_id: form.teamId,
      active: true,
      created_at: new Date().toISOString(),
    };
    onPending(pendingEmployee);
    try {
      const response = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!response.ok) return onFailed(pendingEmployee, await readError(response));
      const payload = await response.json() as { employee: Profile };
      onDone(pendingEmployee.id, {
        ...payload.employee,
        created_at: payload.employee.created_at ?? new Date().toISOString(),
      });
    } catch {
      onFailed(
        pendingEmployee,
        "Unable to reach the server. The employee account was not created.",
      );
    }
  }

  return (
    <>
      <span className="eyebrow">EMPLOYEE ACCESS</span>
      <h2>Add an employee</h2>
      <p className="muted">Create the credentials they will use to sign in.</p>
      <form className="stack-form two-column" onSubmit={submit}>
        <label>Full name<input className="plain-input" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required /></label>
        <label>Work email<input className="plain-input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
        <label>Phone (optional)<input className="plain-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
        <label>Role<select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="sales">Sales Executive</option><option value="team_lead">Team Lead</option></select></label>
        <label>Team<select value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value })} required><option value="">Select team</option>{teams.filter((team) => !team.id.startsWith("pending-")).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
        <label>Login password<input className="plain-input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={12} required /></label>
        <button className="primary-button wide full-span">Create employee</button>
      </form>
    </>
  );
}

function EmployeeImport({
  teams,
  onDone,
}: {
  teams: DashboardData["teams"];
  onDone: (employees: Profile[]) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const teamByName = useMemo(
    () => new Map(teams.map((team) => [team.name.toLowerCase(), team.id])),
    [teams],
  );

  async function upload() {
    if (!file) return;
    setLoading(true);
    const parsed = await new Promise<Papa.ParseResult<Record<string, string>>>(
      (resolve) =>
        Papa.parse(file, { header: true, skipEmptyLines: true, complete: resolve }),
    );
    const rows = parsed.data.map((row) => ({
      fullName: row.full_name ?? row.name,
      email: row.email,
      phone: row.phone ?? "",
      role: (row.role ?? "sales").toLowerCase().replace(/\s+/g, "_"),
      teamId: teamByName.get((row.team ?? row.team_name ?? "").toLowerCase()) ?? "",
      password: row.password ?? row.temporary_password,
    }));
    const response = await fetch("/api/employees/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows }),
    });
    const payload = await response.json();
    setLoading(false);
    setResult(
      `${payload.created?.length ?? 0} created. ${payload.errors?.length ?? 0} failed.` +
        (payload.errors?.length
          ? ` ${payload.errors.map((item: { row: number; error: string }) => `Row ${item.row}: ${item.error}`).join(" ")}`
          : ""),
    );
    if (payload.created?.length) {
      onDone(
        payload.created.map((item: { employee: Profile }) => item.employee),
      );
    }
  }

  return (
    <>
      <span className="eyebrow">BULK ONBOARDING</span>
      <h2>Import employees</h2>
      <p className="muted">
        CSV headers: name, email, phone, role, team, password.
      </p>
      <div className="upload-zone">
        <Upload size={24} />
        <input type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        <span>{file ? file.name : "Choose a CSV file"}</span>
      </div>
      {result && <div className="alert">{result}</div>}
      <button className="primary-button wide" onClick={() => void upload()} disabled={!file || loading}>
        {loading ? "Importing..." : "Import employees"}
      </button>
    </>
  );
}

function AmbassadorForm({
  user,
  target,
  onPending,
  onDone,
  onFailed,
}: {
  user: Profile;
  target: number;
  onPending: (ambassador: AmbassadorPerformance) => void;
  onDone: (pendingId: string, ambassador: AmbassadorPerformance) => void;
  onFailed: (ambassador: AmbassadorPerformance, message: string) => void;
}) {
  const [form, setForm] = useState({
    name: "", phone: "", college: "", city: "", courseYear: "",
  });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const now = new Date().toISOString();
    const pendingAmbassador: AmbassadorPerformance = {
      id: `pending-${crypto.randomUUID()}`,
      sales_id: user.id,
      team_id: user.team_id ?? "",
      name: form.name.trim(),
      phone: form.phone.trim(),
      college: form.college.trim(),
      city: form.city.trim(),
      course_year: form.courseYear.trim(),
      public_slug: "",
      progress_key: "",
      target,
      status: "active",
      created_at: now,
      updated_at: now,
      registration_count: 0,
      qualified: false,
      progress_updated_at: now,
    };
    onPending(pendingAmbassador);
    try {
      const response = await fetch("/api/ambassadors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!response.ok) return onFailed(pendingAmbassador, await readError(response));
      const payload = await response.json() as {
        ambassador: Omit<
          AmbassadorPerformance,
          "registration_count" | "qualified" | "progress_updated_at"
        >;
      };
      onDone(pendingAmbassador.id, {
        ...payload.ambassador,
        sales_id: payload.ambassador.sales_id ?? user.id,
        team_id: payload.ambassador.team_id ?? user.team_id ?? "",
        target: payload.ambassador.target ?? target,
        registration_count: 0,
        qualified: false,
        progress_updated_at: payload.ambassador.updated_at ?? now,
      });
    } catch {
      onFailed(
        pendingAmbassador,
        "Unable to reach the server. The group was not created.",
      );
    }
  }

  return (
    <>
      <span className="eyebrow">CAMPUS NETWORK</span>
      <h2>Create a group</h2>
      <p className="muted">Each Campus Ambassador is one group. Referral and private progress links are generated automatically.</p>
      <form className="stack-form two-column" onSubmit={submit}>
        <label>Full name<input className="plain-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
        <label>Mobile number<input className="plain-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required /></label>
        <label className="full-span">College<input className="plain-input" value={form.college} onChange={(e) => setForm({ ...form, college: e.target.value })} required /></label>
        <label>City<input className="plain-input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label>
        <label>Course and year<input className="plain-input" value={form.courseYear} onChange={(e) => setForm({ ...form, courseYear: e.target.value })} /></label>
        <button className="primary-button wide full-span">Create group and ambassador</button>
      </form>
    </>
  );
}

function DefaultTargetForm({
  value,
  onChange,
  onReconcile,
}: {
  value: number;
  onChange: (target: number) => void;
  onReconcile: () => void;
}) {
  const [target, setTarget] = useState(value);
  const [saving, setSaving] = useState(false);

  async function save() {
    const previousTarget = value;
    onChange(target);
    setSaving(true);
    const response = await dashboardMutation("/api/settings/target", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
    });
    setSaving(false);
    if (!response.ok) {
      onChange(previousTarget);
      setTarget(previousTarget);
      return window.alert(await readError(response));
    }
    onReconcile();
  }

  return (
    <div className="target-setting">
      <div><Settings2 size={19} /><span><strong>Default CA target</strong><small>Applied to new ambassadors</small></span></div>
      <div><input type="number" min={1} max={10000} value={target} onChange={(event) => setTarget(Number(event.target.value))} /><button onClick={() => void save()} disabled={saving}>{saving ? "..." : "Save"}</button></div>
    </div>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-state">
      <Users size={25} />
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}
