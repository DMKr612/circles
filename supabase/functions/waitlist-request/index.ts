import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { sendBrevoEmail } from "../_shared/brevo.ts";
import { createWaitlistToken } from "../_shared/waitlist-token.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const brevoApiKey = Deno.env.get("BREVO_API_KEY") ?? "";
const brevoApiUrl = (Deno.env.get("BREVO_API_URL") ?? "").trim() || "https://api.brevo.com/v3/smtp/email";
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

const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned.length ? cleaned : null;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isReservedTestDomain(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase();
  return domain === "example.com" || domain === "example.net" || domain === "example.org";
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
  if (!brevoApiKey) missing.push("BREVO_API_KEY");
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

async function authUserExists(email: string): Promise<boolean> {
  let page = 1;
  const perPage = 200;

  while (page <= 20) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`Auth user lookup failed: ${error.message}`);

    const users = data?.users || [];
    if (users.some((user) => (user.email || "").toLowerCase() === email)) {
      return true;
    }
    if (users.length < perPage) break;
    page += 1;
  }

  return false;
}

async function getWaitlistStatus(email: string): Promise<"pending" | "approved" | null> {
  const { data, error } = await admin
    .from("waitlist_requests")
    .select("status")
    .eq("email", email)
    .maybeSingle();

  if (error) throw new Error(`Waitlist lookup failed: ${error.message}`);
  if (data?.status === "pending" || data?.status === "approved") return data.status;
  return null;
}

async function saveWaitlistPending(email: string, fullName: string | null, source: string | null) {
  const now = new Date().toISOString();
  const { error } = await admin
    .from("waitlist_requests")
    .upsert(
      {
        email,
        full_name: fullName,
        source,
        status: "pending",
        approved_at: null,
        requested_at: now,
        updated_at: now,
      },
      { onConflict: "email" },
    );
  if (error) throw new Error(`Waitlist save failed: ${error.message}`);
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
  if (isReservedTestDomain(emailInput)) {
    return json(400, { error: "Please use a real email address." });
  }

  try {
    const email = emailInput.toLowerCase();
    const existingAccount = await authUserExists(email);
    if (existingAccount) {
      return json(200, {
        ok: true,
        status: "already_has_account",
        message: "You have been approved. Join and click Login with your password.",
      });
    }

    const waitlistStatus = await getWaitlistStatus(email);
    if (waitlistStatus === "pending") {
      return json(200, {
        ok: true,
        status: "already_waitlisted",
        message: "You are in waitlist.",
      });
    }
    const isReactivationRequest = waitlistStatus === "approved";

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
    const subject = isReactivationRequest
      ? `Circles reactivation request: ${fullName || email}`
      : `Circles waitlist request: ${fullName || email}`;

    await sendBrevoEmail(
      {
        apiKey: brevoApiKey,
        apiUrl: brevoApiUrl,
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

    await saveWaitlistPending(email, fullName, source);

    return json(200, {
      ok: true,
      status: "pending",
      source: source || "unknown",
    });
  } catch (error: any) {
    const message = String(error?.message || "");
    if (message.includes("Brevo request failed")) {
      return json(502, {
        error: "Failed to send admin notification email",
        details: message,
      });
    }
    return json(500, {
      error: "Waitlist request failed",
      details: message || "Unknown waitlist error",
    });
  }
});
