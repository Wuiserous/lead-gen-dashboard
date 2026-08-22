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
