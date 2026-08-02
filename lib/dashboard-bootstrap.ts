"use client";

import type { DashboardData } from "@/lib/types";

let dashboardBootstrap: DashboardData | null = null;

export function setDashboardBootstrap(data: DashboardData) {
  dashboardBootstrap = data;
}

export function peekDashboardBootstrap() {
  return dashboardBootstrap;
}

export function clearDashboardBootstrap() {
  dashboardBootstrap = null;
}
