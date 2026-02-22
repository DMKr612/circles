import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { checkGroupJoinBlock, joinBlockMessage } from "@/lib/ratings";

// Simple 8-char A–Z/0–9 code guard; relax if your format differs
const CODE_RE = /^[A-Z0-9]{6,12}$/i;

export default function JoinByCode() {
  const { code } = useParams<{ code: string }>();
  const nav = useNavigate();
  const [msg, setMsg] = useState("Joining…");

  // React Router basename is set via BrowserRouter; do not build absolute URLs
  const invitePath = useMemo(() => (code ? `/invite/${code}` : "/invite/invalid"), [code]);

  // Prevent double-run in dev or route remounts
  const ran = useRef(false);

  useEffect(() => {
    let off = false;
    if (ran.current) return; // idempotent
    ran.current = true;

    (async () => {
      // 1) Validate code early
      if (!code || !CODE_RE.test(code)) {
        if (!off) setMsg("Invalid or malformed link");
        return;
      }

      // 2) Ensure auth; preserve redirect in a robust way
      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user) {
        try { localStorage.setItem("postLoginRedirect", invitePath); } catch {}
        // Use SPA navigation; BrowserRouter basename will handle GitHub Pages subpath
        nav("/auth", { state: { from: invitePath }, replace: true });
        return;
      }

      // 3) Check low-rating/blocked conflicts before joining
      try {
        const { data: groupRow } = await supabase
          .from("groups")
          .select("id")
          .ilike("code", code)
          .maybeSingle();
        if (groupRow?.id) {
          const blockReason = await checkGroupJoinBlock(auth.user.id, groupRow.id);
          if (blockReason) {
            const message = joinBlockMessage(blockReason);
            if (!off) setMsg(message);
            window.alert(message);
            return;
          }
        }
      } catch (e) {
        console.warn("[join] conflict check failed", e);
      }

      // 4) Call RPC to join; handle null and errors
      try {
        const { data: gid, error } = await supabase.rpc("join_via_code", { p_code: code });
        if (error) {
          if (!off) setMsg(readableError(error.message));
          return;
        }
        if (!gid) {
          if (!off) setMsg("Invite not found or expired");
          return;
        }
        // 5) Navigate to group
        nav(`/group/${gid}`, { replace: true });
      } catch (e: any) {
        if (!off) setMsg(readableError(e?.message || String(e)));
      }
    })();

    return () => { off = true; };
  }, [code, invitePath, nav]);

  return (
    <div className="mx-auto max-w-md p-6 text-sm text-neutral-700" aria-live="polite">
      {msg}
    </div>
  );
}

function readableError(raw: string): string {
  const s = (raw || "").toLowerCase();
  if (s.includes("permission") || s.includes("rls")) return "You don’t have permission to join this group.";
  if (s.includes("not found") || s.includes("no rows")) return "Invite not found.";
  if (s.includes("expired")) return "Invite expired.";
  if (s.includes("invalid input syntax for type uuid")) return "Invalid invite code.";
  return raw;
}
