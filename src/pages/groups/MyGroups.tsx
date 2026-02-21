import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { ArrowLeft, MapPin, Users, Clock, Plus } from 'lucide-react';

type GroupRow = {
  id: string;
  title: string | null;
  description?: string | null;
  city?: string | null;
  capacity?: number | null;
  category?: string | null;
  game?: string | null;
  created_at?: string | null;
  is_online?: boolean;
};

function fmtDate(d?: string | null) {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString(); } catch { return ''; }
}

const MY_GROUP_FIELDS = [
  "id",
  "title",
  "description",
  "city",
  "capacity",
  "category",
  "game",
  "created_at",
  "is_online",
].join(",");

export default function MyGroups() {
  const [rows, setRows] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id;
        if (!uid) {
          setRows([]);
          return;
        }
        
        // 1) get group ids where I am a member
        const { data: mem, error: mErr } = await supabase
          .from('group_members')
          .select('group_id')
          .eq('user_id', uid);
          
        if (mErr) throw mErr;
        
        const ids = (mem ?? []).map((r: any) => r.group_id).filter(Boolean);
        
        if (ids.length === 0) {
          setRows([]);
          return;
        }
        
        // 2) load the groups
        const { data: gs, error: gErr } = await supabase
          .from('groups')
          .select(MY_GROUP_FIELDS)
          .in('id', ids)
          .order('created_at', { ascending: false });
          
        if (gErr) throw gErr;
        
        if (!active) return;
        setRows((gs as GroupRow[]) ?? []);
      } catch (e: any) {
        if (!active) return;
        setErr(e?.message ?? 'Failed to load your groups');
        setRows([]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 pb-32">
      
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
             <div className="flex items-center gap-3">
                <Link to="/browse" className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 hover:bg-neutral-200 transition-colors">
                  <ArrowLeft className="h-5 w-5 text-neutral-700" />
                </Link>
                <h1 className="text-2xl font-extrabold tracking-tight text-neutral-900">My Groups</h1>
             </div>
             <Link to="/create" className="flex items-center gap-2 rounded-full bg-black px-4 py-2 text-xs font-bold text-white shadow-lg hover:bg-neutral-800 transition-all active:scale-95">
                <Plus className="h-4 w-4" />
                <span>New</span>
             </Link>
        </div>
        <p className="text-sm text-neutral-500 ml-13">Groups you’ve joined or created.</p>
      </div>

      {/* Loading State */}
      {loading && (
        <ul className="space-y-3">
          {[1, 2, 3].map((i) => (
            <li key={i} className="h-24 w-full animate-pulse rounded-2xl bg-white shadow-sm" />
          ))}
        </ul>
      )}

      {/* Error State */}
      {!!err && (
        <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-600 font-medium">
          {err}
        </div>
      )}

      {/* Empty State */}
      {!loading && !err && rows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-neutral-100 mb-4">
             <Users className="h-8 w-8 text-neutral-400" />
          </div>
          <h3 className="text-lg font-bold text-neutral-900">No groups yet</h3>
          <p className="text-sm text-neutral-500 max-w-xs mx-auto mt-1 mb-6">
            You haven't joined any circles yet. Find a game or create your own!
          </p>
          <Link to="/browse" className="rounded-full bg-black px-6 py-3 text-sm font-bold text-white shadow-lg hover:bg-neutral-800 transition-all active:scale-95">
            Browse Games
          </Link>
        </div>
      )}

      {/* Group List */}
      <ul className="space-y-3">
        {rows.map((g) => (
          <li key={g.id}>
            <Link 
              to={`/group/${g.id}`}
              className="group block relative overflow-hidden rounded-2xl border border-neutral-100 bg-white p-4 shadow-sm transition-all hover:shadow-md hover:border-neutral-200 active:scale-[0.99]"
            >
              <div className="flex justify-between items-start">
                  <div className="flex-1 min-w-0 pr-4">
                      <div className="flex items-center gap-2 mb-1">
                          <h2 className="truncate text-base font-bold text-neutral-900">
                              {g.title || "Untitled Group"}
                          </h2>
                          {g.is_online && (
                              <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700 border border-blue-100">
                                  ONLINE
                              </span>
                          )}
                      </div>
                      
                      <p className="line-clamp-1 text-sm text-neutral-600 mb-3">
                          {g.description || "No description"}
                      </p>

                      <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-500 font-medium">
                          {g.category && (
                            <span className="capitalize text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md font-bold">
                              {g.game || g.category}
                            </span>
                          )}
                          <span className="flex items-center gap-0.5">
                              <MapPin className="h-3 w-3" />
                              {g.city || "Online"}
                          </span>
                          <span className="flex items-center gap-0.5">
                              <Clock className="h-3 w-3" />
                              {fmtDate(g.created_at)}
                          </span>
                      </div>
                  </div>
                  
                  <div className="h-8 w-8 flex-shrink-0 rounded-full bg-neutral-50 flex items-center justify-center text-neutral-300 group-hover:bg-black group-hover:text-white transition-colors">
                      <ArrowLeft className="h-4 w-4 rotate-180" />
                  </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
