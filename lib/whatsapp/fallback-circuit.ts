import { watiEnv } from "@/lib/env";
import { createAdminSupabase } from "@/lib/supabase/admin";

export type WatiReplyMode = "auto" | "wati" | "internal";

export type WatiFallbackPolicy = {
  mode: WatiReplyMode;
  active: boolean;
  effectiveInternal: boolean;
  consecutiveMisses: number;
  activeUntil: string | null;
  reason: string | null;
};

type StoredCircuit = {
  active?: boolean;
  consecutive_misses?: number;
  active_until?: string | null;
  reason?: string | null;
};

function replyMode(value: unknown): WatiReplyMode {
  return value === "wati" || value === "internal" ? value : "auto";
}

function storedCircuit(value: unknown): StoredCircuit {
  return value && typeof value === "object" ? value as StoredCircuit : {};
}

export function nextMonthlyReset(now = new Date()) {
  const istOffsetMs = 5.5 * 60 * 60 * 1_000;
  const inIndia = new Date(now.getTime() + istOffsetMs);
  const nextMonthInIndia = Date.UTC(
    inIndia.getUTCFullYear(),
    inIndia.getUTCMonth() + 1,
    1,
  );
  return new Date(nextMonthInIndia - istOffsetMs).toISOString();
}

export function fallbackDelayMs(policy: WatiFallbackPolicy) {
  const config = watiEnv();
  return (policy.effectiveInternal
    ? config.internalReplyDelaySeconds
    : config.fallbackObservationSeconds) * 1_000;
}

export async function readWatiFallbackPolicy(): Promise<WatiFallbackPolicy> {
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("app_settings")
    .select("key,value")
    .in("key", ["wati_reply_mode", "wati_fallback_circuit"]);
  if (error) throw new Error("Unable to read the WhatsApp fallback policy.");

  const settings = new Map(
    (data ?? []).map((row: { key: string; value: unknown }) => [row.key, row.value]),
  );
  const mode = replyMode(settings.get("wati_reply_mode"));
  const circuit = storedCircuit(settings.get("wati_fallback_circuit"));
  const activeUntil = typeof circuit.active_until === "string"
    ? circuit.active_until
    : null;
  const active = Boolean(
    circuit.active &&
    (!activeUntil || Date.parse(activeUntil) > Date.now()),
  );

  return {
    mode,
    active,
    effectiveInternal: mode === "internal" || (mode === "auto" && active),
    consecutiveMisses: Number.isInteger(circuit.consecutive_misses)
      ? Math.max(0, Number(circuit.consecutive_misses))
      : 0,
    activeUntil,
    reason: typeof circuit.reason === "string" ? circuit.reason : null,
  };
}

export async function recordWatiFallbackObservation(
  outcome: "hit" | "miss" | "reset",
): Promise<WatiFallbackPolicy> {
  const admin = createAdminSupabase();
  const { data, error } = await admin.rpc("update_wati_fallback_circuit", {
    p_outcome: outcome,
    p_threshold: watiEnv().fallbackMissThreshold,
    p_active_until: nextMonthlyReset(),
  });
  if (error || !data) {
    throw new Error("Unable to update the WhatsApp fallback circuit.");
  }
  const result = data as Record<string, unknown>;
  const mode = replyMode(result.mode);
  const active = Boolean(result.active);
  return {
    mode,
    active,
    effectiveInternal: Boolean(result.effective_internal),
    consecutiveMisses: Number(result.consecutive_misses ?? 0),
    activeUntil: typeof result.active_until === "string" ? result.active_until : null,
    reason: typeof result.reason === "string" ? result.reason : null,
  };
}
