"use client";

import { useCallback, useEffect, useState } from "react";
import { Award, CheckCircle2, RefreshCw, Target, Users } from "lucide-react";
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
};

export function CampusProgress({ progressKey }: { progressKey: string }) {
  const [data, setData] = useState<ProgressData | null>(null);
  const [error, setError] = useState("");
  const [live, setLive] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/public/progress/${progressKey}`, {
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok) {
      setError(result.error ?? "Progress link not found.");
      return;
    }
    setData(result);
    setError("");
  }, [progressKey]);

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
        <p className="progress-updated">
          Last updated {new Date(data.updated_at).toLocaleString("en-IN")}
        </p>
      </section>
    </main>
  );
}
