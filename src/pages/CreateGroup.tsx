import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useNavigate, Link } from "react-router-dom";
import { geocodePlace } from "@/lib/geocode";

// map for quick lookups when rendering selected chips
const EMPTY_ARR: string[] = [];

// City list state and loader will be defined in component below

function suggestCity(input: string, cityList: string[]): string | null {
  const q = input.trim().toLowerCase();
  if (!q) return null;
  const exact = cityList.find(n => n.toLowerCase() === q);
  if (exact) return exact;
  return cityList.find(n => n.toLowerCase().startsWith(q)) ?? null;
}

type Cat = { name: string };
type Opt = { id: string; label: string; category: string };
type Friend = { id: string; display_name: string | null; avatar_url: string | null };

export default function CreateGroupPage() {
  // German cities state and loader
  const [deCities, setDeCities] = useState<string[]>([]);
  const [citiesLoaded, setCitiesLoaded] = useState<boolean>(false);
  // Load German cities dynamically (only once)
  const loadCities = async () => {
    if (citiesLoaded || deCities.length > 0) return;
    // Dynamically import only when needed
    const { State, City } = await import('country-state-city');
    const states = (State.getStatesOfCountry('DE') || []) as Array<{ isoCode: string; name: string }>;
    const names: string[] = [];
    for (const s of states) {
      const cities = (City.getCitiesOfState('DE', s.isoCode) || []) as Array<{ name: string }>;
      for (const c of cities) {
        if (c && typeof c.name === 'string' && c.name.trim()) {
          names.push(c.name.trim());
        }
      }
    }
    const unique = Array.from(new Set(names)).sort((a, b) => a.localeCompare(b, 'de'));
    setDeCities(unique);
    setCitiesLoaded(true);
  };
  const navigate = useNavigate();
  const presetCategory = "Games";
  const presetGame = "";

  const [cats, setCats] = useState<Cat[]>([]);
  const [opts, setOpts] = useState<Opt[]>([]);
  const [listsLoading, setListsLoading] = useState<boolean>(true);
  const [me, setMe] = useState<string>("");
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendsLoading, setFriendsLoading] = useState<boolean>(true);
  const [inviteeIds, setInviteeIds] = useState<string[]>([]);

  const [inviteQuery, setInviteQuery] = useState("");
  const friendsById = useMemo(() => new Map(friends.map(f => [f.id, f])), [friends]);


  const friendIdSet = useMemo(() => new Set(friends.map(f => f.id)), [friends]);
  const filteredFriends = useMemo(() => {
  const q = inviteQuery.trim().toLowerCase();
  if (!q) return friends;
  return friends.filter(f =>
    (f.display_name || "").toLowerCase().includes(q) ||
    (f.id || "").toLowerCase().includes(q)
  );
}, [friends, inviteQuery]);


async function refreshFriendData(userId: string) {
  setFriendsLoading(true);
  try {
    // 1) accepted friend IDs in both directions
    const [a, b] = await Promise.all([
      supabase.from('friends').select('friend_id').eq('user_id', userId).eq('status', 'accepted'),
      supabase.from('friends').select('user_id').eq('friend_id', userId).eq('status', 'accepted'),
    ]);

    const ids: string[] = [];
    if (!a.error && Array.isArray(a.data)) ids.push(...a.data.map((r: any) => r.friend_id).filter(Boolean));
    if (!b.error && Array.isArray(b.data)) ids.push(...b.data.map((r: any) => r.user_id).filter(Boolean));
    const uniq = Array.from(new Set(ids));

    // 2) If no accepted friends, show suggestions so UI works without SQL seeding
    if (uniq.length === 0) {
      const sel = 'id, user_id, display_name, name, avatar_url';
      const p = await supabase
        .from('profiles')
        .select(sel)
        .neq('id', userId)
        .neq('user_id', userId)
        .limit(12);
      const list: Friend[] = (!p.error && Array.isArray(p.data) ? p.data : []).map((pr: any) => ({
        id: (pr.id || pr.user_id) as string,
        display_name: (pr.display_name || pr.name) ?? null,
        avatar_url: (pr.avatar_url ?? null) as string | null,
      }));
      setFriends(list);
      return;
    }

    // 3) otherwise fetch only those friend profiles (support PK = id OR user_id)
    const sel = 'id, user_id, display_name, name, avatar_url';
    let profs: any[] = [];
    const p1 = await supabase.from('profiles').select(sel).in('id', uniq);
    if (!p1.error && p1.data?.length) {
      profs = p1.data as any[];
    } else {
      const p2 = await supabase.from('profiles').select(sel).in('user_id', uniq);
      if (!p2.error && p2.data?.length) profs = p2.data as any[];
    }

    const list: Friend[] = (profs || [])
      .map(p => ({
        id: (p.id || p.user_id) as string,
        display_name: (p.display_name || p.name) ?? null,
        avatar_url: (p.avatar_url ?? null) as string | null,
      }))
      .filter(f => uniq.includes(f.id));

    setFriends(list);
  } finally {
    setFriendsLoading(false);
  }
}

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data, error } = await supabase.auth.getUser();
      if (!mounted) return;
      const id = !error ? data?.user?.id : undefined;
      if (id) {
        setMe(id);
        await refreshFriendData(id);
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setListsLoading(true);

      // allowed_categories: schema has `name`, not `id`
      const { data: c } = await supabase
        .from("allowed_categories")
        .select("name")
        .eq("is_active", true);

      // allowed_games: schema has `id, name, category`
      const { data: g } = await supabase
        .from("allowed_games")
        .select("id, name, category")
        .eq("is_active", true);

      if (!mounted) return;

      setCats((c ?? []).map((x: { name: string }) => ({ name: x.name })));

      setOpts((g ?? []).map((x: { id: string; name: string; category: string }) => ({
        id: x.id,                      // value stored in groups.game
        label: x.name || x.id,         // human-readable label for UI
        category: x.category,
      })));

      setListsLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Close category/game dropdowns when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      const catBox = document.getElementById("cat-combobox");
      const gameBox = document.getElementById("game-combobox");

      if (catBox && !catBox.contains(target)) {
        setCatOpen(false);
      }
      if (gameBox && !gameBox.contains(target)) {
        setGameOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);


  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [city, setCity] = useState("");
  const [cityTouched, setCityTouched] = useState(false);
  const cityCanonical = useMemo(() => suggestCity(city, deCities), [city, deCities]);
  const cityValid = !!cityCanonical;
  const [cityOpen, setCityOpen] = useState(false);
  const [cityIdx, setCityIdx] = useState<number>(-1);
  const filteredCities = useMemo(() => {
    const q = city.trim().toLowerCase();
    if (!q) return deCities.slice(0, 8);
    return deCities.filter(n => n.toLowerCase().includes(q)).slice(0, 8);
  }, [city, deCities]);
  const [capacity, setCapacity] = useState<number>(3);

  const [catOpen, setCatOpen] = useState(false);
  const [catQuery, setCatQuery] = useState("");
  const [category, setCategory] = useState<string>("");
  // set default once lists load
  useEffect(() => {
    if (!cats.length) return;
    const label = String(presetCategory || cats[0].name);
    const match = cats.find(c => c.name.toLowerCase() === label.toLowerCase());
    setCategory((match?.name || cats[0].name).toLowerCase());
  }, [cats, presetCategory]);

  const [gameOpen, setGameOpen] = useState(false);
  const [gameQuery, setGameQuery] = useState("");
  const [gameId, setGameId] = useState<string>("");
  useEffect(() => {
    if (!opts.length) return;
    if (!category) return;
    const preset = String(presetGame || "").toLowerCase().replace(/\s+/g, "");
    const found = opts.find(o => o.id === preset || o.label.toLowerCase().replace(/\s+/g, "") === preset);
    if (found) setGameId(found.id);
  }, [opts, presetGame, category]);

  const catOptions = useMemo(() => {
    const q = catQuery.trim().toLowerCase();
    const base = cats.map(c => c.name);
    return q ? base.filter((c) => c.toLowerCase().includes(q)) : base;
  }, [catQuery, cats]);

  const gameOptions = useMemo(() => {
    const list = opts.filter(o => o.category.toLowerCase() === (category || "").toLowerCase());
    const q = gameQuery.trim().toLowerCase();
    return q ? list.filter((o) => o.label.toLowerCase().includes(q) || o.id.includes(q)) : list;
  }, [category, gameQuery, opts]);

  const canSubmit = !listsLoading
    && title.trim().length > 0
    && category
    && gameId
    && capacity >= 3 && capacity <= 16
    && cityValid; // city required and must be in whitelist

  const [step, setStep] = useState<number>(1);
  const canNextFrom1 = title.trim().length > 0 && !!category && !!gameId;
  const canNextFrom2 = cityValid && capacity >= 3 && capacity <= 16;

  function goNext() {
    if (step === 1 && !canNextFrom1) return;
    if (step === 2 && !canNextFrom2) return;
    setStep((prev) => Math.min(3, prev + 1));
  }

  function goBack() {
    setStep((prev) => Math.max(1, prev - 1));
  }

  function toggleInvite(id: string) {
    setInviteeIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }



  async function sendInvites(groupId: string, inviterId: string) {
    if (!inviteeIds.length) return;

    // 0) Try server-side RPC (SECURITY DEFINER) that handles RLS and also creates notifications
    try {
      const { error: rpcErr } = await supabase.rpc('send_group_invites', {
        p_group_id: groupId,
        p_recipient_ids: inviteeIds,
      });
      if (!rpcErr) {
        console.debug('[CreateGroup] send_group_invites RPC ok', { groupId, inviteeCount: inviteeIds.length });
        return;
      }
      console.warn('[CreateGroup] send_group_invites RPC failed, will fallback', rpcErr?.message);
    } catch (e) {
      console.warn('[CreateGroup] send_group_invites RPC threw, will fallback', e);
    }

    // 1) Fallback: create pending invitations client-side (RLS should allow inviter to insert)
    try {
      const payload = inviteeIds.map((rid) => ({
        group_id: groupId,
        inviter_id: inviterId,
        recipient_id: rid,
        status: 'pending',
      }));
      const { error: invErr } = await supabase.from('group_invitations').insert(payload);
      if (invErr) console.warn('[CreateGroup] group_invitations insert failed', invErr.message);
    } catch {}

    // 2) Fallback notifications attempt (may be blocked by RLS). We enrich payload so the UI can render nicely.
    try {
      // Optionally fetch group title for nicer notification payload
      let groupTitle: string | null = null;
      try {
        const { data: g } = await supabase.from('groups').select('title').eq('id', groupId).maybeSingle();
        groupTitle = (g as any)?.title ?? null;
      } catch {}

      // Try to resolve inviter display name
      let inviterName: string | null = null;
      try {
        const { data: p } = await supabase
          .from('profiles')
          .select('display_name,name')
          .in('id', [inviterId])
          .maybeSingle();
        inviterName = (p as any)?.display_name || (p as any)?.name || null;
      } catch {}

      const notes = inviteeIds.map((rid) => ({
        user_id: rid, // NOTE: RLS likely blocks this unless done via RPC
        kind: 'group_invite',
        payload: {
          group_id: groupId,
          group_title: groupTitle,
          inviter_id: inviterId,
          inviter_name: inviterName,
        },
        is_read: false,
      }));

      const { error: noteErr } = await supabase.from('notifications').insert(notes);
      if (noteErr) console.warn('[CreateGroup] notifications insert likely blocked by RLS (expected). Use RPC send_group_invites.', noteErr.message);
    } catch {}
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    if (!cityValid) { setCityTouched(true); return; }
    const { data: u, error: uErr } = await supabase.auth.getUser();
    if (uErr || !u?.user?.id) {
      alert(uErr?.message || "Sign in required");
      return;
    }
    const uid = u.user.id;

    const cap = Math.max(3, Math.min(16, capacity));

    // insert only columns that certainly exist; let triggers/defaults handle the rest
    const cleanedCity = (cityCanonical ?? null);
    const geo = cleanedCity ? await geocodePlace(cleanedCity) : null;
    const row: Record<string, any> = {
      title: title.trim(),
      description: (description.trim().replace(/\s+$/, "") || null),
      category: (category || "").toLowerCase(),
      game: gameId,                          // allowed_games.id
      city: cleanedCity,                     // <-- persist city to DB
      lat: geo?.lat ?? null,
      lng: geo?.lng ?? null,
      capacity: cap,
      visibility: 'public',                  // baseline readable
      host_id: uid,                          // required for RLS/host policies
    };

    let createdRes = await supabase
      .from("groups")
      .insert([row])
      .select("id")
      .maybeSingle();

    // Backward compatibility before location columns migration is applied.
    if (createdRes.error?.code === "42703") {
      const { lat: _lat, lng: _lng, ...legacyRow } = row;
      createdRes = await supabase
        .from("groups")
        .insert([legacyRow])
        .select("id")
        .maybeSingle();
    }

    if (createdRes.error) {
      alert(String(createdRes.error.message ?? "Unknown error"));
      return;
    }

    const created = createdRes.data;

    if (!created?.id) {
      alert("Group created but ID missing. Try refreshing.");
      return;
    }

    // Optionally create pending invites + notifications; navigate immediately.
    sendInvites(created.id, uid);
    navigate(`/group/${created.id}`);
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="mx-auto w-full max-w-xl px-4 pb-10 pt-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Start a new Circle</h1>
            <p className="mt-1 text-sm text-neutral-600">
              A small, calm group for the right people. 3 quick steps.
            </p>
          </div>
          <Link
            to="/browse"
            className="shrink-0 rounded-full border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
          >
            Back
          </Link>
        </div>

        {/* Step indicator */}
        <div className="mb-6 flex items-center justify-between text-xs font-medium text-neutral-600">
          {[
            { id: 1, label: "Basics" },
            { id: 2, label: "Location" },
            { id: 3, label: "Details" },
          ].map((s) => {
            const active = step === s.id;
            const done = step > s.id;
            return (
              <div key={s.id} className="flex flex-1 items-center gap-2">
                <div
                  className={[
                    "flex h-7 w-7 items-center justify-center rounded-full border text-[11px]",
                    active
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : done
                      ? "border-emerald-400 bg-emerald-50 text-emerald-700"
                      : "border-neutral-300 bg-white text-neutral-500",
                  ].join(" ")}
                >
                  {s.id}
                </div>
                <span className={active ? "text-neutral-900" : "text-neutral-500"}>{s.label}</span>
              </div>
            );
          })}
        </div>

        {/* Steps */}
        <div className="space-y-4">
          {step === 1 && (
            <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-neutral-800">Basics</h2>
              {listsLoading && (
                <div className="mb-2 text-xs text-neutral-500">Loading categories…</div>
              )}
              <div className="space-y-4">
                {/* Title */}
                <div>
                  <label className="block text-xs font-medium text-neutral-700">Title</label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g., Friday Night Hokm"
                    className="mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30"
                  />
                </div>

                {/* Category combobox */}
                <div>
                  <label className="block text-xs font-medium text-neutral-700">Category</label>
                  <div id="cat-combobox" className="relative mt-1">
                    <input
                      value={catOpen ? catQuery : category || ""}
                      onChange={(e) => {
                        setCatOpen(true);
                        setCatQuery(e.target.value);
                      }}
                      onFocus={() => setCatOpen(true)}
                      placeholder="Search or choose category…"
                      className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30"
                      disabled={listsLoading}
                    />
                    {catOpen && (
                      <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border bg-white shadow-lg">
                        {catOptions.length === 0 && (
                          <div className="px-3 py-2 text-sm text-neutral-500">No matches</div>
                        )}
                        {catOptions.map((label: string) => (
                          <button
                            key={label}
                            type="button"
                            onClick={() => {
                              setCategory(label.toLowerCase());
                              setCatOpen(false);
                              setCatQuery("");
                              if (!opts.some((o) => o.category === label && o.id === gameId)) setGameId("");
                            }}
                            className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-50"
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Game/Activity combobox */}
                <div>
                  <label className="block text-xs font-medium text-neutral-700">Game / Activity</label>
                  <div id="game-combobox" className="relative mt-1">
                    <input
                      value={
                        gameOpen
                          ? gameQuery
                          :
                              opts.find(
                                (o) =>
                                  o.category.toLowerCase() === (category || "").toLowerCase() &&
                                  o.id === gameId,
                              )?.label || ""
                      }
                      onChange={(e) => {
                        setGameOpen(true);
                        setGameQuery(e.target.value);
                      }}
                      onFocus={() => setGameOpen(true)}
                      placeholder="Search or choose game/activity…"
                      className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30"
                      disabled={listsLoading || !(category && category.trim().length > 0)}
                    />
                    {gameOpen && (
                      <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border bg-white shadow-lg">
                        {gameOptions.length === 0 && (
                          <div className="px-3 py-2 text-sm text-neutral-500">No matches</div>
                        )}
                        {gameOptions.map((o: Opt) => (
                          <button
                            key={o.id}
                            type="button"
                            onClick={() => {
                              setGameId(o.id);
                              setGameOpen(false);
                              setGameQuery("");
                            }}
                            className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-50"
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}

          {step === 2 && (
            <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-neutral-800">Location & size</h2>
              <div className="space-y-4">
                {/* City (required) */}
                <div className="relative">
                  <label className="block text-xs font-medium text-neutral-700">
                    City <span className="text-red-600">*</span>
                  </label>
                  <input
                    value={city}
                    onChange={(e) => {
                      setCity(e.target.value);
                      setCityOpen(true);
                      setCityIdx(-1);
                    }}
                    onFocus={async () => {
                      await loadCities();
                      setCityOpen(true);
                    }}
                    onBlur={() => {
                      setTimeout(() => setCityOpen(false), 120);
                      setCityTouched(true);
                    }}
                    onKeyDown={(e) => {
                      if (!cityOpen) return;
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setCityIdx((i) => Math.min(filteredCities.length - 1, i + 1));
                      } else if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setCityIdx((i) => Math.max(-1, i - 1));
                      } else if (e.key === "Enter") {
                        if (cityIdx >= 0 && filteredCities[cityIdx]) {
                          e.preventDefault();
                          setCity(filteredCities[cityIdx]);
                          setCityOpen(false);
                        }
                      }
                    }}
                    placeholder="Start typing… e.g., Offenburg"
                    className={[
                      "mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30",
                      cityTouched && !cityValid ? "border-red-400 focus:border-red-500" : "",
                    ].join(" ")}
                    aria-autocomplete="list"
                    aria-expanded={cityOpen}
                    aria-controls="city-suggest"
                    role="combobox"
                  />
                  {cityOpen && filteredCities.length > 0 && (
                    <div
                      id="city-suggest"
                      className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-neutral-200 bg-white shadow-lg"
                      role="listbox"
                    >
                      {filteredCities.map((n, i) => (
                        <button
                          type="button"
                          key={n + i}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setCity(n);
                            setCityOpen(false);
                            setCityIdx(-1);
                          }}
                          className={[
                            "flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-emerald-50",
                            i === cityIdx ? "bg-emerald-50" : "",
                          ].join(" ")}
                          role="option"
                          aria-selected={i === cityIdx}
                        >
                          <span className="truncate">{n}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {!cityValid && cityTouched && (
                    <p className="mt-1 text-xs text-red-600">Choose a city from suggestions.</p>
                  )}
                  {cityValid && cityTouched && cityCanonical !== city && (
                    <p className="mt-1 text-xs text-neutral-500">Using “{cityCanonical}”.</p>
                  )}
                </div>


                {/* Capacity (> 1) */}
                <div>
                  <label className="block text-xs font-medium text-neutral-700">Capacity</label>
                  <div className="mt-1 flex items-center gap-3">
                    <input
                      type="number"
                      value={capacity === 0 ? "" : capacity}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === "") {
                          setCapacity(0);
                          return;
                        }
                        const num = Number(raw);
                        setCapacity(num);
                      }}
                      placeholder="3–16"
                      className="w-24 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30"
                    />
                  </div>

                  {(capacity < 3 || capacity > 16) && capacity !== 0 && (
                    <p className="text-xs text-red-600 mt-1">
                      Capacity must be between 3 and 16.
                    </p>
                  )}
                </div>

              </div>
          </section>
        )}

        {step === 3 && (
            <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-neutral-800">Details & preview</h2>
              <div className="space-y-4">
                {/* Description */}
                <div>
                  <label className="block text-xs font-medium text-neutral-700">Description</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Tell people what this circle is about…"
                    rows={4}
                    className="mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30"
                  />
                </div>

                {/* Summary card */}
                <div className="rounded-xl border border-dashed border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-700">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                    Preview
                  </div>
                  <div className="text-sm font-semibold text-neutral-900">{title || "Untitled Circle"}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-neutral-600">
                    {category && (
                      <span className="rounded-full bg-white px-2 py-0.5">{category}</span>
                    )}
                    {gameId && (
                      <span className="rounded-full bg-white px-2 py-0.5">
                        {opts.find((o) => o.id === gameId)?.label || gameId}
                      </span>
                    )}
                    {cityCanonical && (
                      <span className="rounded-full bg-white px-2 py-0.5 flex items-center gap-1">
                        <span>📍</span>
                        {cityCanonical}
                      </span>
                    )}
                    <span className="rounded-full bg-white px-2 py-0.5">
                      {capacity} spots
                    </span>
                  </div>
                  {description && (
                    <p className="mt-2 line-clamp-3 text-xs text-neutral-700">{description}</p>
                  )}
                </div>
              </div>
            </section>
          )}
        </div>

        {/* Bottom actions */}
        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={step === 1 ? () => navigate("/browse") : goBack}
            className="rounded-full border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
          >
            {step === 1 ? "Cancel" : "Back"}
          </button>

          <div className="flex gap-2">
            {step < 3 && (
              <button
                type="button"
                onClick={goNext}
                disabled={
                  (step === 1 && !canNextFrom1) ||
                  (step === 2 && !canNextFrom2) ||
                  listsLoading
                }
                className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
              >
                Next
              </button>
            )}

            {step === 3 && (
              <button
                type="button"
                disabled={!canSubmit}
                onClick={handleSubmit}
                className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
              >
                Create Circle
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
