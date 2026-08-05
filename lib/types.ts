export type AppRole = "admin" | "team_lead" | "sales";

export type Profile = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  role: AppRole;
  team_id: string | null;
  active: boolean;
  created_at: string;
};

export type TeamPerformance = {
  id: string;
  name: string;
  active: boolean;
  sales_count: number;
  ambassador_count: number;
  registration_count: number;
};

export type SalesPerformance = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  team_id: string | null;
  active: boolean;
  ambassador_count: number;
  active_ambassador_count: number;
  registration_count: number;
  qualified_ambassador_count: number;
};

export type AmbassadorPerformance = {
  id: string;
  sales_id: string;
  team_id: string;
  name: string;
  phone: string;
  college: string;
  city: string;
  course_year: string;
  public_slug: string;
  progress_key: string;
  target: number;
  status: "active" | "paused";
  created_at: string;
  updated_at: string;
  registration_count: number;
  qualified: boolean;
  progress_updated_at: string;
};

export type RegistrationStatus =
  | "new"
  | "contacted"
  | "interested"
  | "follow_up"
  | "converted"
  | "not_interested"
  | "invalid";

export type Registration = {
  id: string;
  ambassador_id: string;
  credited_sales_id: string;
  credited_team_id: string;
  name: string;
  phone: string;
  preferred_domain: string;
  status: RegistrationStatus;
  note: string;
  created_at: string;
  updated_at: string;
  anonymized_at: string | null;
  ambassador?: { name: string; college: string } | null;
};

export type DashboardSummary = {
  registrationRowCount: number;
  registrationCount: number;
  todayRegistrationCount: number;
  convertedCount: number;
  groupsRepresentedCount: number;
  ambassadorCount: number;
  activeAmbassadorCount: number;
  qualifiedAmbassadorCount: number;
  groupCreatorCount: number;
  daily: Array<{ date: string; count: number }>;
  groupRankings: Array<{
    ambassadorId: string;
    registrationCount: number;
  }>;
};

export type DashboardPagination = {
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
};

export type DashboardData = {
  user: Profile;
  defaultTarget: number;
  teams: TeamPerformance[];
  employees: Profile[];
  salesPerformance: SalesPerformance[];
  ambassadors: AmbassadorPerformance[];
  registrations: Registration[];
  summary: DashboardSummary;
  pagination: DashboardPagination;
};

export type DashboardActivityEvent = {
  id: number;
  event_type: string;
  team_id: string | null;
  sales_id: string | null;
  ambassador_id: string | null;
  entity_id: string | null;
  created_at: string;
};

export type DashboardLiveUpdate = {
  event: DashboardActivityEvent;
  registration: Registration | null;
  ambassador: AmbassadorPerformance | null;
  profile: Profile | null;
  teamPerformance: TeamPerformance | null;
  salesPerformance: SalesPerformance | null;
  summary: DashboardSummary | null;
  pagination: DashboardPagination | null;
};

export type AdminStatistics = {
  overview: {
    registrations: number;
    converted: number;
    conversionRate: number;
    todayRegistrations: number;
    invalidRegistrations: number;
    activeTeams: number;
    activeEmployees: number;
    activeAmbassadors: number;
    qualifiedAmbassadors: number;
  };
  statusBreakdown: Array<{ status: RegistrationStatus; count: number }>;
  domainBreakdown: Array<{
    domain: string;
    registrations: number;
    converted: number;
  }>;
  daily: Array<{
    date: string;
    registrations: number;
    converted: number;
  }>;
  teams: Array<{
    id: string;
    name: string;
    members: number;
    ambassadors: number;
    qualified_ambassadors: number;
    registrations: number;
    converted: number;
  }>;
  members: Array<{
    id: string;
    name: string;
    role: "sales" | "team_lead";
    team_id: string | null;
    team_name: string | null;
    ambassadors: number;
    qualified_ambassadors: number;
    registrations: number;
    converted: number;
  }>;
  ambassadors: Array<{
    id: string;
    name: string;
    college: string;
    sales_id: string;
    creator_name: string | null;
    team_id: string;
    team_name: string | null;
    target: number;
    qualified: boolean;
    registrations: number;
    converted: number;
  }>;
  generatedAt: string;
};
