"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Award,
  BarChart3,
  Building2,
  CalendarDays,
  Check,
  ChevronRight,
  Clipboard,
  Copy,
  Download,
  ImageIcon,
  LayoutDashboard,
  Layers3,
  Link2,
  LogOut,
  Menu,
  MessageCircle,
  PauseCircle,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  Share2,
  ShieldCheck,
  Target,
  Trash2,
  Trophy,
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
import { buildWhatsAppDraft, shareCreatives } from "@/lib/share-creatives";
import { PerformanceLeaderboard } from "@/components/performance-leaderboard";
import type {
  AmbassadorPerformance,
  AppRole,
  DashboardActivityEvent,
  DashboardData,
  DashboardLiveUpdate,
  GroupOption,
  Profile,
  Registration,
  RegistrationStatus,
  TeamPerformance,
  WhatsAppConversationSummary,
  WhatsAppMessage,
} from "@/lib/types";

type Tab = "overview" | "leaderboard" | "teams" | "employees" | "ambassadors" | "leads";
type ModalName = "team" | "employee" | "import" | "ambassador" | null;
type DateRange = ReportingDateRange;
type ExportScope = "current" | "group" | "all";
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

async function writeClipboardText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("Copy failed");
  }
}

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
    timeZone: "Asia/Kolkata",
  });
}

function formatTime(value: string) {
  return `${new Date(value).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  })} IST`;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

function whatsappFor(lead: Registration) {
  const value = lead.whatsapp;
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

const whatsappStageLabels: Record<string, string> = {
  not_started: "Not started",
  queued: "Queued",
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
  engaged: "Engaged",
  qualifying: "Qualifying",
  qualified: "Qualified",
  advisor_requested: "Advisor requested",
  follow_up: "Follow-up",
  enrollment_ready: "Enrollment ready",
  converted: "Converted",
  not_interested: "Not interested",
  opted_out: "Opted out",
  failed: "Failed",
};

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
    (filters.teamId === "all" || lead.owner_team_id === filters.teamId) &&
    (filters.memberId === "all" || lead.owner_sales_id === filters.memberId) &&
    (filters.groupId === "all" || lead.ambassador_id === filters.groupId) &&
    inDateRange(lead.created_at, filters.dateRange) &&
    (
      !needle ||
      lead.name.toLowerCase().includes(needle) ||
      lead.phone.includes(needle) ||
      lead.preferred_domain.toLowerCase().includes(needle)
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
  const [teamFilter, setTeamFilter] = useState(
    initialData?.user.role === "team_lead"
      ? (initialData.activeTeamId ?? initialData.user.team_id ?? "all")
      : "all",
  );
  const [groupFilter, setGroupFilter] = useState("all");
  const [memberFilter, setMemberFilter] = useState("all");
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [exportScope, setExportScope] = useState<ExportScope>("current");
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState("");
  const [page, setPage] = useState(1);
  const [ambassadorPage, setAmbassadorPage] = useState(1);
  const effectiveExportScope: ExportScope =
    exportScope === "group" && groupFilter === "all" ? "current" : exportScope;
  const loadedOnce = useRef(Boolean(initialData));
  const loadSequence = useRef(0);
  const visibleLoadInFlight = useRef(false);
  const dataRevision = useRef(0);
  const processedLiveEvents = useRef(new Set<number>());
  const latestSummaryEvent = useRef(0);
  const reconcileTimer = useRef<number | undefined>(undefined);
  const loadRef = useRef<
    ((quiet?: boolean, silent?: boolean) => Promise<void>) | null
  >(null);
  const reportingViewKey = [
    teamFilter,
    memberFilter,
    groupFilter,
    dateRange,
    debouncedSearch,
    page,
    ambassadorPage,
  ].join("|");
  const reportingViewKeyRef = useRef(reportingViewKey);
  const skipBootstrapLoad = useRef(Boolean(initialData));

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
    const viewKeyAtStart = reportingViewKey;
    const requestId = ++loadSequence.current;
    const revisionAtStart = dataRevision.current;
    if (!silent) {
      visibleLoadInFlight.current = true;
      if (quiet || loadedOnce.current) setRefreshing(true);
      else setLoading(true);
    }
    const params = new URLSearchParams({
      page: String(page),
      pageSize: "50",
      ambassadorPage: String(ambassadorPage),
      ambassadorPageSize: "24",
    });
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
      reportingViewKeyRef.current !== viewKeyAtStart
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
    if (
      result.user.role === "team_lead" &&
      teamFilter === "all" &&
      result.activeTeamId
    ) {
      setTeamFilter(result.activeTeamId);
    }
    setData((current) => {
      if (!current || revisionAtStart === dataRevision.current) return result;

      // A filter response must still be applied even if an optimistic create
      // happened while it was loading. Preserve only unsaved local rows; the
      // database remains authoritative for every committed record.
      const pendingTeams = current.teams.filter((item) =>
        item.id.startsWith("pending-"),
      );
      const pendingEmployees = current.employees.filter((item) =>
        item.id.startsWith("pending-"),
      );
      const pendingAmbassadors = current.ambassadors.filter((item) =>
        item.id.startsWith("pending-"),
      );
      return {
        ...result,
        teams: [...pendingTeams, ...result.teams],
        employees: [...pendingEmployees, ...result.employees],
        ambassadors: [...pendingAmbassadors, ...result.ambassadors],
      };
    });
    setPage(result.pagination.page);
    setAmbassadorPage(result.ambassadorPagination.page);
    loadedOnce.current = true;
    setError("");
    if (!silent) {
      visibleLoadInFlight.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [ambassadorPage, dateRange, debouncedSearch, expectedRole, groupFilter, memberFilter, page, reportingViewKey, router, teamFilter]);

  const scheduleReconciliation = useCallback(() => {
    if (reconcileTimer.current) window.clearTimeout(reconcileTimer.current);
    reconcileTimer.current = window.setTimeout(() => void load(true, true), 20_000);
  }, [load]);

  useEffect(() => {
    loadRef.current = load;
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
      ambassadorPage: String(ambassadorPage),
      ambassadorPageSize: "24",
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
        const existed = ambassadors.some((item) => item.id === update.ambassador?.id);
        if (existed || current.ambassadorPagination.page === 1) {
          ambassadors = upsertById(ambassadors, update.ambassador)
            .sort(
              (left, right) =>
                Date.parse(right.created_at) - Date.parse(left.created_at),
            )
            .slice(0, current.ambassadorPagination.pageSize);
        }
      }

      let rankingAmbassadors = current.rankingAmbassadors;
      if (update.ambassador) {
        rankingAmbassadors = rankingAmbassadors.some(
          (item) => item.id === update.ambassador?.id,
        )
          ? upsertById(rankingAmbassadors, update.ambassador)
          : rankingAmbassadors;
      }

      let employees = current.employees;
      if (update.event.event_type === "employee_deleted" && update.event.entity_id) {
        employees = employees.filter((item) => item.id !== update.event.entity_id);
      }
      if (update.profile) {
        const previousProfile = employees.find((item) => item.id === update.profile?.id);
        update.profile.managed_team_ids =
          previousProfile?.managed_team_ids ?? update.profile.managed_team_ids ??
          (update.profile.team_id ? [update.profile.team_id] : []);
        const profileIsVisible =
          current.user.role === "admin" ||
          update.profile.team_id === current.activeTeamId;
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
        rankingAmbassadors,
        employees,
        teams,
        salesPerformance,
        summary: applySummary && update.summary ? update.summary : current.summary,
        pagination: applySummary && update.pagination ? update.pagination : current.pagination,
        ambassadorPagination:
          applySummary && update.ambassadorPagination
            ? update.ambassadorPagination
            : current.ambassadorPagination,
      };
    });
    if (applySummary && update.pagination && update.pagination.page !== page) {
      setPage(update.pagination.page);
    }
    if (
      applySummary &&
      update.ambassadorPagination &&
      update.ambassadorPagination.page !== ambassadorPage
    ) {
      setAmbassadorPage(update.ambassadorPagination.page);
    }
    scheduleReconciliation();
  }, [ambassadorPage, dateRange, debouncedSearch, groupFilter, load, memberFilter, page, reportingViewKey, scheduleReconciliation, teamFilter]);

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
    if (!data) return;
    let reset: "team" | "member" | "group" | null = null;
    if (
      teamFilter !== "all" &&
      !data.teams.some((team) => team.id === teamFilter)
    ) {
      reset = "team";
    } else if (
      memberFilter !== "all" &&
      !data.employees.some((employee) => employee.id === memberFilter)
    ) {
      reset = "member";
    } else if (
      groupFilter !== "all" &&
      !data.ambassadors.some(
        (ambassador) =>
          ambassador.id === groupFilter &&
          inDateRange(ambassador.created_at, dateRange),
      )
    ) {
      reset = "group";
    }
    if (!reset) return;
    const resetFilters = window.setTimeout(() => {
      if (reset === "team") setTeamFilter("all");
      if (reset === "team" || reset === "member") setMemberFilter("all");
      setGroupFilter("all");
      setPage(1);
    }, 0);
    return () => window.clearTimeout(resetFilters);
  }, [data, dateRange, groupFilter, memberFilter, teamFilter]);

  useEffect(() => {
    if (skipBootstrapLoad.current) {
      skipBootstrapLoad.current = false;
      return;
    }
    const filterLoad = window.setTimeout(
      () => void load(loadedOnce.current),
      0,
    );
    return () => window.clearTimeout(filterLoad);
  }, [load, reportingViewKey]);

  useEffect(() => {
    const userId = data?.user.id;
    if (!userId) return;
    const supabase = createBrowserSupabase();
    let cancelled = false;
    let broadcastChannel: ReturnType<typeof supabase.channel> | undefined;
    let databaseChannel: ReturnType<typeof supabase.channel> | undefined;
    let wasConnected = false;
    const sources = { broadcast: false, database: false };

    const receiveEvent = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      const candidate = value as DashboardActivityEvent & { id: unknown };
      const id = Number(candidate.id);
      if (!Number.isSafeInteger(id) || typeof candidate.event_type !== "string") {
        return;
      }
      void loadLiveEventRef.current({ ...candidate, id });
    };

    const updateConnection = (
      source: keyof typeof sources,
      status: string,
    ) => {
      if (cancelled) return;
      const connectedBefore = sources.broadcast || sources.database;
      sources[source] = status === "SUBSCRIBED";
      const connectedNow = sources.broadcast || sources.database;
      setLive(connectedNow);
      if (connectedNow && !connectedBefore) {
        if (wasConnected) void loadRef.current?.(true, true);
        wasConnected = true;
      }
    };

    void (async () => {
      try {
        await supabase.realtime.setAuth();
        if (cancelled) return;
        broadcastChannel = supabase
          .channel(`dashboard:user:${userId}`, { config: { private: true } })
          .on(
            "broadcast",
            { event: "dashboard_changed" },
            (message: { payload?: DashboardActivityEvent }) => {
              receiveEvent(message.payload);
            },
          )
          .subscribe((status: string) =>
            updateConnection("broadcast", status),
          );

        // Postgres Changes is a second delivery path backed by the existing
        // activity_events RLS policy. It keeps dashboards live even if a
        // private Broadcast authorization or trigger is temporarily delayed.
        databaseChannel = supabase
          .channel(`dashboard:activity:${userId}`)
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "activity_events",
            },
            (message: { new?: DashboardActivityEvent }) => {
              receiveEvent(message.new);
            },
          )
          .subscribe((status: string) =>
            updateConnection("database", status),
          );
      } catch {
        if (!cancelled) setLive(false);
      }
    })();
    return () => {
      cancelled = true;
      if (broadcastChannel) void supabase.removeChannel(broadcastChannel);
      if (databaseChannel) void supabase.removeChannel(databaseChannel);
    };
  }, [data?.user.id]);

  useEffect(() => {
    const reconcile = () => {
      if (document.visibilityState === "visible") void load(true, true);
    };
    // Realtime applies scoped row updates immediately. This slower pass is a
    // consistency safety net, not a polling transport. When Realtime is down,
    // temporarily reconcile more often until the socket reconnects.
    const interval = window.setInterval(reconcile, live ? 5 * 60_000 : 60_000);
    document.addEventListener("visibilitychange", reconcile);
    window.addEventListener("focus", reconcile);
    window.addEventListener("online", reconcile);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", reconcile);
      window.removeEventListener("focus", reconcile);
      window.removeEventListener("online", reconcile);
      if (reconcileTimer.current) window.clearTimeout(reconcileTimer.current);
    };
  }, [live, load]);

  async function logout() {
    await createBrowserSupabase().auth.signOut();
    router.replace("/");
    router.refresh();
  }

  async function exportRegistrations() {
    setExporting(true);
    setExportNotice("");
    setError("");

    const params = new URLSearchParams({ mode: effectiveExportScope });
    if (effectiveExportScope === "current") {
      if (teamFilter !== "all") params.set("teamId", teamFilter);
      if (memberFilter !== "all") params.set("memberId", memberFilter);
      if (groupFilter !== "all") params.set("groupId", groupFilter);
      if (dateRange !== "all") params.set("dateRange", dateRange);
      if (debouncedSearch) params.set("search", debouncedSearch);
    } else if (effectiveExportScope === "group" && groupFilter !== "all") {
      params.set("groupId", groupFilter);
    }

    try {
      const response = await dashboardMutation(`/api/registrations/export?${params.toString()}`);
      if (!response.ok) {
        setError(await readError(response));
        return;
      }

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1]
        ?? `persevex-registrations-${new Date().toISOString().slice(0, 10)}.csv`;
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(downloadUrl);

      const rowCount = Number(response.headers.get("X-Export-Row-Count") ?? 0);
      setExportNotice(
        rowCount === 1 ? "1 registration exported." : `${rowCount} registrations exported.`,
      );
    } catch {
      setError("Unable to download the CSV right now.");
    } finally {
      setExporting(false);
    }
  }

  function changeTab(nextTab: Tab) {
    if (nextTab !== "leads" && (search || debouncedSearch)) {
      setSearch("");
      setDebouncedSearch("");
      setPage(1);
    }
    setTab(nextTab);
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
    { id: "leaderboard", label: "Leaderboard", icon: <Trophy size={18} /> },
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
      (teamFilter === "all" || lead.owner_team_id === teamFilter) &&
      (memberFilter === "all" || lead.owner_sales_id === memberFilter) &&
      (groupFilter === "all" || lead.ambassador_id === groupFilter) &&
      inDateRange(lead.created_at, dateRange) &&
      (
        !needle ||
        lead.name.toLowerCase().includes(needle) ||
        lead.phone.includes(needle) ||
        lead.preferred_domain.toLowerCase().includes(needle)
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
                changeTab(item.id);
                setSidebar(false);
              }}
            >
              {item.icon}
              {item.label}
              {tab === item.id && <ChevronRight size={16} />}
            </button>
          ))}
          {data.user.role === "admin" && (
            <button
              onClick={() => router.push("/admin/statistics")}
            >
              <BarChart3 size={18} />
              Statistics
              <ChevronRight size={16} />
            </button>
          )}
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

      <button
        type="button"
        className={`sidebar-backdrop ${sidebar ? "open" : ""}`}
        aria-label="Close navigation"
        onClick={() => setSidebar(false)}
      />

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
            {data.user.role === "team_lead" && data.teams.length > 0 && (
              <label className="team-workspace-switcher">
                <Building2 size={16} />
                <span>Managing</span>
                <select
                  value={teamFilter}
                  aria-label="Choose team to manage"
                  onChange={(event) => {
                    setTeamFilter(event.target.value);
                    setMemberFilter("all");
                    setGroupFilter("all");
                    setPage(1);
                    setAmbassadorPage(1);
                  }}
                >
                  {data.teams.map((team) => (
                    <option key={team.id} value={team.id}>{team.name}</option>
                  ))}
                </select>
              </label>
            )}
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
                  loading={refreshing}
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
                    setGroupFilter("all");
                    setPage(1);
                  }}
                />
              }
              onUpdate={updateDashboard}
              onReconcile={scheduleReconciliation}
            />
          )}
          {tab === "leaderboard" && (
            <PerformanceLeaderboard
              currentUserId={data.user.id}
              currentUserRole={data.user.role}
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
                changeTab("overview");
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
                changeTab("ambassadors");
              }}
              onUpdate={updateDashboard}
              onReconcile={scheduleReconciliation}
            />
          )}
          {tab === "ambassadors" && (
            <AmbassadorsView
              data={data}
              ambassadors={filteredAmbassadors}
              pagination={data.ambassadorPagination}
              onPageChange={setAmbassadorPage}
              filters={
                <ReportingFilters
                  data={data}
                  loading={refreshing}
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
                    setGroupFilter("all");
                    setPage(1);
                  }}
                />
              }
              onViewGroup={(id) => {
                setGroupFilter(id);
                setPage(1);
                changeTab("leads");
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
                  {exportNotice && <span className="export-notice"><Check size={13} /> {exportNotice}</span>}
                </div>
                <div className="table-toolbar-actions">
                  <label className="search-box">
                    <Search size={17} />
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search student, phone, or domain"
                    />
                  </label>
                  <div className="export-data-control">
                    <label>
                      <span className="sr-only">CSV export scope</span>
                      <select
                        value={effectiveExportScope}
                        onChange={(event) => setExportScope(event.target.value as ExportScope)}
                        aria-label="CSV export scope"
                      >
                        <option value="current">Current filtered results</option>
                        {groupFilter !== "all" && (
                          <option value="group">Selected group · full history</option>
                        )}
                        <option value="all">All accessible registrations</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="secondary-button export-csv-button"
                      onClick={() => void exportRegistrations()}
                      disabled={exporting}
                    >
                      {exporting ? <RefreshCw size={16} className="spin" /> : <Download size={16} />}
                      {exporting ? "Preparing..." : "Export CSV"}
                    </button>
                  </div>
                </div>
              </div>
              <ReportingFilters
                data={data}
                loading={refreshing}
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
                  setGroupFilter("all");
                  setPage(1);
                }}
              />
              <LeadViewSummary summary={data.summary} />
              <LeadsTable
                registrations={filteredRegistrations}
                employees={data.employees}
                canDelete={data.user.role !== "sales"}
                whatsappAccess={data.user.role === "admin" || data.user.role === "sales"}
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
              teamId={data.activeTeamId ?? data.user.team_id}
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
  if (tab === "leaderboard") return "Performance leaderboard";
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
  loading,
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
  loading: boolean;
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
      (
        teamFilter === "all" ||
        employee.team_id === teamFilter ||
        employee.managed_team_ids.includes(teamFilter)
      ) &&
      (data.salesPerformance.find((item) => item.id === employee.id)
        ?.ambassador_count ?? 0) > 0,
  );

  return (
    <div className="reporting-filters" aria-busy={loading}>
      <div className="filter-heading">
        {loading ? <RefreshCw className="spin" size={17} /> : <BarChart3 size={17} />}
        <span><strong>Reporting view</strong><small>{loading ? "Updating this view..." : "Filter every number below"}</small></span>
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
      {data.user.role !== "sales" && creators.length > 0 && (
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
      <GroupSearchFilter
        teamId={teamFilter}
        memberId={memberFilter}
        dateRange={dateRange}
        value={groupFilter}
        onChange={onGroupChange}
      />
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

function GroupSearchFilter({
  teamId,
  memberId,
  dateRange,
  value,
  onChange,
}: {
  teamId: string;
  memberId: string;
  dateRange: DateRange;
  value: string;
  onChange: (value: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<GroupOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      const params = new URLSearchParams();
      if (teamId !== "all") params.set("teamId", teamId);
      if (memberId !== "all") params.set("memberId", memberId);
      if (dateRange !== "all") params.set("dateRange", dateRange);
      if (value !== "all") params.set("selectedId", value);
      if (search.trim()) params.set("search", search.trim());
      try {
        const response = await fetch(`/api/groups/options?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const result = (await response.json()) as { options: GroupOption[] };
        setOptions(result.options);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setOptions([]);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [dateRange, memberId, search, teamId, value]);

  const selectedIsLoaded =
    value === "all" || options.some((option) => option.id === value);

  return (
    <label className="group-filter-control">
      Group / Campus Ambassador
      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search name or college"
        aria-label="Search Campus Ambassador groups"
      />
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Select Campus Ambassador group"
      >
        <option value="all">{loading ? "Loading groups..." : "All groups"}</option>
        {!selectedIsLoaded && <option value={value}>Selected group</option>}
        {options.map((group) => (
          <option key={group.id} value={group.id}>
            {group.name} · {group.college}
          </option>
        ))}
      </select>
    </label>
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
  pageSize = 50,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  totalRows: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
}) {
  if (totalRows <= pageSize) return null;
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
    [...data.rankingAmbassadors, ...data.ambassadors].map((item) => [item.id, item]),
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
  const teamLeadByTeam = new Map<string, Profile>();
  data.employees
    .filter((employee) => employee.role === "team_lead")
    .forEach((employee) => {
      for (const teamId of employee.managed_team_ids) {
        teamLeadByTeam.set(teamId, employee);
      }
    });
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
          <p>Create teams, assign Sales members, and let one Team Lead manage one or several teams.</p>
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
    const nextRole =
      body.role === "sales" || body.role === "team_lead"
        ? body.role
        : previous.role;
    const nextManagedTeamIds = nextRole === "team_lead"
      ? (
          Array.isArray(body.teamIds)
            ? body.teamIds.filter((value): value is string => typeof value === "string")
            : previous.managed_team_ids
        )
      : (nextTeamId ? [nextTeamId] : []);
    const teamChanged = nextTeamId !== previous.team_id;
    const ambassadorCount = previousPerformance?.ambassador_count ?? 0;
    onUpdate((current) => ({
      ...current,
      employees: current.employees.map((employee) =>
        employee.id === id
          ? {
              ...employee,
              ...(typeof body.active === "boolean" ? { active: body.active } : {}),
              ...(body.active === false ? { wati_enabled: false } : {}),
              ...(typeof body.teamId === "string" ? { team_id: body.teamId } : {}),
              ...(body.role === "sales" || body.role === "team_lead"
                ? { role: body.role }
                : {}),
              managed_team_ids: nextManagedTeamIds,
              ...(typeof body.watiEnabled === "boolean"
                ? { wati_enabled: body.watiEnabled }
                : {}),
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
      registrations: teamChanged && nextTeamId
        ? current.registrations.map((registration) =>
            registration.owner_sales_id === id
              ? { ...registration, owner_team_id: nextTeamId }
              : registration,
          )
        : current.registrations,
      teams: current.teams.map((team) => {
        const salesDelta =
          (nextRole === "sales" && nextActive && team.id === nextTeamId ? 1 : 0) -
          (previous.role === "sales" && previous.active && team.id === previous.team_id
            ? 1
            : 0);
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
        registrations: teamChanged && previous.team_id
          ? current.registrations.map((registration) =>
              registration.owner_sales_id === id
                ? { ...registration, owner_team_id: previous.team_id as string }
                : registration,
            )
          : current.registrations,
        teams: current.teams.map((team) => {
          const salesDelta =
            (previous.role === "sales" && previous.active && team.id === previous.team_id
              ? 1
              : 0) -
            (nextRole === "sales" && nextActive && team.id === nextTeamId ? 1 : 0);
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

  function changeManagedTeam(employee: Profile, teamId: string, checked: boolean) {
    const current = employee.managed_team_ids.length
      ? employee.managed_team_ids
      : (employee.team_id ? [employee.team_id] : []);
    const teamIds = checked
      ? [...new Set([...current, teamId])]
      : current.filter((id) => id !== teamId);
    if (!teamIds.length) {
      window.alert("A Team Lead must manage at least one team.");
      return;
    }
    const primaryTeamId = teamIds.includes(employee.team_id ?? "")
      ? employee.team_id
      : teamIds[0];
    void patchEmployee(employee.id, { teamId: primaryTeamId, teamIds });
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

  function toggleEmployeeWati(employee: Profile) {
    const enable = !employee.wati_enabled;
    if (
      enable &&
      !window.confirm(
        `Enable WATI for future registrations assigned to ${employee.full_name}? Existing registrations will not be messaged. Only continue after the approved templates and WATI credentials are ready.`,
      )
    ) {
      return;
    }
    void patchEmployee(employee.id, { watiEnabled: enable });
  }

  return (
    <section>
      <div className="table-toolbar">
        <div>
          <h2>{data.user.role === "admin" ? "Employee access" : "Assigned team"}</h2>
          <p>
            {data.user.role === "admin"
              ? "Create accounts, update roles, assign teams, suspend access, and control WATI employee by employee."
              : "Performance and assignments inside your team."}
          </p>
        </div>
      </div>
      <div className="data-table">
        <div className={`data-row employee-grid ${data.user.role === "admin" ? "with-wati" : ""} table-header`}>
          <span>Employee</span><span>Role</span><span>Team</span><span>Status</span>
          {data.user.role === "admin" && <span>WATI</span>}
          <span>Performance</span><span />
        </div>
        {data.employees.map((employee) => {
          const pending = employee.id.startsWith("pending-");
          const performance = data.salesPerformance.find(
            (item) => item.id === employee.id,
          );
          return (
            <div className={`data-row employee-grid ${data.user.role === "admin" ? "with-wati" : ""}`} key={employee.id}>
              <div className="identity-cell">
                <span className="avatar">{employee.full_name[0]}</span>
                <div><strong>{employee.full_name}</strong><small>{employee.email}</small></div>
              </div>
              {data.user.role === "admin" && employee.role !== "admin" ? (
                <select
                  className="employee-role-select"
                  value={employee.role}
                  disabled={pending}
                  aria-label={"Role for " + employee.full_name}
                  onChange={(event) => {
                    const role = event.target.value as "sales" | "team_lead";
                    const confirmed = window.confirm(
                      "Change " + employee.full_name + "'s role to " +
                        roleLabel(role) +
                        "? Their dashboard permissions will change immediately.",
                    );
                    if (confirmed) void patchEmployee(employee.id, { role });
                  }}
                >
                  <option value="sales">Sales Executive</option>
                  <option value="team_lead">Team Lead</option>
                </select>
              ) : (
                <span className="role-tag">{roleLabel(employee.role)}</span>
              )}
              {data.user.role === "admin" && employee.role !== "admin" ? (
                employee.role === "team_lead" ? (
                  <details className="team-assignment-menu">
                    <summary>
                      {employee.managed_team_ids.length || 1} team{(employee.managed_team_ids.length || 1) === 1 ? "" : "s"}
                    </summary>
                    <div>
                      <strong>Teams managed</strong>
                      {data.teams.map((team) => {
                        const checked = employee.managed_team_ids.includes(team.id) ||
                          (!employee.managed_team_ids.length && employee.team_id === team.id);
                        return (
                          <label key={team.id}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={pending}
                              onChange={(event) =>
                                changeManagedTeam(employee, team.id, event.target.checked)
                              }
                            />
                            <span>{team.name}</span>
                            {employee.team_id === team.id && <small>Primary</small>}
                          </label>
                        );
                      })}
                    </div>
                  </details>
                ) : (
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
                )
              ) : (
                <span>
                  {employee.role === "team_lead" && employee.managed_team_ids.length > 1
                    ? `${employee.managed_team_ids.length} managed teams`
                    : employee.team_id ? teamNames.get(employee.team_id) : "All teams"}
                </span>
              )}
              <span className={`status-dot ${employee.active ? "active" : ""}`}>
                {pending ? "Creating" : employee.active ? "Active" : "Suspended"}
              </span>
              {data.user.role === "admin" && (
                employee.role === "admin" ? (
                  <span className="muted">—</span>
                ) : (
                  <button
                    type="button"
                    className={`wati-employee-toggle ${employee.wati_enabled ? "enabled" : ""}`}
                    aria-pressed={Boolean(employee.wati_enabled)}
                    disabled={pending || !employee.active}
                    onClick={() => toggleEmployeeWati(employee)}
                    title="Controls WATI only for future registrations assigned to this employee"
                  >
                    <MessageCircle size={14} />
                    <span>{employee.wati_enabled ? "Enabled" : "Off"}</span>
                  </button>
                )
              )}
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
  pagination,
  onPageChange,
  filters,
  onViewGroup,
  onUpdate,
  onReconcile,
}: {
  data: DashboardData;
  ambassadors: DashboardData["ambassadors"];
  pagination: DashboardData["ambassadorPagination"];
  onPageChange: (page: number) => void;
  filters: React.ReactNode;
  onViewGroup: (id: string) => void;
  onUpdate: DashboardUpdater;
  onReconcile: () => void;
}) {
  const [copyFeedback, setCopyFeedback] = useState("");
  const [shareTarget, setShareTarget] = useState<AmbassadorPerformance | null>(null);
  const [selectedCreativeId, setSelectedCreativeId] = useState(
    shareCreatives[0].id as string,
  );
  const [shareNotice, setShareNotice] = useState("");
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

  async function copy(value: string, feedbackKey: string) {
    try {
      await writeClipboardText(value);
      setCopyFeedback(feedbackKey);
      window.setTimeout(() => {
        setCopyFeedback((current) => current === feedbackKey ? "" : current);
      }, 2_000);
    } catch {
      window.alert("Copy failed. Please select and copy the value manually.");
    }
  }

  function selectedShareCreative() {
    return shareCreatives.find((creative) => creative.id === selectedCreativeId) ?? shareCreatives[0];
  }

  function shareLinkFor(ambassador: AmbassadorPerformance) {
    const base = `${publicBaseUrl()}/join/${ambassador.public_slug}`;
    return `${base}?creative=${encodeURIComponent(selectedShareCreative().id)}`;
  }

  async function creativeFile() {
    const creative = selectedShareCreative();
    const response = await fetch(creative.src);
    if (!response.ok) throw new Error("Unable to load poster");
    const blob = await response.blob();
    return new File([blob], `${creative.id}.jpg`, { type: "image/jpeg" });
  }

  async function sharePosterAndDraft() {
    if (!shareTarget) return;
    setShareNotice("");
    try {
      const file = await creativeFile();
      const draft = buildWhatsAppDraft(shareLinkFor(shareTarget));
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: "Persevex internship opportunity",
          text: draft,
          files: [file],
        });
        setShareNotice("Poster and draft sent to your share sheet.");
        return;
      }
      await writeClipboardText(draft);
      downloadSelectedPoster();
      setShareNotice("Draft copied and poster downloaded. Attach the poster in WhatsApp, then paste the draft.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setShareNotice("Sharing was blocked by this browser. Use Copy draft and Download poster below.");
    }
  }

  function downloadSelectedPoster() {
    const creative = selectedShareCreative();
    const anchor = document.createElement("a");
    anchor.href = creative.src;
    anchor.download = `persevex-${creative.id}.jpg`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setShareNotice("Poster downloaded.");
  }

  async function copySelectedPoster() {
    try {
      const file = await creativeFile();
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const png = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) => blob ? resolve(blob) : reject(new Error("Image conversion failed")),
          "image/png",
        ),
      );
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": png }),
      ]);
      setShareNotice("Poster copied. Paste it into WhatsApp, then add the copied draft as its caption.");
    } catch {
      downloadSelectedPoster();
      setShareNotice("Image clipboard is not supported here, so the poster was downloaded instead.");
    }
  }

  function openWhatsAppDraft() {
    if (!shareTarget) return;
    const draft = buildWhatsAppDraft(shareLinkFor(shareTarget));
    window.open(
      `https://wa.me/?text=${encodeURIComponent(draft)}`,
      "_blank",
      "noopener,noreferrer",
    );
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
          const progressLink = `${publicBaseUrl()}/ca/${ambassador.progress_key}?share=progress-v1`;
          const referralCopied = copyFeedback === `${ambassador.id}:referral`;
          const progressCopied = copyFeedback === `${ambassador.id}:progress`;
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
                <button
                  disabled={pending}
                  onClick={() => {
                    setShareTarget(ambassador);
                    setShareNotice("");
                  }}
                >
                  <MessageCircle size={16} /> WhatsApp draft
                </button>
                <button
                  className={referralCopied ? "copied" : ""}
                  disabled={pending}
                  onClick={() => void copy(link, `${ambassador.id}:referral`)}
                >
                  {referralCopied ? <Check size={16} /> : <Link2 size={16} />}
                  {referralCopied ? "Copied!" : "Referral link"}
                </button>
                <button
                  className={progressCopied ? "copied" : ""}
                  disabled={pending}
                  onClick={() => void copy(progressLink, `${ambassador.id}:progress`)}
                >
                  {progressCopied ? <Check size={16} /> : <Target size={16} />}
                  {progressCopied ? "Copied!" : "Progress link"}
                </button>
              </div>
              <button
                className="view-group-button"
                onClick={() => onViewGroup(ambassador.id)}
                disabled={pending}
              >
                View registrations from this group <ChevronRight size={16} />
              </button>
              <div className="ambassador-footer">
                <span className="ambassador-contact">
                  {ambassador.phone}
                  {ambassador.email && <small>{ambassador.email}</small>}
                </span>
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
      <Pagination
        page={pagination.page}
        totalPages={pagination.totalPages}
        totalRows={pagination.totalRows}
        pageSize={pagination.pageSize}
        onPageChange={onPageChange}
      />
      {shareTarget && (
        <div className="modal-backdrop share-draft-backdrop" role="presentation">
          <section
            className="share-draft-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-draft-title"
          >
            <div className="share-draft-modal-header">
              <div className="share-draft-heading">
                <span className="eyebrow">WHATSAPP CAMPAIGN</span>
                <h2 id="share-draft-title">Choose a poster and share</h2>
                <p>Your referral link is added automatically.</p>
              </div>
              <button
                type="button"
                className="modal-close"
                aria-label="Close WhatsApp draft"
                onClick={() => setShareTarget(null)}
              >
                <X size={19} />
              </button>
            </div>

            <div className="share-draft-scroll">
              <div className="share-creative-grid">
                {shareCreatives.map((creative) => (
                  <button
                    type="button"
                    key={creative.id}
                    className={selectedCreativeId === creative.id ? "selected" : ""}
                    aria-pressed={selectedCreativeId === creative.id}
                    onClick={() => {
                      setSelectedCreativeId(creative.id);
                      setShareNotice("");
                    }}
                  >
                    <Image src={creative.src} alt={creative.name} width={220} height={300} />
                    <span>{selectedCreativeId === creative.id ? <Check size={14} /> : <ImageIcon size={14} />}{creative.name}</span>
                  </button>
                ))}
              </div>

              <div className="share-draft-preview">
                <span>Message preview</span>
                <pre>{buildWhatsAppDraft(shareLinkFor(shareTarget))}</pre>
              </div>
            </div>

            <div className="share-draft-modal-footer">
              <div className="share-draft-primary-actions">
                <button type="button" className="primary-button" onClick={() => void sharePosterAndDraft()}>
                  <Share2 size={17} /> Share poster + text
                </button>
                <button type="button" className="whatsapp-button" onClick={openWhatsAppDraft}>
                  <MessageCircle size={17} /> Open WhatsApp
                </button>
              </div>
              <div className="share-draft-secondary-actions">
                <button
                  type="button"
                  className={copyFeedback === "share:draft" ? "copied" : ""}
                  onClick={() => void copy(
                    buildWhatsAppDraft(shareLinkFor(shareTarget)),
                    "share:draft",
                  )}
                >
                  {copyFeedback === "share:draft" ? <Check size={16} /> : <Copy size={16} />}
                  {copyFeedback === "share:draft" ? "Draft copied!" : "Copy draft"}
                </button>
                <button type="button" onClick={() => void copySelectedPoster()}>
                  <Copy size={16} /> Copy poster
                </button>
                <button type="button" onClick={downloadSelectedPoster}>
                  <Download size={16} /> Download poster
                </button>
              </div>
              <p className="share-draft-compatibility">
                Native sharing sends the poster and text together when supported. WhatsApp Web may require pasting the copied draft separately.
              </p>
              {shareNotice && <p className="share-draft-notice" aria-live="polite">{shareNotice}</p>}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function LeadsTable({
  registrations,
  employees,
  canDelete,
  whatsappAccess,
  onUpdate,
  onReconcile,
}: {
  registrations: Registration[];
  employees: Profile[];
  canDelete: boolean;
  whatsappAccess: boolean;
  onUpdate: DashboardUpdater;
  onReconcile: () => void;
}) {
  const executiveNames = new Map(
    employees.map((employee) => [employee.id, employee.full_name]),
  );

  return (
    <div className="data-table">
      <div className={`data-row lead-grid ${whatsappAccess ? "" : "no-whatsapp"} table-header`}>
        <span>Student</span><span>Group / CA</span><span>Domain</span><span>Captured at</span>
        {whatsappAccess && <span>WhatsApp</span>}
        <span>Status</span><span>Follow-up note</span><span />
      </div>
      {registrations.map((lead) => (
        <LeadRow
          key={lead.id}
          lead={lead}
          executiveName={executiveNames.get(lead.owner_sales_id) ?? "Unassigned"}
          canDelete={canDelete}
          whatsappAccess={whatsappAccess}
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
  executiveName,
  canDelete,
  whatsappAccess,
  onUpdate,
  onReconcile,
}: {
  lead: Registration;
  executiveName: string;
  canDelete: boolean;
  whatsappAccess: boolean;
  onUpdate: DashboardUpdater;
  onReconcile: () => void;
}) {
  const [status, setStatus] = useState<RegistrationStatus>(lead.status);
  const [note, setNote] = useState(lead.note);
  const [saving, setSaving] = useState(false);
  const [showWhatsApp, setShowWhatsApp] = useState(false);
  const whatsapp = whatsappFor(lead);

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
    <div className={`data-row lead-grid ${whatsappAccess ? "" : "no-whatsapp"}`}>
      <div className="identity-cell">
        <span className="avatar">{lead.name[0]}</span>
        <div>
          <strong>{lead.name}</strong>
          <small>{lead.phone}</small>
        </div>
      </div>
      <div className="lead-source-cell">
        <span>{ambassadorLabel(lead)}</span>
        <small className="executive-tag" title={`Executive: ${executiveName}`}>
          Executive: {executiveName}
        </small>
      </div>
      <span className="domain-tag">{lead.preferred_domain}</span>
      <span className="captured-at" title={new Date(lead.created_at).toISOString()}>
        <strong>{formatDate(lead.created_at)}</strong>
        <small>{formatTime(lead.created_at)}</small>
      </span>
      {whatsappAccess && (
        <button
          type="button"
          className={`whatsapp-stage-button ${whatsapp?.urgency ?? "low"}`}
          onClick={() => setShowWhatsApp(true)}
          title="Open WhatsApp conversation"
        >
          <MessageCircle size={14} />
          <span>
            <strong>{whatsappStageLabels[whatsapp?.state ?? "not_started"] ?? whatsapp?.state}</strong>
            <small>{whatsapp ? `${whatsapp.lead_score}/100` : "Not linked"}</small>
          </span>
        </button>
      )}
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
      {whatsappAccess && showWhatsApp && (
        <WhatsAppLeadPanel
          lead={lead}
          summary={whatsapp}
          onClose={() => setShowWhatsApp(false)}
          onReconcile={onReconcile}
        />
      )}
    </div>
  );
}

type WhatsAppConversationDetail = WhatsAppConversationSummary & {
  flow_step: string;
  wa_id: string;
  conversation_window_expires_at: string | null;
  registration: {
    id: string;
    name: string;
    phone: string;
    preferred_domain: string;
    status: RegistrationStatus;
    note: string;
  } | Array<{
    id: string;
    name: string;
    phone: string;
    preferred_domain: string;
    status: RegistrationStatus;
    note: string;
  }>;
  sales: { id: string; full_name: string; email: string } | Array<{
    id: string;
    full_name: string;
    email: string;
  }>;
};

function WhatsAppLeadPanel({
  lead,
  summary,
  onClose,
  onReconcile,
}: {
  lead: Registration;
  summary: WhatsAppConversationSummary | null;
  onClose: () => void;
  onReconcile: () => void;
}) {
  const [conversation, setConversation] = useState<WhatsAppConversationDetail | null>(null);
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sessionOpen, setSessionOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch(`/api/whatsapp/conversations/${lead.id}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response));
        return response.json();
      })
      .then((payload) => {
        if (!active) return;
        setConversation(payload.conversation);
        setMessages(payload.messages ?? []);
        setSessionOpen(Boolean(payload.sessionOpen));
        setError("");
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Unable to load conversation.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [lead.id, summary?.updated_at]);

  async function toggleAutomation() {
    if (!conversation) return;
    setBusy(true);
    const response = await dashboardMutation(`/api/whatsapp/conversations/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: conversation.bot_paused ? "resume" : "pause" }),
    });
    setBusy(false);
    if (!response.ok) {
      setError(await readError(response));
      return;
    }
    const payload = await response.json();
    setConversation(payload.conversation);
    onReconcile();
  }

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    const outgoing = message.trim();
    if (!outgoing) return;
    setBusy(true);
    setError("");
    const response = await dashboardMutation(`/api/whatsapp/conversations/${lead.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: outgoing }),
    });
    setBusy(false);
    if (!response.ok) {
      setError(await readError(response));
      return;
    }
    setMessages((current) => [
      ...current,
      {
        id: `pending-${Date.now()}`,
        direction: "outbound",
        message_type: "text",
        body: outgoing,
        intent: "manual_reply",
        template_name: null,
        status: "queued",
        error_detail: null,
        created_at: new Date().toISOString(),
      },
    ]);
    setMessage("");
    setConversation((current) => (current ? { ...current, bot_paused: true } : current));
    onReconcile();
  }

  return (
    <div className="modal-backdrop whatsapp-panel-backdrop" onMouseDown={onClose}>
      <section className="whatsapp-lead-panel" onMouseDown={(event) => event.stopPropagation()}>
        <header className="whatsapp-panel-header">
          <div>
            <span className="eyebrow">WATI CONVERSATION</span>
            <h2>{lead.name}</h2>
            <p>{lead.phone} · {lead.preferred_domain}</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close WhatsApp conversation">
            <X size={19} />
          </button>
        </header>

        {loading ? (
          <div className="whatsapp-panel-loading"><RefreshCw className="spin" size={20} /> Loading conversation…</div>
        ) : error && !conversation ? (
          <div className="alert error">{error}</div>
        ) : conversation ? (
          <>
            <div className="whatsapp-conversation-meta">
              <span><small>Stage</small><strong>{whatsappStageLabels[conversation.state] ?? conversation.state}</strong></span>
              <span><small>Lead score</small><strong>{conversation.lead_score}/100</strong></span>
              <span><small>Automation</small><strong>{conversation.bot_paused ? "Paused" : "Active"}</strong></span>
              <button type="button" onClick={() => void toggleAutomation()} disabled={busy || Boolean(conversation.opted_out_at)}>
                {conversation.bot_paused ? <RefreshCw size={15} /> : <PauseCircle size={15} />}
                {conversation.bot_paused ? "Resume bot" : "Pause bot"}
              </button>
            </div>

            {conversation.opted_out_at && (
              <div className="alert error">The student opted out. Outbound messaging is disabled.</div>
            )}
            {error && <div className="alert error">{error}</div>}

            <div className="whatsapp-message-list">
              {!messages.length && (
                <div className="whatsapp-empty-thread">
                  <MessageCircle size={24} />
                  <strong>No WhatsApp messages yet</strong>
                  <span>The approved welcome template will appear here after WATI sends it.</span>
                </div>
              )}
              {messages.map((item) => (
                <article key={item.id} className={`whatsapp-bubble ${item.direction}`}>
                  <p>{item.body}</p>
                  <small>{formatDateTime(item.created_at)} · {item.status}</small>
                  {item.error_detail && <em>{item.error_detail}</em>}
                </article>
              ))}
            </div>

            <form className="whatsapp-composer" onSubmit={sendMessage}>
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={sessionOpen ? "Reply as the assigned Persevex team…" : "Waiting for the student to reply…"}
                maxLength={4000}
                disabled={busy || !sessionOpen || Boolean(conversation.opted_out_at)}
              />
              <button type="submit" disabled={busy || !sessionOpen || !message.trim() || Boolean(conversation.opted_out_at)}>
                <Send size={17} /> Send
              </button>
            </form>
            {!sessionOpen && !conversation.opted_out_at && (
              <p className="whatsapp-session-note">
                Free-form replies unlock after the student responds. Outside the 24-hour window, use an approved WATI template.
              </p>
            )}
          </>
        ) : null}
      </section>
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
    fullName: "", email: "", phone: "", role: "sales", teamId: "", teamIds: [] as string[], password: "",
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
      managed_team_ids: form.role === "team_lead"
        ? [...new Set([form.teamId, ...form.teamIds].filter(Boolean))]
        : [form.teamId],
      active: true,
      wati_enabled: true,
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
        <label>Role<select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value, teamIds: [] })}><option value="sales">Sales Executive</option><option value="team_lead">Team Lead</option></select></label>
        <label>Primary team<select value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value })} required><option value="">Select team</option>{teams.filter((team) => !team.id.startsWith("pending-")).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
        {form.role === "team_lead" && (
          <fieldset className="team-checkbox-field full-span">
            <legend>Additional teams to manage</legend>
            <p>The Team Lead can switch between every selected team from their dashboard.</p>
            <div>
              {teams.filter((team) => !team.id.startsWith("pending-") && team.id !== form.teamId).map((team) => (
                <label key={team.id}>
                  <input
                    type="checkbox"
                    checked={form.teamIds.includes(team.id)}
                    onChange={(event) => setForm({
                      ...form,
                      teamIds: event.target.checked
                        ? [...form.teamIds, team.id]
                        : form.teamIds.filter((id) => id !== team.id),
                    })}
                  />
                  {team.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}
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
  teamId,
  target,
  onPending,
  onDone,
  onFailed,
}: {
  user: Profile;
  teamId: string | null;
  target: number;
  onPending: (ambassador: AmbassadorPerformance) => void;
  onDone: (pendingId: string, ambassador: AmbassadorPerformance) => void;
  onFailed: (ambassador: AmbassadorPerformance, message: string) => void;
}) {
  const [form, setForm] = useState({
    name: "", email: "", phone: "", college: "", city: "", courseYear: "",
  });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const now = new Date().toISOString();
    const pendingAmbassador: AmbassadorPerformance = {
      id: `pending-${crypto.randomUUID()}`,
      sales_id: user.id,
      team_id: teamId ?? "",
      name: form.name.trim(),
      email: form.email.trim(),
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
        body: JSON.stringify({ ...form, teamId }),
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
        team_id: payload.ambassador.team_id ?? teamId ?? "",
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
        <label>Email address<input className="plain-input" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
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
