import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });

const errText = (error: any) =>
  `${String(error?.message || "")} ${String(error?.details || "")} ${String(error?.hint || "")}`.toLowerCase();

const isMissingColumnError = (error: any, column: string) => {
  const msg = errText(error);
  return msg.includes(column.toLowerCase()) && (
    msg.includes("column") ||
    msg.includes("schema cache")
  );
};

const chunk = <T,>(arr: T[], size: number) => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
};

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

  const supabaseUser = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
  if (userErr || !userData?.user) {
    return json(401, { error: "Unauthorized" });
  }

  const uid = userData.user.id;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

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
        .select(col, { head: true })
        .limit(1);
      return error ?? null;
    };

    // Prefer sender_id first because this project schema uses sender_id in chat tables.
    const senderErr = await tryProbe("sender_id");
    if (!senderErr) return "sender_id";

    const userErr = await tryProbe("user_id");
    if (!userErr) return "user_id";

    throw new Error(
      `group_messages probe failed for sender_id and user_id: sender_id=${String(senderErr?.message || "")}; user_id=${String(userErr?.message || "")}`
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
    // Fast path: if FK cascades are configured correctly, deleting the auth user
    // handles profile + related row cleanup automatically.
    const directDelete = await admin.auth.admin.deleteUser(uid);
    if (!directDelete.error) {
      return json(200, { ok: true });
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

    return json(200, { ok: true });
  } catch (err: any) {
    return json(500, { error: err?.message || "Delete failed" });
  }
});
