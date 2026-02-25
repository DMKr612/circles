import { useEffect, useMemo, useState } from "react";
import { Shield, Battery, Loader2, AlertTriangle, Trash2 } from "lucide-react";
import { useAuth } from "@/App";
import { supabase } from "@/lib/supabase";

type HeatRow = { city: string | null; avg_battery: number | null; member_count: number };

const ADMIN_ID = import.meta.env.VITE_ADMIN_USER_ID || "";

export default function AdminDashboard() {
  const { user } = useAuth();
  const [rows, setRows] = useState<HeatRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [deleteUserId, setDeleteUserId] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);

  const authorized = user?.id && ADMIN_ID && user.id === ADMIN_ID;

  function isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  async function handleDeleteUser() {
    const uid = deleteUserId.trim();
    setDeleteErr(null);
    setDeleteNotice(null);

    if (!uid || !isUuid(uid)) {
      setDeleteErr("Enter a valid user UUID.");
      return;
    }

    const confirmed = window.confirm(
      `Delete user ${uid}? This permanently removes their account, groups, messages, and uploads.`,
    );
    if (!confirmed) return;

    try {
      setDeleteBusy(true);
      const { error } = await supabase.functions.invoke("admin-delete-user", {
        body: { user_id: uid, confirm: true },
      });
      if (error) throw error;

      setDeleteNotice(`Deleted user ${uid}.`);
      setDeleteUserId("");
    } catch (e: any) {
      setDeleteErr(e?.message || "Failed to delete user");
    } finally {
      setDeleteBusy(false);
    }
  }

  useEffect(() => {
    if (!authorized) return;
    let active = true;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const { data, error } = await supabase.rpc("social_battery_heatmap");
        if (error) throw error;
        if (active) {
          setRows((data as HeatRow[]) || []);
        }
      } catch (e: any) {
        if (active) {
          setErr(e?.message || "Failed to load heatmap");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [authorized]);

  const sorted = useMemo(
    () => [...rows].sort((a, b) => (b.avg_battery || 0) - (a.avg_battery || 0)),
    [rows]
  );

  if (!authorized) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          <div>
            <div className="text-sm font-semibold">Admin only</div>
            <p className="text-xs text-amber-700">
              This dashboard is restricted. Set VITE_ADMIN_USER_ID to your Supabase user id to enable access.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-lg font-bold text-neutral-900">
            <Shield className="h-5 w-5 text-indigo-600" />
            Admin Dashboard
          </div>
          <p className="text-sm text-neutral-600">Private view of Social Battery across cities.</p>
        </div>
        {loading && <Loader2 className="h-5 w-5 animate-spin text-neutral-500" />}
      </div>

      {err && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      <section className="rounded-2xl border border-red-200 bg-red-50/70 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-red-900">
          <Trash2 className="h-4 w-4" />
          Delete User Permanently
        </div>
        <p className="mt-1 text-xs text-red-800">
          This deletes the auth account plus profile, groups, messages, and uploaded files.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={deleteUserId}
            onChange={(e) => setDeleteUserId(e.target.value)}
            placeholder="Target user UUID"
            className="w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-red-300 focus:ring-2 focus:ring-red-200"
          />
          <button
            type="button"
            onClick={handleDeleteUser}
            disabled={deleteBusy}
            className="inline-flex items-center justify-center rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {deleteBusy ? "Deleting..." : "Delete user"}
          </button>
        </div>
        {deleteErr ? <div className="mt-2 text-xs text-red-700">{deleteErr}</div> : null}
        {deleteNotice ? <div className="mt-2 text-xs text-emerald-700">{deleteNotice}</div> : null}
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((row) => {
          const val = Math.round(row.avg_battery || 0);
          return (
            <div
              key={row.city || "unknown"}
              className="rounded-2xl border border-neutral-100 bg-white/90 p-4 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-neutral-900">{row.city || "Unknown"}</div>
                <div className="flex items-center gap-1 text-[12px] text-neutral-500">
                  <Battery className="h-4 w-4 text-emerald-600" /> {row.member_count} members
                </div>
              </div>
              <div className="mt-3 h-2 rounded-full bg-neutral-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-red-400 via-amber-400 to-emerald-500"
                  style={{ width: `${Math.min(100, Math.max(0, val))}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="font-bold text-neutral-900">{val}%</span>
                <span className="text-xs text-neutral-500">Avg battery</span>
              </div>
            </div>
          );
        })}
      </div>

      {!rows.length && !loading && (
        <div className="rounded-xl border border-neutral-200 bg-white px-4 py-6 text-sm text-neutral-600">
          No data yet. Encourage members to set their Social Battery.
        </div>
      )}
    </div>
  );
}
