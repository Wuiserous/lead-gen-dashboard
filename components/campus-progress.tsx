"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Award,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  RefreshCw,
  Target,
  Users,
} from "lucide-react";
import Image from "next/image";
import { createBrowserSupabase } from "@/lib/supabase/browser";

type ProgressData = {
  ambassador_id: string;
  progress_key: string;
  registration_count: number;
  target: number;
  qualified: boolean;
  updated_at: string;
  ambassador: {
    name: string;
    college: string;
    status: "active" | "paused";
  };
  registrations: Array<{
    id: string;
    name: string;
    preferred_domain: string;
    status: string;
    created_at: string;
    updated_at: string;
  }>;
  registration_total: number;
  converted_count: number;
  visible_limit: number;
};

export function CampusProgress({ progressKey }: { progressKey: string }) {
  const [data, setData] = useState<ProgressData | null>(null);
  const [error, setError] = useState("");
  const [live, setLive] = useState(false);
  const [limit, setLimit] = useState(50);

  const load = useCallback(async () => {
    const response = await fetch(`/api/public/progress/${progressKey}?limit=${limit}`, {
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok) {
      setError(result.error ?? "Progress link not found.");
      return;
    }
    setData(result);
    setError("");
  }, [limit, progressKey]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    const supabase = createBrowserSupabase();
    const channel = supabase
      .channel(`progress-${progressKey}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "ambassador_progress",
          filter: `progress_key=eq.${progressKey}`,
        },
        () => void load(),
      )
      .subscribe((status: string) => setLive(status === "SUBSCRIBED"));
    return () => {
      window.clearTimeout(initialLoad);
      void supabase.removeChannel(channel);
    };
  }, [load, progressKey]);

  if (error) {
    return (
      <main className="center-page">
        <div className="simple-card">
          <Image
            src="/persevex-logo.png"
            alt="Persevex"
            width={865}
            height={375}
            className="small-logo"
          />
          <h1>Progress link unavailable</h1>
          <p className="muted">{error}</p>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="center-page">
        <RefreshCw className="spin" />
      </main>
    );
  }

  const percentage = Math.min(
    100,
    Math.round((data.registration_count / data.target) * 100),
  );
  const remaining = Math.max(0, data.target - data.registration_count);

  return (
    <main className="progress-page">
      <header className="progress-header">
        <Image src="/persevex-logo.png" alt="Persevex" width={865} height={375} priority />
        <span className={`live-pill ${live ? "connected" : ""}`}>
          <i /> {live ? "Live" : "Connecting"}
        </span>
      </header>
      <section className="progress-welcome">
        <span className="eyebrow light">CAMPUS AMBASSADOR PROGRESS</span>
        <h1>Hi, {data.ambassador.name}</h1>
        <p>{data.ambassador.college}</p>
      </section>
      <section className="progress-content">
        <div className="progress-main-card">
          <div className="progress-card-head">
            <div>
              <span className="eyebrow">YOUR PROGRESS</span>
              <h2>{data.registration_count} registrations</h2>
            </div>
            <span className={data.qualified ? "qualified-badge" : "goal-badge"}>
              {data.qualified ? <Award size={18} /> : <Target size={18} />}
              {data.qualified ? "Qualified" : `${remaining} remaining`}
            </span>
          </div>
          <div className="big-progress-track">
            <span style={{ width: `${percentage}%` }} />
          </div>
          <div className="progress-scale">
            <span>{percentage}% complete</span>
            <span>Goal: {data.target}</span>
          </div>
          {data.qualified ? (
            <div className="qualification-message">
              <CheckCircle2 size={22} />
              <div>
                <strong>You have qualified.</strong>
                <p>
                  Registrations beyond {data.target} will continue adding to
                  your total.
                </p>
              </div>
            </div>
          ) : (
            <div className="qualification-message neutral">
              <Users size={22} />
              <div>
                <strong>Keep sharing your official referral link.</strong>
                <p>Every valid registration moves you closer to qualification.</p>
              </div>
            </div>
          )}
        </div>
        <section className="progress-leads-card">
          <div className="progress-leads-header">
            <div>
              <span className="eyebrow">YOUR REGISTRATIONS</span>
              <h2>Students registered through your link</h2>
              <p>Conversion updates appear here automatically.</p>
            </div>
            <div className="progress-leads-summary">
              <span><Users size={16} /><strong>{data.registration_total}</strong> registered</span>
              <span className="converted"><CheckCircle2 size={16} /><strong>{data.converted_count}</strong> converted</span>
            </div>
          </div>

          <div className="progress-lead-list">
            {data.registrations.map((registration) => {
              const converted = registration.status === "converted";
              return (
                <article className="progress-lead-row" key={registration.id}>
                  <span className="progress-lead-avatar">
                    {registration.name.trim().slice(0, 1).toUpperCase()}
                  </span>
                  <div className="progress-lead-person">
                    <strong>{registration.name}</strong>
                    <span><BriefcaseBusiness size={13} /> {registration.preferred_domain}</span>
                  </div>
                  <span className="progress-lead-date">
                    <CalendarDays size={13} />
                    {new Date(registration.created_at).toLocaleDateString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                  <span className={`progress-lead-status ${converted ? "converted" : ""}`}>
                    {converted ? <CheckCircle2 size={14} /> : <Users size={14} />}
                    {converted ? "Converted" : "Registered"}
                  </span>
                </article>
              );
            })}
            {!data.registrations.length && (
              <div className="progress-leads-empty">
                <Users size={25} />
                <strong>No registrations yet</strong>
                <p>Students will appear here as soon as they use your referral link.</p>
              </div>
            )}
          </div>

          {data.registrations.length < data.registration_total && (
            <button
              type="button"
              className="progress-load-more"
              onClick={() => setLimit((current) => Math.min(500, current + 50))}
              disabled={limit >= 500}
            >
              Show more registrations
            </button>
          )}
        </section>
        <p className="progress-updated">
          Last updated {new Date(data.updated_at).toLocaleString("en-IN")}
        </p>
      </section>
    </main>
  );
}
