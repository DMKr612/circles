import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { sendZeptoMail } from "../_shared/zeptomail.ts";
import { createWaitlistToken } from "../_shared/waitlist-token.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const zeptoApiKey = Deno.env.get("ZEPTO_API_KEY") ?? "";
const zeptoApiUrl = Deno.env.get("ZEPTO_API_URL") ?? "";
const waitlistEmailFrom = Deno.env.get("WAITLIST_EMAIL_FROM") ?? "";
const waitlistNotifyTo = Deno.env.get("WAITLIST_NOTIFY_TO") ?? "";
const waitlistAppUrl = (Deno.env.get("WAITLIST_APP_URL") ?? "").replace(/\/+$/, "");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned.length ? cleaned : null;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function randomCode(length = 14): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const random = new Uint8Array(length);
  crypto.getRandomValues(random);
  let out = "";
  for (let i = 0; i < random.length; i += 1) {
    out += alphabet[random[i] % alphabet.length];
  }
  return out;
}

function ensureConfig(): string[] {
  const missing: string[] = [];
  if (!serviceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!zeptoApiKey) missing.push("ZEPTO_API_KEY");
  if (!zeptoApiUrl) missing.push("ZEPTO_API_URL");
  if (!waitlistEmailFrom) missing.push("WAITLIST_EMAIL_FROM");
  if (!waitlistNotifyTo) missing.push("WAITLIST_NOTIFY_TO");
  if (!waitlistAppUrl) missing.push("WAITLIST_APP_URL");
  return missing;
}

function buildApproveLink(token: string, code: string) {
  const params = new URLSearchParams({
    token,
    code,
  });
  return `${supabaseUrl}/functions/v1/waitlist-approve?${params.toString()}`;
}

function buildAdminEmailText(email: string, fullName: string | null, approveCode: string, approveLink: string): string {
  return [
    "New Circles waitlist request",
    "",
    `Name: ${fullName || "Not provided"}`,
    `Email: ${email}`,
    `Requested at: ${new Date().toISOString()}`,
    `Approve code: ${approveCode}`,
    `Approve link: ${approveLink}`,
    "",
    `Open app: ${waitlistAppUrl}`,
  ].join("\n");
}

function buildAdminEmailHtml(email: string, fullName: string | null, approveCode: string, approveLink: string): string {
  const safeName = fullName
    ? fullName.replace(/[<>&"]/g, "")
    : "Not provided";
  return [
    "<h2>New Circles waitlist request</h2>",
    `<p><strong>Name:</strong> ${safeName}</p>`,
    `<p><strong>Email:</strong> ${email}</p>`,
    `<p><strong>Requested at:</strong> ${new Date().toISOString()}</p>`,
    `<p><strong>Approve code:</strong> <code>${approveCode}</code></p>`,
    `<p><a href="${approveLink}">Approve this request</a></p>`,
    `<p><a href="${waitlistAppUrl}">Open Circles app</a></p>`,
  ].join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const missing = ensureConfig();
  if (missing.length) {
    return json(500, { error: `Missing function config: ${missing.join(", ")}` });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {}

  const emailInput = cleanText(body.email);
  const fullName = cleanText(body.name ?? body.full_name);
  const source = cleanText(body.source);

  if (!emailInput || !isValidEmail(emailInput)) {
    return json(400, { error: "Missing or invalid email" });
  }

  const email = emailInput.toLowerCase();
  const approveCode = randomCode(14);
  const token = await createWaitlistToken(
    {
      v: 1,
      email,
      full_name: fullName,
      approve_code: approveCode,
      iat: Date.now(),
    },
    serviceKey,
  );
  const approveLink = buildApproveLink(token, approveCode);
  const subject = `Circles waitlist request: ${fullName || email}`;

  try {
    await sendZeptoMail(
      {
        apiKey: zeptoApiKey,
        apiUrl: zeptoApiUrl,
        fromAddress: waitlistEmailFrom,
        fromName: "Circles",
      },
      {
        toAddress: waitlistNotifyTo,
        subject,
        htmlBody: buildAdminEmailHtml(email, fullName, approveCode, approveLink),
        textBody: buildAdminEmailText(email, fullName, approveCode, approveLink),
      },
    );

    return json(200, {
      ok: true,
      status: "pending",
      source: source || "unknown",
    });
  } catch (error: any) {
    return json(502, {
      error: "Failed to send admin notification email",
      details: String(error?.message || "Unknown ZeptoMail error"),
    });
  }
});
