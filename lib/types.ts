export type AppRole = "admin" | "team_lead" | "sales";

export type Profile = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  role: AppRole;
  team_id: string | null;
  active: boolean;
  must_change_password: boolean;
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
  status: RegistrationStatus;
  note: string;
  created_at: string;
  updated_at: string;
  anonymized_at: string | null;
  ambassador?: { name: string; college: string } | null;
};

export type DashboardData = {
  user: Profile;
  defaultTarget: number;
  teams: TeamPerformance[];
  employees: Profile[];
  salesPerformance: SalesPerformance[];
  ambassadors: AmbassadorPerformance[];
  registrations: Registration[];
};
