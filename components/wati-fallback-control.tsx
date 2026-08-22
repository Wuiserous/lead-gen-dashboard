"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageCircle, RefreshCw, ShieldCheck, Zap } from "lucide-react";

type ReplyMode = "auto" | "wati" | "internal";

type Policy = {
  mode: ReplyMode;
  active: boolean;
  effectiveInternal: boolean;
  consecutiveMisses: number;
  activeUntil: string | null;
};

const modeCopy: Record<ReplyMode, { title: string; detail: string }> = {
  auto: {
    title: "Automatic protection",
    detail: "WATI replies first. Internal replies take over after three confirmed misses.",
  },
  wati: {
    title: "WATI only",
    detail: "Internal continuation is disabled until this mode is changed.",
  },
  internal: {
    title: "Internal only",
    detail: "The dashboard handles replies while WATI native automation is bypassed.",
  },
};

async function fetchPolicy() {
  const response = await fetch("/api/settings/wati-fallback", { cache: "no-store" });
  if (!response.ok) throw new Error("Unable to load reply status.");
  return response.json() as Promise<Policy>;
}

export function WatiFallbackControl() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setPolicy(await fetchPolicy());
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load reply status.");
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetchPolicy()
      .then((nextPolicy) => {
        if (active) setPolicy(nextPolicy);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load reply status.");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function setMode(mode: ReplyMode) {
    if (!policy || mode === policy.mode) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/settings/wati-fallback", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? "Unable to change reply mode.");
      }
      setPolicy(await response.json() as Policy);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to change reply mode.");
    } finally {
      setSaving(false);
    }
  }

  const status = policy?.effectiveInternal
    ? "Internal responder active"
    : "WATI responding first";

  return (
    <article className={`wati-fallback-control ${policy?.effectiveInternal ? "fallback-active" : ""}`}>
      <div className="wati-fallback-heading">
        <span className="wati-fallback-icon">
          {policy?.effectiveInternal ? <Zap size={20} /> : <ShieldCheck size={20} />}
        </span>
        <div>
          <span className="eyebrow">WHATSAPP REPLY ENGINE</span>
          <h3>{status}</h3>
          <p>
            {policy
              ? modeCopy[policy.mode].detail
              : "Checking which reply engine is currently serving students…"}
          </p>
        </div>
      </div>
      <div className="wati-fallback-actions">
        <div className="wati-mode-selector" role="group" aria-label="WhatsApp reply mode">
          {(["auto", "wati", "internal"] as ReplyMode[]).map((mode) => (
            <button
              type="button"
              key={mode}
              className={policy?.mode === mode ? "selected" : ""}
              disabled={!policy || saving}
              onClick={() => void setMode(mode)}
            >
              {mode === "auto" ? "Automatic" : mode === "wati" ? "WATI only" : "Internal only"}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Refresh WhatsApp reply status"
          disabled={saving}
          onClick={() => void load()}
        >
          <RefreshCw size={16} className={saving ? "spin" : ""} />
        </button>
      </div>
      {policy?.mode === "auto" && !policy.active && policy.consecutiveMisses > 0 && (
        <small className="wati-fallback-signal">
          <MessageCircle size={14} /> {policy.consecutiveMisses} of 3 native replies missed
        </small>
      )}
      {error && <small className="form-error">{error}</small>}
    </article>
  );
}
