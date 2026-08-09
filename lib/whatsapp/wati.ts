import { watiEnv } from "@/lib/env";

export class WatiApiError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly retryable: boolean,
    public readonly responseBody = "",
  ) {
    super(message);
    this.name = "WatiApiError";
  }
}

type WatiResponse = Record<string, unknown>;

function phoneDigits(phone: string) {
  return phone.replace(/\D/g, "");
}

async function watiRequest(path: string, body: unknown, method = "POST") {
  const config = watiEnv();
  if (!config.endpoint || !config.token) {
    throw new WatiApiError("WATI is not configured.", null, false);
  }

  let response: Response;
  try {
    response = await fetch(`${config.endpoint}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
  } catch (error) {
    throw new WatiApiError(
      error instanceof Error ? error.message : "WATI request failed.",
      null,
      true,
    );
  }

  const text = await response.text();
  let parsed: WatiResponse = {};
  if (text) {
    try {
      parsed = JSON.parse(text) as WatiResponse;
    } catch {
      parsed = { raw: text };
    }
  }

  if (!response.ok) {
    const detail =
      typeof parsed.message === "string"
        ? parsed.message
        : typeof parsed.error === "string"
          ? parsed.error
          : `WATI returned HTTP ${response.status}.`;
    throw new WatiApiError(
      detail,
      response.status,
      response.status === 408 || response.status === 429 || response.status >= 500,
      text.slice(0, 2_000),
    );
  }

  return parsed;
}

function messageIds(response: WatiResponse) {
  const recipients = Array.isArray(response.recipients) ? response.recipients : [];
  const recipient = (recipients[0] ?? {}) as Record<string, unknown>;
  const message =
    response.message && typeof response.message === "object"
      ? (response.message as Record<string, unknown>)
      : {};

  return {
    localMessageId:
      String(
        recipient.local_messageId ??
          recipient.localMessageId ??
          response.localMessageId ??
          message.id ??
          "",
      ) || null,
    whatsappMessageId:
      String(recipient.whatsappMessageId ?? response.whatsappMessageId ?? "") || null,
    conversationId:
      String(message.conversation_id ?? response.conversationId ?? "") || null,
    ticketId: String(message.ticket_id ?? response.ticketId ?? "") || null,
  };
}

export async function sendWatiTemplate(input: {
  phone: string;
  templateName: string;
  broadcastName: string;
  parameters: Array<{ name: string; value: string }>;
}) {
  const config = watiEnv();
  const phone = phoneDigits(input.phone);
  const response = config.apiVersion === "v3"
    ? await watiRequest("/api/ext/v3/messageTemplates/send", {
        ...(config.channel ? { channel: config.channel } : {}),
        template_name: input.templateName,
        broadcast_name: input.broadcastName,
        recipients: [
          {
            phone_number: phone,
            custom_params: input.parameters,
          },
        ],
      })
    : await watiRequest(
        `/api/v1/sendTemplateMessage?whatsappNumber=${encodeURIComponent(phone)}`,
        {
          template_name: input.templateName,
          broadcast_name: input.broadcastName,
          parameters: input.parameters,
        },
      );
  return { response, ...messageIds(response) };
}

export async function sendWatiButtons(input: {
  target: string;
  header?: string;
  body: string;
  footer?: string;
  buttons: string[];
}) {
  const config = watiEnv();
  const target = phoneDigits(input.target);
  if (config.apiVersion === "v3") {
    const response = await watiRequest(
      "/api/ext/v3/conversations/messages/interactive",
      {
        target,
        type: "buttons",
        button_message: {
          ...(input.header
            ? { header: { type: "text", text: input.header } }
            : {}),
          body: input.body,
          footer: input.footer ?? "Persevex",
          buttons: input.buttons.slice(0, 3).map((text) => ({ text: text.slice(0, 20) })),
        },
      },
    );
    return { response, ...messageIds(response) };
  }

  const response = await watiRequest(
    `/api/v1/sendInteractiveButtonsMessage?whatsappNumber=${encodeURIComponent(target)}`,
    {
      ...(input.header
        ? { header: { type: "Text", text: input.header } }
        : {}),
      body: input.body,
      footer: input.footer ?? "Persevex",
      buttons: input.buttons
        .slice(0, 3)
        .map((text) => ({ text: text.slice(0, 20) })),
    },
  );
  return { response, ...messageIds(response) };
}

export async function sendWatiList(input: {
  target: string;
  header?: string;
  body: string;
  footer?: string;
  buttonText: string;
  sectionTitle: string;
  rows: Array<{ title: string; description?: string }>;
}) {
  const config = watiEnv();
  const target = phoneDigits(input.target);
  if (config.apiVersion === "v3") {
    const response = await watiRequest(
      "/api/ext/v3/conversations/messages/interactive",
      {
        target,
        type: "list",
        list_message: {
          header: input.header?.slice(0, 60),
          body: input.body.slice(0, 1024),
          footer: input.footer ?? "Persevex",
          button_text: input.buttonText,
          sections: [
            {
              title: input.sectionTitle.slice(0, 24),
              rows: input.rows.slice(0, 10).map((row) => ({
                title: row.title.slice(0, 24),
                description: row.description?.slice(0, 72),
              })),
            },
          ],
        },
      },
    );
    return { response, ...messageIds(response) };
  }

  const response = await watiRequest(
    `/api/v1/sendInteractiveListMessage?whatsappNumber=${encodeURIComponent(target)}`,
    {
      header: input.header?.slice(0, 60),
      body: input.body.slice(0, 1024),
      footer: input.footer ?? "Persevex",
      buttonText: input.buttonText,
      sections: [
        {
          title: input.sectionTitle.slice(0, 24),
          rows: input.rows.slice(0, 10).map((row) => ({
            title: row.title.slice(0, 24),
            description: row.description?.slice(0, 72),
          })),
        },
      ],
    },
  );
  return { response, ...messageIds(response) };
}

export async function sendWatiText(phone: string, messageText: string) {
  const config = watiEnv();
  const target = phoneDigits(phone);
  const response = config.apiVersion === "v3"
    ? await watiRequest("/api/ext/v3/conversations/messages/text", {
        target,
        text: messageText.slice(0, 4_000),
      })
    : await watiRequest(
        `/api/v1/sendSessionMessage/${encodeURIComponent(target)}?messageText=${encodeURIComponent(messageText.slice(0, 4_000))}`,
        undefined,
      );
  return { response, ...messageIds(response) };
}
