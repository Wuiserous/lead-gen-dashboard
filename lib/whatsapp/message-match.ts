function comparableMessage(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-IN")
    .replace(/[^\p{L}\p{N}₹]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function outboundBodiesMatch(localBody: string, webhookBody: string) {
  const local = comparableMessage(localBody);
  const webhook = comparableMessage(webhookBody);
  if (!local || !webhook) return false;
  return local === webhook || webhook.includes(local) || local.includes(webhook);
}

type OutboundMirrorCandidate = {
  direction: string;
  intent: string | null;
  body: string;
  created_at: string;
};

export function collapseOutboundMirrors<T extends OutboundMirrorCandidate>(messages: T[]) {
  const collapsed: T[] = [];
  for (const message of messages) {
    const mirrorIndex = collapsed.findLastIndex((candidate) => {
      if (candidate.direction !== "outbound" || message.direction !== "outbound") return false;
      const intents = new Set([candidate.intent, message.intent]);
      if (!intents.has("internal_fallback") || !intents.has("wati_operator")) return false;
      const timeDifference = Math.abs(
        Date.parse(candidate.created_at) - Date.parse(message.created_at),
      );
      return timeDifference <= 15_000 && outboundBodiesMatch(candidate.body, message.body);
    });
    if (mirrorIndex < 0) {
      collapsed.push(message);
      continue;
    }

    // The WATI callback contains the rendered header and interactive choices,
    // plus the authoritative delivery state, so it is the useful row to show.
    if (message.intent === "wati_operator") collapsed[mirrorIndex] = message;
  }
  return collapsed;
}
