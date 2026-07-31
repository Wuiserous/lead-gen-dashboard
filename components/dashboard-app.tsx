"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Award,
  Building2,
  Check,
  ChevronRight,
  Clipboard,
  Copy,
  LayoutDashboard,
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
  Upload,
  UserPlus,
  Users,
  UsersRound,
  X,
} from "lucide-react";
import Papa from "papaparse";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import type {
  AppRole,
  DashboardData,
  Registration,
  RegistrationStatus,
} from "@/lib/types";

type Tab = "overview" | "teams" | "employees" | "ambassadors" | "leads";
type ModalName = "team" | "employee" | "import" | "ambassador" | null;

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

export function DashboardApp({ expectedRole }: { expectedRole: AppRole }) {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [modal, setModal] = useState<ModalName>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [live, setLive] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    const response = await fetch("/api/dashboard", { cache: "no-store" });
    if (!response.ok) {
      if (response.status === 401) {
        router.replace("/");
        return;
      }
      setError(await readError(response));
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const result = (await response.json()) as DashboardData;
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
    setError("");
    setLoading(false);
    setRefreshing(false);
  }, [expectedRole, router]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [load]);

  useEffect(() => {
    if (!data?.user) return;
    const supabase = createBrowserSupabase();
    const filter =
      data.user.role === "sales"
        ? `sales_id=eq.${data.user.id}`
        : data.user.role === "team_lead" && data.user.team_id
          ? `team_id=eq.${data.user.team_id}`
          : undefined;
    const channel = supabase
      .channel(`dashboard-${data.user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "activity_events",
          ...(filter ? { filter } : {}),
        },
        () => void load(true),
      )
      .subscribe((status: string) => setLive(status === "SUBSCRIBED"));
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [data?.user, load]);

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
    { id: "ambassadors", label: "Ambassadors", icon: <Users size={18} /> },
    { id: "leads", label: "Registrations", icon: <Clipboard size={18} /> },
  ];

  const filteredRegistrations = data.registrations.filter((lead) => {
    const needle = search.toLowerCase();
    return (
      !needle ||
      lead.name.toLowerCase().includes(needle) ||
      lead.phone.includes(needle) ||
      ambassadorLabel(lead).toLowerCase().includes(needle)
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
            {data.user.role === "sales" && tab === "ambassadors" && (
              <button className="primary-button" onClick={() => setModal("ambassador")}>
                <Plus size={17} /> Add ambassador
              </button>
            )}
          </div>
        </header>

        {error && <div className="alert error">{error}</div>}

        <div className="dashboard-content">
          {tab === "overview" && (
            <Overview data={data} onRefresh={() => void load(true)} />
          )}
          {tab === "teams" && (
            <TeamsView data={data} onRefresh={() => void load(true)} />
          )}
          {tab === "employees" && (
            <EmployeesView data={data} onRefresh={() => void load(true)} />
          )}
          {tab === "ambassadors" && (
            <AmbassadorsView data={data} onRefresh={() => void load(true)} />
          )}
          {tab === "leads" && (
            <section>
              <div className="table-toolbar">
                <div>
                  <h2>Student registrations</h2>
                  <p>{data.registrations.length} records available in your scope</p>
                </div>
                <label className="search-box">
                  <Search size={17} />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search name, phone, or ambassador"
                  />
                </label>
              </div>
              <LeadsTable
                registrations={filteredRegistrations}
                onRefresh={() => void load(true)}
              />
            </section>
          )}
        </div>
      </main>

      {modal && (
        <Modal onClose={() => setModal(null)}>
          {modal === "team" && (
            <TeamForm
              onDone={() => {
                setModal(null);
                void load(true);
              }}
            />
          )}
          {modal === "employee" && (
            <EmployeeForm
              teams={data.teams}
              onDone={() => {
                setModal(null);
                void load(true);
              }}
            />
          )}
          {modal === "import" && (
            <EmployeeImport
              teams={data.teams}
              onDone={() => void load(true)}
            />
          )}
          {modal === "ambassador" && (
            <AmbassadorForm
              onDone={() => {
                setModal(null);
                void load(true);
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
  if (tab === "ambassadors") return "Campus Ambassadors";
  return "Registrations";
}

function Overview({
  data,
  onRefresh,
}: {
  data: DashboardData;
  onRefresh: () => void;
}) {
  const totalRegistrations =
    data.user.role === "admin"
      ? data.teams.reduce((sum, team) => sum + team.registration_count, 0)
      : data.user.role === "team_lead"
        ? (data.teams[0]?.registration_count ?? 0)
        : (data.salesPerformance[0]?.registration_count ?? 0);
  const qualified = data.ambassadors.filter((item) => item.qualified).length;
  const activeAmbassadors = data.ambassadors.filter(
    (item) => item.status === "active",
  ).length;

  return (
    <section className="overview-stack">
      <div className="metric-grid">
        <MetricCard
          label="Registrations"
          value={totalRegistrations}
          detail="Valid registrations in your scope"
          icon={<Clipboard size={21} />}
        />
        <MetricCard
          label="Campus Ambassadors"
          value={data.ambassadors.length}
          detail={`${activeAmbassadors} currently active`}
          icon={<Users size={21} />}
        />
        <MetricCard
          label="Qualified"
          value={qualified}
          detail={`Reached their individual target`}
          icon={<Award size={21} />}
        />
        <MetricCard
          label={data.user.role === "admin" ? "Sales Executives" : "Team target"}
          value={
            data.user.role === "admin"
              ? data.salesPerformance.filter((item) => item.active).length
              : data.defaultTarget
          }
          detail={
            data.user.role === "admin"
              ? "Active across all teams"
              : "Default registrations per ambassador"
          }
          icon={<Target size={21} />}
        />
      </div>

      <div className="overview-grid">
        <div className="panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">PERFORMANCE</span>
              <h2>Ambassador progress</h2>
            </div>
            <span className="panel-count">{data.ambassadors.length}</span>
          </div>
          <div className="progress-list">
            {data.ambassadors.slice(0, 6).map((ambassador) => (
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
            {!data.ambassadors.length && (
              <EmptyState
                title="No ambassadors yet"
                text={
                  data.user.role === "sales"
                    ? "Open the Ambassadors tab to create your first Campus Ambassador."
                    : "Ambassador progress will appear after Sales creates one."
                }
              />
            )}
          </div>
        </div>

        <div className="panel activity-panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">SYSTEM</span>
              <h2>How counting works</h2>
            </div>
            <Activity size={21} />
          </div>
          <div className="rule-list">
            <div><Check size={17} /><span>One phone number counts once company-wide.</span></div>
            <div><Check size={17} /><span>First successful registration receives credit.</span></div>
            <div><Check size={17} /><span>There is no maximum registration count.</span></div>
            <div><Check size={17} /><span>Invalid registrations stop counting toward qualification.</span></div>
          </div>
          {data.user.role === "admin" && (
            <DefaultTargetForm
              value={data.defaultTarget}
              onDone={onRefresh}
            />
          )}
        </div>
      </div>
    </section>
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
  onRefresh,
}: {
  data: DashboardData;
  onRefresh: () => void;
}) {
  const teamLeadByTeam = new Map(
    data.employees
      .filter((employee) => employee.role === "team_lead")
      .map((employee) => [employee.team_id, employee]),
  );
  async function toggleTeam(id: string, active: boolean) {
    const response = await fetch(`/api/teams/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
    if (!response.ok) {
      window.alert(await readError(response));
      return;
    }
    onRefresh();
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
          return (
            <article className="team-card" key={team.id}>
              <div className="team-card-head">
                <span className="team-icon"><Building2 size={21} /></span>
                <span className={`status-dot ${team.active ? "active" : ""}`}>
                  {team.active ? "Active" : "Inactive"}
                </span>
              </div>
              <h3>{team.name}</h3>
              <p>{lead ? `Led by ${lead.full_name}` : "Team Lead not assigned"}</p>
              <div className="team-stats">
                <span><strong>{team.sales_count}</strong> Sales</span>
                <span><strong>{team.ambassador_count}</strong> CAs</span>
                <span><strong>{team.registration_count}</strong> Registrations</span>
              </div>
              <button
                className="team-toggle"
                onClick={() => void toggleTeam(team.id, !team.active)}
              >
                {team.active ? "Deactivate team" : "Reactivate team"}
              </button>
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
  onRefresh,
}: {
  data: DashboardData;
  onRefresh: () => void;
}) {
  const teamNames = new Map(data.teams.map((team) => [team.id, team.name]));

  async function patchEmployee(id: string, body: Record<string, unknown>) {
    const response = await fetch(`/api/employees/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      window.alert(await readError(response));
      return;
    }
    onRefresh();
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
                {employee.active ? "Active" : "Suspended"}
              </span>
              <span>
                {performance
                  ? `${performance.registration_count} registrations`
                  : employee.role === "team_lead"
                    ? "Team oversight"
                    : "Organization access"}
              </span>
              {data.user.role === "admin" && employee.role !== "admin" ? (
                <button
                  className="text-button"
                  onClick={() =>
                    void patchEmployee(employee.id, { active: !employee.active })
                  }
                >
                  {employee.active ? "Suspend" : "Reactivate"}
                </button>
              ) : <span />}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AmbassadorsView({
  data,
  onRefresh,
}: {
  data: DashboardData;
  onRefresh: () => void;
}) {
  async function update(id: string, body: Record<string, unknown>) {
    const response = await fetch(`/api/ambassadors/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      window.alert(await readError(response));
      return;
    }
    onRefresh();
  }

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
  }

  return (
    <section>
      <div className="table-toolbar">
        <div>
          <h2>Campus Ambassador performance</h2>
          <p>Every public link is attributed to exactly one ambassador.</p>
        </div>
      </div>
      <div className="ambassador-grid">
        {data.ambassadors.map((ambassador) => {
          const link = `${publicBaseUrl()}/join/${ambassador.public_slug}`;
          const progressLink = `${publicBaseUrl()}/ca/${ambassador.progress_key}`;
          const draft = `Hi! Persevex is accepting student registrations for internship and career opportunities across 12+ domains, real-world projects, live mentor access, and up to INR 18,000-25,000 stipend based upon performance.\n\nRegister through my official invitation:\n${link}`;
          const percentage = Math.min(
            100,
            Math.round((ambassador.registration_count / ambassador.target) * 100),
          );
          return (
            <article className="ambassador-card" key={ambassador.id}>
              <div className="ambassador-head">
                <span className="avatar large">{ambassador.name[0]}</span>
                <div><h3>{ambassador.name}</h3><p>{ambassador.college}</p></div>
                <span className={`status-dot ${ambassador.status === "active" ? "active" : ""}`}>
                  {ambassador.status}
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
                <button onClick={() => void copy(draft)}><Copy size={16} /> WhatsApp draft</button>
                <button onClick={() => void copy(link)}><Link2 size={16} /> Referral link</button>
                <button onClick={() => void copy(progressLink)}><Target size={16} /> Progress link</button>
              </div>
              <div className="ambassador-footer">
                <span>{ambassador.phone}</span>
                <div>
                  <button
                    className="icon-button"
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
                    title="Regenerate private progress link"
                    onClick={() => {
                      if (window.confirm("Replace the existing private progress link?")) {
                        void update(ambassador.id, { regenerateProgressLink: true });
                      }
                    }}
                  >
                    <RefreshCw size={17} />
                  </button>
                </div>
              </div>
            </article>
          );
        })}
        {!data.ambassadors.length && (
          <EmptyState
            title="No Campus Ambassadors"
            text={
              data.user.role === "sales"
                ? "Add your first ambassador to generate an official referral link."
                : "Ambassadors created by Sales will appear here."
            }
          />
        )}
      </div>
    </section>
  );
}

function LeadsTable({
  registrations,
  onRefresh,
}: {
  registrations: Registration[];
  onRefresh: () => void;
}) {
  return (
    <div className="data-table">
      <div className="data-row lead-grid table-header">
        <span>Student</span><span>Ambassador</span><span>Registered</span><span>Status</span><span>Follow-up note</span><span />
      </div>
      {registrations.map((lead) => (
        <LeadRow key={lead.id} lead={lead} onSaved={onRefresh} />
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

function LeadRow({ lead, onSaved }: { lead: Registration; onSaved: () => void }) {
  const [status, setStatus] = useState<RegistrationStatus>(lead.status);
  const [note, setNote] = useState(lead.note);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const response = await fetch(`/api/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, note }),
    });
    setSaving(false);
    if (!response.ok) {
      window.alert(await readError(response));
      return;
    }
    onSaved();
  }

  return (
    <div className="data-row lead-grid">
      <div className="identity-cell">
        <span className="avatar">{lead.name[0]}</span>
        <div><strong>{lead.name}</strong><small>{lead.phone}</small></div>
      </div>
      <span>{ambassadorLabel(lead)}</span>
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
      <button className="text-button" onClick={() => void save()} disabled={saving}>
        {saving ? "Saving" : "Save"}
      </button>
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

function TeamForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    const response = await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setLoading(false);
    if (!response.ok) return setError(await readError(response));
    onDone();
  }

  return (
    <>
      <span className="eyebrow">ORGANIZATION</span>
      <h2>Create a team</h2>
      <p className="muted">Employees can be assigned after the team is created.</p>
      <form className="stack-form" onSubmit={submit}>
        <label>Team name<input className="plain-input" value={name} onChange={(event) => setName(event.target.value)} required /></label>
        {error && <div className="alert error">{error}</div>}
        <button className="primary-button wide" disabled={loading}>{loading ? "Creating..." : "Create team"}</button>
      </form>
    </>
  );
}

function EmployeeForm({
  teams,
  onDone,
}: {
  teams: DashboardData["teams"];
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    fullName: "", email: "", phone: "", role: "sales", teamId: "", temporaryPassword: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    const response = await fetch("/api/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setLoading(false);
    if (!response.ok) return setError(await readError(response));
    onDone();
  }

  return (
    <>
      <span className="eyebrow">EMPLOYEE ACCESS</span>
      <h2>Add an employee</h2>
      <p className="muted">They must replace the temporary password after signing in.</p>
      <form className="stack-form two-column" onSubmit={submit}>
        <label>Full name<input className="plain-input" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required /></label>
        <label>Work email<input className="plain-input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
        <label>Phone (optional)<input className="plain-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
        <label>Role<select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="sales">Sales Executive</option><option value="team_lead">Team Lead</option></select></label>
        <label>Team<select value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value })} required><option value="">Select team</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
        <label>Temporary password<input className="plain-input" type="password" value={form.temporaryPassword} onChange={(e) => setForm({ ...form, temporaryPassword: e.target.value })} minLength={12} required /></label>
        {error && <div className="alert error full-span">{error}</div>}
        <button className="primary-button wide full-span" disabled={loading}>{loading ? "Creating..." : "Create employee"}</button>
      </form>
    </>
  );
}

function EmployeeImport({
  teams,
  onDone,
}: {
  teams: DashboardData["teams"];
  onDone: () => void;
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
      temporaryPassword: row.temporary_password ?? row.password,
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
    if (payload.created?.length) onDone();
  }

  return (
    <>
      <span className="eyebrow">BULK ONBOARDING</span>
      <h2>Import employees</h2>
      <p className="muted">
        CSV headers: name, email, phone, role, team, temporary_password.
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

function AmbassadorForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({
    name: "", phone: "", college: "", city: "", courseYear: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    const response = await fetch("/api/ambassadors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setLoading(false);
    if (!response.ok) return setError(await readError(response));
    onDone();
  }

  return (
    <>
      <span className="eyebrow">CAMPUS NETWORK</span>
      <h2>Add a Campus Ambassador</h2>
      <p className="muted">The referral and private progress links are generated automatically.</p>
      <form className="stack-form two-column" onSubmit={submit}>
        <label>Full name<input className="plain-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
        <label>Mobile number<input className="plain-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required /></label>
        <label className="full-span">College<input className="plain-input" value={form.college} onChange={(e) => setForm({ ...form, college: e.target.value })} required /></label>
        <label>City<input className="plain-input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label>
        <label>Course and year<input className="plain-input" value={form.courseYear} onChange={(e) => setForm({ ...form, courseYear: e.target.value })} /></label>
        {error && <div className="alert error full-span">{error}</div>}
        <button className="primary-button wide full-span" disabled={loading}>{loading ? "Creating..." : "Create ambassador"}</button>
      </form>
    </>
  );
}

function DefaultTargetForm({
  value,
  onDone,
}: {
  value: number;
  onDone: () => void;
}) {
  const [target, setTarget] = useState(value);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const response = await fetch("/api/settings/target", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
    });
    setSaving(false);
    if (!response.ok) return window.alert(await readError(response));
    onDone();
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
