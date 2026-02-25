import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const adminUserIdSecret = (Deno.env.get("ADMIN_USER_ID") || "").trim();

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

const errText = (error: any) =>
  `${String(error?.message || "")} ${String(error?.details || "")} ${String(error?.hint || "")}`.toLowerCase();

const formatError = (error: any) => {
  if (!error) return "unknown";
  const parts = [
    String(error?.message || "").trim(),
    String(error?.details || "").trim(),
    String(error?.hint || "").trim(),
  ].filter(Boolean);
  const code = String(error?.code || "").trim();
  const status = String(error?.status || "").trim();
  if (code) parts.push(`code=${code}`);
  if (status) parts.push(`status=${status}`);
  return parts.length ? parts.join(" | ") : "unknown";
};

const isMissingColumnError = (error: any, column: string) => {
  const msg = errText(error);
  return msg.includes(column.toLowerCase()) && (
    msg.includes("column") ||
    msg.includes("schema cache")
  );
};

const isPermissionDeniedError = (error: any) => {
  const msg = errText(error);
  return String(error?.code || "") === "42501" || msg.includes("permission denied");
};

const chunk = <T,>(arr: T[], size: number) => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
};

function toText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v.length ? v : null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseJwtClaims(authHeader: string | null): Record<string, unknown> | null {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const parts = token.split(".");
  if (parts.length < 2) return null;

  try {
    const payloadPart = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payloadPart.padEnd(Math.ceil(payloadPart.length / 4) * 4, "=");
    const payloadText = atob(padded);
    const parsed = JSON.parse(payloadText);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json(401, { error: "Missing authorization" });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {}

  if (!body?.confirm) {
    return json(400, { error: "Missing confirm" });
  }

  const targetUserId = toText(body.user_id);
  if (!targetUserId || !isUuid(targetUserId)) {
    return json(400, { error: "Missing or invalid user_id" });
  }

  const claims = parseJwtClaims(authHeader);
  const isServiceRoleToken = claims?.role === "service_role";

  let requesterId: string | null = null;
  let dbAdminId: string | null = null;

  if (!isServiceRoleToken) {
    const supabaseUser = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !userData?.user) {
      return json(401, { error: "Unauthorized" });
    }

    requesterId = userData.user.id;

    try {
      const { data: rpcData } = await supabaseUser.rpc("admin_user_id");
      if (typeof rpcData === "string" && rpcData.trim()) {
        dbAdminId = rpcData.trim();
      }
    } catch {
      // optional fallback only
    }

    if (!adminUserIdSecret && !dbAdminId) {
      return json(500, { error: "Admin user is not configured (set ADMIN_USER_ID secret or app.admin_user_id DB setting)." });
    }

    const isAdmin = requesterId === adminUserIdSecret || requesterId === dbAdminId;
    if (!isAdmin) {
      return json(403, { error: "Forbidden" });
    }
  }

  if (requesterId && targetUserId === requesterId) {
    return json(400, { error: "Refusing to delete the currently signed-in admin account" });
  }
  if ((adminUserIdSecret && targetUserId === adminUserIdSecret) || (dbAdminId && targetUserId === dbAdminId)) {
    return json(400, { error: "Refusing to delete configured admin account" });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: targetCheck, error: targetErr } = await admin.auth.admin.getUserById(targetUserId);
  if (targetErr) {
    const msg = String(targetErr?.message || "").toLowerCase();
    if (msg.includes("not found")) {
      return json(404, { error: "Target user not found" });
    }
    return json(500, { error: `Target lookup failed: ${targetErr.message}` });
  }
  if (!targetCheck?.user) {
    return json(404, { error: "Target user not found" });
  }

  const uid = targetUserId;
  const targetEmail = (targetCheck.user.email || "").trim().toLowerCase() || null;

  const cleanupWaitlistByEmail = async (): Promise<string | null> => {
    if (!targetEmail) return null;
    const { error } = await admin
      .from("waitlist_requests")
      .delete()
      .eq("email", targetEmail);
    if (!error) return null;
    return `waitlist cleanup failed for ${targetEmail}: ${error.message}`;
  };

  const deleteIn = async (table: string, column: string, ids: string[]) => {
    const unique = Array.from(new Set(ids.filter(Boolean)));
    if (!unique.length) return;
    for (const part of chunk(unique, 500)) {
      const { error } = await admin.from(table).delete().in(column, part);
      if (error) throw new Error(`${table} delete failed: ${error.message}`);
    }
  };

  const selectIds = async (table: string, idColumn: string, filterColumn: string, ids: string[]) => {
    const unique = Array.from(new Set(ids.filter(Boolean)));
    if (!unique.length) return [] as string[];
    const out: string[] = [];
    for (const part of chunk(unique, 500)) {
      const { data, error } = await admin.from(table).select(idColumn).in(filterColumn, part);
      if (error) throw new Error(`${table} select failed: ${error.message}`);
      (data || []).forEach((row: any) => {
        const val = row?.[idColumn];
        if (val) out.push(String(val));
      });
    }
    return out;
  };

  const removePrefix = async (bucket: string, prefix: string) => {
    if (!prefix) return;
    let offset = 0;
    const limit = 500;
    while (true) {
      const { data, error } = await admin.storage.from(bucket).list(prefix, { limit, offset });
      if (error) throw new Error(`${bucket} list failed: ${error.message}`);
      const items = data || [];
      if (!items.length) break;
      const paths = items.map((item) => `${prefix}/${item.name}`);
      const { error: removeErr } = await admin.storage.from(bucket).remove(paths);
      if (removeErr) throw new Error(`${bucket} remove failed: ${removeErr.message}`);
      if (items.length < limit) break;
      offset += limit;
    }
  };

  const removePaths = async (bucket: string, paths: string[]) => {
    const unique = Array.from(new Set(paths.filter(Boolean)));
    if (!unique.length) return;
    for (const part of chunk(unique, 200)) {
      const { error } = await admin.storage.from(bucket).remove(part);
      if (error) throw new Error(`${bucket} remove failed: ${error.message}`);
    }
  };

  const resolveGroupMessageAuthorColumn = async (): Promise<"user_id" | "sender_id"> => {
    const tryProbe = async (col: "user_id" | "sender_id") => {
      const { error } = await admin
        .from("group_messages")
        .select(col)
        .limit(1);
      return error ?? null;
    };

    const senderErr = await tryProbe("sender_id");
    if (!senderErr) return "sender_id";

    if (isPermissionDeniedError(senderErr)) {
      throw new Error(
        "Missing DB grant: role service_role cannot read public.group_messages. " +
        "Run SQL: grant select, delete on table public.group_messages to service_role;"
      );
    }

    const userErr = await tryProbe("user_id");
    if (!userErr) return "user_id";

    throw new Error(
      `group_messages probe failed for sender_id and user_id: sender_id=${formatError(senderErr)}; user_id=${formatError(userErr)}`
    );
  };

  const listUserAttachments = async (userId: string, authorColumn: "user_id" | "sender_id") => {
    const out: Array<{ bucket: string; path: string }> = [];
    let from = 0;
    const pageSize = 500;
    while (true) {
      const query = admin
        .from("group_messages")
        .select("attachments")
        .eq(authorColumn, userId)
        .order("created_at", { ascending: true })
        .range(from, from + pageSize - 1);
      const { data, error } = await query;
      if (error) {
        if (isMissingColumnError(error, "attachments")) return out;
        throw new Error(`group_messages attachments select failed: ${error.message}`);
      }
      const rows = data || [];
      rows.forEach((row: any) => {
        const attachments = Array.isArray(row?.attachments) ? row.attachments : [];
        attachments.forEach((att: any) => {
          if (att?.bucket && att?.path) {
            out.push({ bucket: String(att.bucket), path: String(att.path) });
          }
        });
      });
      if (rows.length < pageSize) break;
      from += pageSize;
    }
    return out;
  };

  try {
    const directDelete = await admin.auth.admin.deleteUser(uid);
    if (!directDelete.error) {
      const warning = await cleanupWaitlistByEmail();
      return json(200, warning ? { ok: true, deleted_user_id: uid, warning } : { ok: true, deleted_user_id: uid });
    }

    const directDeleteErrText = errText(directDelete.error);
    const canFallback =
      directDeleteErrText.includes("database") ||
      directDeleteErrText.includes("constraint") ||
      directDeleteErrText.includes("foreign key") ||
      directDeleteErrText.includes("violat");
    if (!canFallback) {
      throw new Error(`auth direct delete failed: ${formatError(directDelete.error)}`);
    }

    const groupMessageAuthorColumn = await resolveGroupMessageAuthorColumn();

    const { data: groupRows, error: groupErr } = await admin
      .from("groups")
      .select("id")
      .or(`host_id.eq.${uid},creator_id.eq.${uid}`);
    if (groupErr) throw new Error(`groups select failed: ${groupErr.message}`);
    const groupIds = (groupRows || [])
      .map((row: any) => row?.id)
      .filter(Boolean)
      .map((id: any) => String(id));
    const groupIdSet = new Set(groupIds);

    const groupMessageIds = await selectIds("group_messages", "id", "group_id", groupIds);
    const groupPollIds = await selectIds("group_polls", "id", "group_id", groupIds);

    if (groupMessageIds.length) {
      await deleteIn("group_message_reactions", "message_id", groupMessageIds);
      await deleteIn("group_message_reads", "message_id", groupMessageIds);
    }
    if (groupPollIds.length) {
      await deleteIn("group_votes", "poll_id", groupPollIds);
      await deleteIn("group_poll_options", "poll_id", groupPollIds);
    }

    if (groupIds.length) {
      await deleteIn("group_events", "group_id", groupIds);
      await deleteIn("group_moments", "group_id", groupIds);
      await deleteIn("group_invitations", "group_id", groupIds);
      await deleteIn("group_reads", "group_id", groupIds);
      await deleteIn("group_live_locations", "group_id", groupIds);
      await deleteIn("group_members", "group_id", groupIds);
      await deleteIn("group_messages", "group_id", groupIds);
      await deleteIn("group_polls", "group_id", groupIds);
      await deleteIn("announcements", "group_id", groupIds);
      await deleteIn("groups", "id", groupIds);
    }

    const userAttachments = await listUserAttachments(uid, groupMessageAuthorColumn);
    const byBucket = new Map<string, string[]>();
    userAttachments.forEach((att) => {
      if (!att.bucket || !att.path) return;
      if (att.bucket === "chat-uploads") {
        const groupPrefix = att.path.split("/")[0] || "";
        if (groupIdSet.has(groupPrefix)) return;
      }
      const list = byBucket.get(att.bucket) || [];
      list.push(att.path);
      byBucket.set(att.bucket, list);
    });
    for (const [bucket, paths] of byBucket.entries()) {
      await removePaths(bucket, paths);
    }

    const userMessageIds = await selectIds("group_messages", "id", groupMessageAuthorColumn, [uid]);
    if (userMessageIds.length) {
      await deleteIn("group_message_reactions", "message_id", userMessageIds);
      await deleteIn("group_message_reads", "message_id", userMessageIds);
    }

    const { error: dmErr } = await admin
      .from("direct_messages")
      .delete()
      .or(`sender.eq.${uid},receiver.eq.${uid}`);
    if (dmErr) throw new Error(`direct_messages delete failed: ${dmErr.message}`);

    const { error: friendshipsErr } = await admin
      .from("friendships")
      .delete()
      .or(`user_id_a.eq.${uid},user_id_b.eq.${uid}`);
    if (friendshipsErr) throw new Error(`friendships delete failed: ${friendshipsErr.message}`);

    const { error: ratingsErr } = await admin
      .from("rating_pairs")
      .delete()
      .or(`rater_id.eq.${uid},ratee_id.eq.${uid}`);
    if (ratingsErr) throw new Error(`rating_pairs delete failed: ${ratingsErr.message}`);

    const { error: reconnectErr } = await admin
      .from("reconnect_requests")
      .delete()
      .or(`requester_id.eq.${uid},target_id.eq.${uid}`);
    if (reconnectErr) throw new Error(`reconnect_requests delete failed: ${reconnectErr.message}`);

    const { error: reportsErr } = await admin
      .from("reports")
      .delete()
      .or(`reporter_id.eq.${uid},reported_id.eq.${uid}`);
    if (reportsErr) throw new Error(`reports delete failed: ${reportsErr.message}`);

    const { error: invitesErr } = await admin
      .from("group_invitations")
      .delete()
      .or(`inviter_id.eq.${uid},recipient_id.eq.${uid}`);
    if (invitesErr) throw new Error(`group_invitations delete failed: ${invitesErr.message}`);

    const { error: categoryReqErr } = await admin
      .from("category_requests")
      .delete()
      .eq("requested_by", uid);
    if (categoryReqErr) throw new Error(`category_requests delete failed: ${categoryReqErr.message}`);

    const { error: momentsErr } = await admin
      .from("group_moments")
      .delete()
      .eq("created_by", uid);
    if (momentsErr) throw new Error(`group_moments delete failed: ${momentsErr.message}`);

    const { error: notesErr } = await admin
      .from("notifications")
      .delete()
      .eq("user_id", uid);
    if (notesErr) throw new Error(`notifications delete failed: ${notesErr.message}`);

    const { error: reactsErr } = await admin
      .from("group_message_reactions")
      .delete()
      .eq("user_id", uid);
    if (reactsErr) throw new Error(`group_message_reactions delete failed: ${reactsErr.message}`);

    const { error: readsErr } = await admin
      .from("group_message_reads")
      .delete()
      .eq("user_id", uid);
    if (readsErr) throw new Error(`group_message_reads delete failed: ${readsErr.message}`);

    const { error: userMsgsErr } = await admin
      .from("group_messages")
      .delete()
      .eq(groupMessageAuthorColumn, uid);
    if (userMsgsErr) throw new Error(`group_messages delete failed: ${userMsgsErr.message}`);

    const { error: votesErr } = await admin
      .from("group_votes")
      .delete()
      .eq("user_id", uid);
    if (votesErr) throw new Error(`group_votes delete failed: ${votesErr.message}`);

    const { error: readsGroupErr } = await admin
      .from("group_reads")
      .delete()
      .eq("user_id", uid);
    if (readsGroupErr) throw new Error(`group_reads delete failed: ${readsGroupErr.message}`);

    const { error: liveErr } = await admin
      .from("group_live_locations")
      .delete()
      .eq("user_id", uid);
    if (liveErr) throw new Error(`group_live_locations delete failed: ${liveErr.message}`);

    const { error: membersErr } = await admin
      .from("group_members")
      .delete()
      .eq("user_id", uid);
    if (membersErr) throw new Error(`group_members delete failed: ${membersErr.message}`);

    const { error: profilesErr } = await admin
      .from("profiles")
      .delete()
      .or(`user_id.eq.${uid},id.eq.${uid}`);
    if (profilesErr) throw new Error(`profiles delete failed: ${profilesErr.message}`);

    await removePrefix("avatars", uid);
    for (const gid of groupIds) {
      await removePrefix("chat-uploads", gid);
    }

    const { error: authErr } = await admin.auth.admin.deleteUser(uid);
    if (authErr) throw new Error(`auth delete failed: ${authErr.message}`);

    const warning = await cleanupWaitlistByEmail();
    return json(200, warning ? { ok: true, deleted_user_id: uid, warning } : { ok: true, deleted_user_id: uid });
  } catch (err: any) {
    return json(500, { error: err?.message || "Delete failed" });
  }
});
