import { Resend } from "resend";
import { resendEnv } from "@/lib/env";

export function createResend() {
  const config = resendEnv();
  if (!config.apiKey) throw new Error("RESEND_API_KEY is not configured.");
  return new Resend(config.apiKey);
}
