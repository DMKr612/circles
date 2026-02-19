import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const resultEmail = Deno.env.get("QUIZ_RESULT_TO_EMAIL") || "result@meincircles.com";
const resendApiKey = Deno.env.get("RESEND_API_KEY") || "";
const emailFrom = Deno.env.get("QUIZ_RESULT_EMAIL_FROM") || "Circles <onboarding@resend.dev>";

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

type QuizAnswer = "A" | "B" | "C";
type QuizAnswersByQuestion = {
  Q1: QuizAnswer;
  Q2: QuizAnswer;
  Q3: QuizAnswer;
  Q4: QuizAnswer;
  Q5: QuizAnswer;
  Q6: QuizAnswer;
  Q7: QuizAnswer;
  Q8: QuizAnswer;
};

type QuizDimensionLabels = {
  stim: "Calm" | "Balanced" | "Lively";
  group_size: "Small groups" | "Medium groups" | "Large groups";
  endurance: "Short meetups" | "Medium length" | "Long meetups";
  structure: "Structured" | "Flexible" | "Spontaneous";
  connection: "Deep" | "Balanced" | "Light & playful";
};

type QuizComputation = {
  timestamp: string;
  raw_answers: QuizAnswersByQuestion;
  numeric_scores: Record<string, number>;
  dimensions: {
    stim: number;
    group_size: number;
    endurance: number;
    structure: number;
    connection: number;
  };
  labels: QuizDimensionLabels;
};

type ParticipantInfo = {
  accountName: string | null;
  email: string | null;
  age: number | null;
  city: string | null;
  bio: string | null;
};

function isAnswer(value: unknown): value is QuizAnswer {
  return value === "A" || value === "B" || value === "C";
}

function parseAnswers(input: unknown): QuizAnswersByQuestion | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;
  const keys = ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8"] as const;
  for (const key of keys) {
    if (!isAnswer(obj[key])) return null;
  }
  return {
    Q1: obj.Q1 as QuizAnswer,
    Q2: obj.Q2 as QuizAnswer,
    Q3: obj.Q3 as QuizAnswer,
    Q4: obj.Q4 as QuizAnswer,
    Q5: obj.Q5 as QuizAnswer,
    Q6: obj.Q6 as QuizAnswer,
    Q7: obj.Q7 as QuizAnswer,
    Q8: obj.Q8 as QuizAnswer,
  };
}

function scoreAnswer(answer: QuizAnswer): number {
  if (answer === "A") return 0;
  if (answer === "B") return 50;
  return 100;
}

function roundInt(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)));
}

function toBand(value: number): "low" | "medium" | "high" {
  if (value <= 33) return "low";
  if (value <= 66) return "medium";
  return "high";
}

function stimLabel(value: number): QuizDimensionLabels["stim"] {
  const band = toBand(value);
  if (band === "low") return "Calm";
  if (band === "medium") return "Balanced";
  return "Lively";
}

function groupLabel(value: number): QuizDimensionLabels["group_size"] {
  const band = toBand(value);
  if (band === "low") return "Small groups";
  if (band === "medium") return "Medium groups";
  return "Large groups";
}

function enduranceLabel(value: number): QuizDimensionLabels["endurance"] {
  const band = toBand(value);
  if (band === "low") return "Short meetups";
  if (band === "medium") return "Medium length";
  return "Long meetups";
}

function structureLabel(value: number): QuizDimensionLabels["structure"] {
  const band = toBand(value);
  if (band === "low") return "Structured";
  if (band === "medium") return "Flexible";
  return "Spontaneous";
}

function connectionLabel(value: number): QuizDimensionLabels["connection"] {
  const band = toBand(value);
  if (band === "low") return "Deep";
  if (band === "medium") return "Balanced";
  return "Light & playful";
}

function computeQuiz(answers: QuizAnswersByQuestion): QuizComputation {
  const numeric_scores = {
    Q1: scoreAnswer(answers.Q1),
    Q2: scoreAnswer(answers.Q2),
    Q3: scoreAnswer(answers.Q3),
    Q4: scoreAnswer(answers.Q4),
    Q5: scoreAnswer(answers.Q5),
    Q6: scoreAnswer(answers.Q6),
    Q7: scoreAnswer(answers.Q7),
    Q8: scoreAnswer(answers.Q8),
  };

  const dimensions = {
    stim: roundInt((numeric_scores.Q1 + numeric_scores.Q4) / 2),
    group_size: roundInt(numeric_scores.Q2),
    endurance: roundInt((numeric_scores.Q3 + numeric_scores.Q8) / 2),
    structure: roundInt(numeric_scores.Q5),
    connection: roundInt((numeric_scores.Q6 + numeric_scores.Q7) / 2),
  };

  const labels: QuizDimensionLabels = {
    stim: stimLabel(dimensions.stim),
    group_size: groupLabel(dimensions.group_size),
    endurance: enduranceLabel(dimensions.endurance),
    structure: structureLabel(dimensions.structure),
    connection: connectionLabel(dimensions.connection),
  };

  return {
    timestamp: new Date().toISOString(),
    raw_answers: answers,
    numeric_scores,
    dimensions,
    labels,
  };
}

function toText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v.length ? v : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function computeAgeFromIsoDate(isoLike: string): number | null {
  const date = new Date(isoLike);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - date.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - date.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < date.getUTCDate())) {
    age -= 1;
  }
  if (age < 0 || age > 120) return null;
  return age;
}

function inferAge(
  profileData: Record<string, unknown> | null,
  metadata: Record<string, unknown> | null,
): number | null {
  const directAgeKeys = ["age"] as const;
  for (const key of directAgeKeys) {
    const n = toNumber(profileData?.[key] ?? metadata?.[key]);
    if (n !== null) {
      const age = Math.round(n);
      if (age >= 0 && age <= 120) return age;
    }
  }

  const birthYearKeys = ["birth_year"] as const;
  for (const key of birthYearKeys) {
    const year = toNumber(profileData?.[key] ?? metadata?.[key]);
    if (year !== null) {
      const age = new Date().getUTCFullYear() - Math.round(year);
      if (age >= 0 && age <= 120) return age;
    }
  }

  const birthDateKeys = ["birthdate", "date_of_birth", "dob", "birthday"] as const;
  for (const key of birthDateKeys) {
    const dateText = toText(profileData?.[key] ?? metadata?.[key]);
    if (!dateText) continue;
    const age = computeAgeFromIsoDate(dateText);
    if (age !== null) return age;
  }

  return null;
}

function inferName(
  profileData: Record<string, unknown> | null,
  metadata: Record<string, unknown> | null,
  email: string | null,
): string | null {
  const keys = ["name", "full_name", "username"] as const;
  for (const key of keys) {
    const v = toText(profileData?.[key] ?? metadata?.[key]);
    if (v) return v;
  }
  if (email) {
    const atIndex = email.indexOf("@");
    if (atIndex > 0) return email.slice(0, atIndex);
  }
  return null;
}

function csvEscape(value: string | number | null): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, "\"\"")}"`;
  return s;
}

function buildCsvForExcel(userId: string, participant: ParticipantInfo, result: QuizComputation): string {
  const { raw_answers: raw, numeric_scores: num, dimensions: d, labels: l } = result;
  const headers = [
    "submitted_at",
    "user_id",
    "account_name",
    "email",
    "age",
    "city",
    "bio",
    "Q1",
    "Q2",
    "Q3",
    "Q4",
    "Q5",
    "Q6",
    "Q7",
    "Q8",
    "Q1_score",
    "Q2_score",
    "Q3_score",
    "Q4_score",
    "Q5_score",
    "Q6_score",
    "Q7_score",
    "Q8_score",
    "stim",
    "group_size",
    "endurance",
    "structure",
    "connection",
    "stim_label",
    "group_size_label",
    "endurance_label",
    "structure_label",
    "connection_label",
  ];
  const values = [
    result.timestamp,
    userId,
    participant.accountName,
    participant.email,
    participant.age,
    participant.city,
    participant.bio,
    raw.Q1,
    raw.Q2,
    raw.Q3,
    raw.Q4,
    raw.Q5,
    raw.Q6,
    raw.Q7,
    raw.Q8,
    num.Q1,
    num.Q2,
    num.Q3,
    num.Q4,
    num.Q5,
    num.Q6,
    num.Q7,
    num.Q8,
    d.stim,
    d.group_size,
    d.endurance,
    d.structure,
    d.connection,
    l.stim,
    l.group_size,
    l.endurance,
    l.structure,
    l.connection,
  ];
  return `${headers.join(",")}\n${values.map((v) => csvEscape(v as string | number | null)).join(",")}`;
}

function buildEmailBody(userId: string, participant: ParticipantInfo, result: QuizComputation): string {
  const d = result.dimensions;
  const l = result.labels;
  const raw = result.raw_answers;
  const num = result.numeric_scores;
  const csv = buildCsvForExcel(userId, participant, result);
  return [
    "Circles Quiz Submission",
    "",
    `User ID: ${userId}`,
    `Account Name: ${participant.accountName || "Unknown"}`,
    `Email: ${participant.email || "Unknown"}`,
    `Age: ${participant.age ?? "Unknown"}`,
    `City: ${participant.city || "Unknown"}`,
    `Bio: ${participant.bio || "Unknown"}`,
    `Time submitted: ${result.timestamp}`,
    "",
    "Answers (A/B/C):",
    `Q1: ${raw.Q1}`,
    `Q2: ${raw.Q2}`,
    `Q3: ${raw.Q3}`,
    `Q4: ${raw.Q4}`,
    `Q5: ${raw.Q5}`,
    `Q6: ${raw.Q6}`,
    `Q7: ${raw.Q7}`,
    `Q8: ${raw.Q8}`,
    "",
    "Numeric Scores (0/50/100):",
    `Q1: ${num.Q1}`,
    `Q2: ${num.Q2}`,
    `Q3: ${num.Q3}`,
    `Q4: ${num.Q4}`,
    `Q5: ${num.Q5}`,
    `Q6: ${num.Q6}`,
    `Q7: ${num.Q7}`,
    `Q8: ${num.Q8}`,
    "",
    "Dimension Scores (0-100):",
    `stim: ${d.stim}`,
    `group_size: ${d.group_size}`,
    `endurance: ${d.endurance}`,
    `structure: ${d.structure}`,
    `connection: ${d.connection}`,
    "",
    "Social Rhythm Result",
    `- Group Size: ${l.group_size}`,
    `- Energy: ${l.stim}`,
    `- Meetup Length: ${l.endurance}`,
    `- Planning: ${l.structure}`,
    `- Conversation: ${l.connection}`,
    "",
    "CSV (copy into Excel):",
    csv,
  ].join("\n");
}

function parseParticipantOverride(input: unknown): Partial<ParticipantInfo> {
  if (!input || typeof input !== "object") return {};
  const obj = input as Record<string, unknown>;
  const accountName = toText(obj.name);
  const email = toText(obj.email);
  const city = toText(obj.city);
  const bio = toText(obj.bio);
  let age: number | null = null;
  const ageNum = toNumber(obj.age);
  if (ageNum !== null) {
    const a = Math.round(ageNum);
    if (a >= 13 && a <= 120) age = a;
  }
  return { accountName, email, age, city, bio };
}

async function sendResultEmail(subject: string, bodyText: string) {
  if (!resendApiKey) {
    throw new Error("Missing RESEND_API_KEY");
  }
  if (!resendApiKey.startsWith("re_")) {
    throw new Error("Invalid RESEND_API_KEY format (expected key starting with re_)");
  }
  if (emailFrom.includes("your-verified-domain.com") || emailFrom.includes("onboarding@resend.dev")) {
    throw new Error("QUIZ_RESULT_EMAIL_FROM is not configured with your verified sender domain");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: emailFrom,
      to: [resultEmail],
      subject,
      text: bodyText,
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Resend request failed (${response.status}): ${details.slice(0, 400)}`);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json(401, { error: "Missing authorization" });

  const supabaseUser = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
  if (userErr || !userData?.user) {
    return json(401, { error: "Unauthorized" });
  }

  let requestBody: Record<string, unknown> = {};
  try {
    requestBody = (await req.json()) as Record<string, unknown>;
  } catch {}

  const answers = parseAnswers(requestBody.answers);
  if (!answers) {
    return json(400, { error: "Missing or invalid answers (Q1..Q8 as A|B|C)" });
  }
  const participantOverride = parseParticipantOverride(requestBody.participant);

  const userId = userData.user.id;
  const userEmail = toText(userData.user.email);
  const metadata =
    userData.user.user_metadata && typeof userData.user.user_metadata === "object"
      ? (userData.user.user_metadata as Record<string, unknown>)
      : null;
  const result = computeQuiz(answers);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  let profileData: Record<string, unknown> | null = null;
  try {
    const { data, error: profileErr } = await admin
      .from("profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (profileErr) {
      console.error("[submit-quiz-result] profile lookup failed", profileErr.message);
    } else if (data && typeof data === "object") {
      profileData = data as Record<string, unknown>;
    }
  } catch (e) {
    console.error("[submit-quiz-result] profile lookup exception", e);
  }

  const participant: ParticipantInfo = {
    accountName: participantOverride.accountName || inferName(profileData, metadata, userEmail),
    email: participantOverride.email || userEmail,
    age: participantOverride.age ?? inferAge(profileData, metadata),
    city: participantOverride.city || toText(profileData?.city ?? metadata?.city) || null,
    bio: participantOverride.bio || toText(profileData?.bio ?? metadata?.bio) || null,
  };

  const insertPayload: Record<string, unknown> = {
    user_id: userId,
    submitted_at: result.timestamp,
    quiz_completed_at: result.timestamp,
    raw_answers: result.raw_answers,
    numeric_scores: result.numeric_scores,
    stim: result.dimensions.stim,
    group_size: result.dimensions.group_size,
    endurance: result.dimensions.endurance,
    structure: result.dimensions.structure,
    connection: result.dimensions.connection,
    stim_label: result.labels.stim,
    group_size_label: result.labels.group_size,
    endurance_label: result.labels.endurance,
    structure_label: result.labels.structure,
    connection_label: result.labels.connection,
    email_status: "pending",
  };

  let resultId: string | null = null;
  let saveError: string | null = null;
  try {
    const { data: inserted, error: insertErr } = await admin
      .from("quiz_results")
      .insert(insertPayload)
      .select("id")
      .maybeSingle();
    if (insertErr) {
      saveError = insertErr.message;
      console.error("[submit-quiz-result] save failed", insertErr.message);
    } else {
      resultId = (inserted?.id as string | undefined) || null;
    }
  } catch (e: any) {
    saveError = e?.message || "Unknown save exception";
    console.error("[submit-quiz-result] save exception", saveError);
  }

  const datePart = result.timestamp.slice(0, 10);
  const subject = `Circles Quiz Result - ${participant.accountName || participant.email || userId} - ${datePart}`;
  const bodyText = buildEmailBody(userId, participant, result);

  let emailSent = false;
  let emailError: string | null = null;

  try {
    await sendResultEmail(subject, bodyText);
    emailSent = true;
  } catch (e: any) {
    emailError = e?.message || "Unknown email error";
    console.error("[submit-quiz-result] email failed", emailError);
  }

  const nextStatus = emailSent ? "sent" : "email_send_failed";
  let updateError: string | null = null;
  if (resultId) {
    const updatePayload: Record<string, unknown> = {
      email_status: nextStatus,
      email_error: emailError,
    };
    if (emailSent) updatePayload.emailed_at = new Date().toISOString();

    const { error: updateErr } = await admin
      .from("quiz_results")
      .update(updatePayload)
      .eq("id", resultId);
    if (updateErr) {
      updateError = updateErr.message;
      console.error("[submit-quiz-result] status update failed", updateErr.message);
    }
  }

  return json(200, {
    ok: true,
    quiz_result_id: resultId,
    saved: Boolean(resultId) && !saveError,
    save_error: saveError,
    update_error: updateError,
    email_sent: emailSent,
    email_status: nextStatus,
    email_error: emailError,
    result,
  });
});
