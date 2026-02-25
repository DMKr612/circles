import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { sendBrevoEmail } from "../_shared/brevo.ts";
import { verifyWaitlistToken, type WaitlistTokenPayload } from "../_shared/waitlist-token.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const brevoApiKey = Deno.env.get("BREVO_API_KEY") ?? "";
const brevoApiUrl = (Deno.env.get("BREVO_API_URL") ?? "").trim() || "https://api.brevo.com/v3/smtp/email";
const waitlistEmailFrom = Deno.env.get("WAITLIST_EMAIL_FROM") ?? "";
const waitlistAppUrl = (Deno.env.get("WAITLIST_APP_URL") ?? "").replace(/\/+$/, "");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });

const text = (status: number, content: string) =>
  new Response(content, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });

const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned.length ? cleaned : null;
}

function isReservedTestDomain(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase();
  return domain === "example.com" || domain === "example.net" || domain === "example.org";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function ensureConfig(): string[] {
  const missing: string[] = [];
  if (!supabaseUrl) missing.push("SUPABASE_URL");
  if (!serviceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!brevoApiKey) missing.push("BREVO_API_KEY");
  if (!waitlistEmailFrom) missing.push("WAITLIST_EMAIL_FROM");
  if (!waitlistAppUrl) missing.push("WAITLIST_APP_URL");
  return missing;
}

function activationLink(email: string, activationCode: string): string {
  const query = new URLSearchParams({
    waitlist: "approved",
    email,
    code: activationCode,
  });
  return `${waitlistAppUrl}/auth?${query.toString()}`;
}

function buildApprovalEmailText(payload: WaitlistTokenPayload, activationCode: string): string {
  const link = activationLink(payload.email, activationCode);
  return [
    "You're approved for Circles.",
    "",
    `Hi ${payload.full_name || "there"},`,
    "Your waitlist access is now active.",
    "You make Circles complete.",
    "Thank you for believing in what we are building.",
    "",
    "Activate your account using this secure link:",
    link,
    "",
    "On the next page your email is prefilled and locked.",
    "You will set your password twice to finish activation.",
    "",
    "If the button does not open, copy and paste the link in your browser.",
    "",
    "Welcome to Circles.",
  ].join("\n");
}

function buildApprovalEmailHtml(payload: WaitlistTokenPayload, activationCode: string): string {
  const link = activationLink(payload.email, activationCode);
  const safeName = payload.full_name
    ? escapeHtml(payload.full_name)
    : "there";
  const safeLink = escapeHtml(link);

  return [
    "<!doctype html>",
    "<html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'></head>",
    "<body style='margin:0;background:#f3f6ff;font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif;color:#0f172a;'>",
    "<table role='presentation' width='100%' cellspacing='0' cellpadding='0' style='padding:24px 12px;'>",
    "<tr><td align='center'>",
    "<table role='presentation' width='100%' cellspacing='0' cellpadding='0' style='max-width:640px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #dbe5ff;'>",
    "<tr><td style='padding:28px 28px 14px;background:linear-gradient(135deg,#0f172a,#1e3a8a);color:#fff;'>",
    "<div style='font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.85;'>Circles</div>",
    "<h1 style='margin:8px 0 0;font-size:28px;line-height:1.2;'>You're approved</h1>",
    "</td></tr>",
    "<tr><td style='padding:24px 28px;'>",
    `<p style='margin:0 0 12px;font-size:16px;'>Hi ${safeName},</p>`,
    "<p style='margin:0 0 14px;font-size:15px;line-height:1.6;color:#334155;'>Your waitlist access is now active. Use the button below to activate your account.</p>",
    "<p style='margin:0 0 14px;font-size:15px;line-height:1.6;color:#334155;'><strong>You make Circles complete.</strong> Thank you for believing in what we are building.</p>",
    `<p style='margin:20px 0;'><a href="${safeLink}" style='display:inline-block;padding:12px 18px;border-radius:10px;background:#111827;color:#fff;text-decoration:none;font-weight:700;'>Activate My Account</a></p>`,
    "<p style='margin:0 0 10px;font-size:13px;color:#475569;'>On the next page your email is prefilled and locked. You only need to set your password twice.</p>",
    `<p style='margin:14px 0 0;font-size:12px;color:#64748b;word-break:break-all;'>Direct link: ${safeLink}</p>`,
    "</td></tr>",
    "<tr><td style='padding:16px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;'>We are excited to have you with us. If you did not request this, you can ignore this email.</td></tr>",
    "</table>",
    "</td></tr>",
    "</table>",
    "</body></html>",
  ].join("");
}

function renderAdminText(opts: { title: string; message: string; email?: string | null }) {
  const lines = [opts.title, "", opts.message];
  if (opts.email) lines.push(`User approved with email: ${opts.email}`);
  lines.push(`Sender: ${waitlistEmailFrom}`);
  lines.push(`App: ${waitlistAppUrl}`);
  return lines.join("\n");
}

async function sendApprovalEmail(payload: WaitlistTokenPayload, activationCode: string) {
  await sendBrevoEmail(
    {
      apiKey: brevoApiKey,
      apiUrl: brevoApiUrl,
      fromAddress: waitlistEmailFrom,
      fromName: "Circles",
    },
    {
      toAddress: payload.email,
      toName: payload.full_name,
      subject: "You're approved for Circles",
      htmlBody: buildApprovalEmailHtml(payload, activationCode),
      textBody: buildApprovalEmailText(payload, activationCode),
    },
  );
}

async function markApproved(payload: WaitlistTokenPayload) {
  const now = new Date().toISOString();
  const { error } = await admin
    .from("waitlist_requests")
    .upsert(
      {
        email: payload.email.toLowerCase(),
        full_name: payload.full_name ?? null,
        status: "approved",
        approved_at: now,
        updated_at: now,
      },
      { onConflict: "email" },
    );
  if (error) throw new Error(`Waitlist approval save failed: ${error.message}`);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return json(405, { error: "Method not allowed" });

  const missing = ensureConfig();
  if (missing.length) {
    const message = `Missing function config: ${missing.join(", ")}`;
    if (req.method === "GET") return text(500, renderAdminText({ title: "Configuration Error", message }));
    return json(500, { error: message });
  }

  let token: string | null = null;
  let code: string | null = null;
  if (req.method === "GET") {
    const url = new URL(req.url);
    token = cleanText(url.searchParams.get("token"));
    code = cleanText(url.searchParams.get("code"));
  } else {
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {}
    token = cleanText(body.token);
    code = cleanText(body.code);
  }

  if (!token) {
    if (req.method === "GET") {
      return text(400, renderAdminText({ title: "Missing Approval Token", message: "No signed token was provided." }));
    }
    return json(400, { error: "Missing token" });
  }

  const payload = await verifyWaitlistToken(token, serviceKey);
  if (!payload) {
    if (req.method === "GET") {
      return text(401, renderAdminText({ title: "Invalid Token", message: "Approval token is invalid or malformed." }));
    }
    return json(401, { error: "Invalid approval token" });
  }

  if (Date.now() - payload.iat > 1000 * 60 * 60 * 24 * 30) {
    if (req.method === "GET") {
      return text(410, renderAdminText({ title: "Approval Link Expired", message: "Please request a fresh approval link." }));
    }
    return json(410, { error: "Approval link expired" });
  }

  if (code && code !== payload.approve_code) {
    if (req.method === "GET") {
      return text(400, renderAdminText({ title: "Code Mismatch", message: "The approval code does not match this request." }));
    }
    return json(400, { error: "Approval code mismatch" });
  }

  if (isReservedTestDomain(payload.email)) {
    if (req.method === "GET") {
      return text(400, renderAdminText({
        title: "Invalid Recipient Email",
        message: "This approval email uses a reserved test domain. Use a real user email address.",
        email: payload.email,
      }));
    }
    return json(400, { error: "Reserved test email domain is not allowed" });
  }

  const activationCode = crypto.randomUUID().replace(/-/g, "");

  try {
    await sendApprovalEmail(payload, activationCode);
    await markApproved(payload);

    if (req.method === "GET") {
      return text(
        200,
        renderAdminText({
          title: "Approval Complete",
          message: "User approved successfully and activation email sent.",
          email: payload.email,
        }),
      );
    }
    return json(200, {
      ok: true,
      status: "approved",
      email_sent_to: payload.email,
      activation_link: activationLink(payload.email, activationCode),
    });
  } catch (error: any) {
    if (req.method === "GET") {
      return text(502, renderAdminText({
        title: "Approval Saved, Email Failed",
        message: String(error?.message || "Unknown email error"),
        email: payload.email,
      }));
    }
    return json(502, {
      error: "User was approved but approval email failed",
      details: String(error?.message || "Unknown Brevo error"),
    });
  }
});
