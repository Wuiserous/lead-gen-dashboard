import { isInternshipDomain } from "@/lib/domains";
import type { RegistrationStatus, WhatsAppStage } from "@/lib/types";

export const registrationStatuses: RegistrationStatus[] = [
  "new",
  "contacted",
  "interested",
  "follow_up",
  "converted",
  "not_interested",
  "invalid",
];

export const whatsappStages: WhatsAppStage[] = [
  "not_started",
  "queued",
  "sent",
  "delivered",
  "read",
  "engaged",
  "qualifying",
  "qualified",
  "advisor_requested",
  "follow_up",
  "enrollment_ready",
  "converted",
  "not_interested",
  "opted_out",
  "failed",
];

export function optionalRegistrationStatus(value: string | null) {
  return registrationStatuses.includes(value as RegistrationStatus)
    ? (value as RegistrationStatus)
    : null;
}

export function optionalWhatsAppStage(value: string | null) {
  return whatsappStages.includes(value as WhatsAppStage)
    ? (value as WhatsAppStage)
    : null;
}

export function optionalInternshipDomain(value: string | null) {
  return isInternshipDomain(value) ? value.trim() : null;
}
