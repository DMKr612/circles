export type BrevoConfig = {
  apiKey: string;
  apiUrl: string;
  fromAddress: string;
  fromName: string;
};

export type BrevoPayload = {
  toAddress: string;
  toName?: string | null;
  subject: string;
  htmlBody: string;
  textBody: string;
};

function required(value: string, label: string) {
  if (!value.trim()) throw new Error(`Missing ${label}`);
}

export async function sendBrevoEmail(config: BrevoConfig, payload: BrevoPayload) {
  required(config.apiKey, "BREVO_API_KEY");
  required(config.apiUrl, "BREVO_API_URL");
  required(config.fromAddress, "WAITLIST_EMAIL_FROM");

  const response = await fetch(config.apiUrl, {
    method: "POST",
    headers: {
      "api-key": config.apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: {
        email: config.fromAddress,
        name: config.fromName,
      },
      to: [
        {
          email: payload.toAddress,
          name: payload.toName || undefined,
        },
      ],
      subject: payload.subject,
      htmlContent: payload.htmlBody,
      textContent: payload.textBody,
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Brevo request failed (${response.status}): ${details.slice(0, 500)}`);
  }
}
