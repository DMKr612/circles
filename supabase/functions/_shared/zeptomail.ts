export type ZeptoMailConfig = {
  apiKey: string;
  apiUrl: string;
  fromAddress: string;
  fromName: string;
};

export type ZeptoMailPayload = {
  toAddress: string;
  toName?: string | null;
  subject: string;
  htmlBody: string;
  textBody: string;
};

function required(value: string, label: string) {
  if (!value.trim()) throw new Error(`Missing ${label}`);
}

export async function sendZeptoMail(config: ZeptoMailConfig, payload: ZeptoMailPayload) {
  required(config.apiKey, "ZEPTO_API_KEY");
  required(config.apiUrl, "ZEPTO_API_URL");
  required(config.fromAddress, "WAITLIST_EMAIL_FROM");

  const response = await fetch(config.apiUrl, {
    method: "POST",
    headers: {
      Authorization: config.apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      from: {
        address: config.fromAddress,
        name: config.fromName,
      },
      to: [
        {
          email_address: {
            address: payload.toAddress,
            name: payload.toName || undefined,
          },
        },
      ],
      subject: payload.subject,
      htmlbody: payload.htmlBody,
      textbody: payload.textBody,
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`ZeptoMail request failed (${response.status}): ${details.slice(0, 500)}`);
  }
}
