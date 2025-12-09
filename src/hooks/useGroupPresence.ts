import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Geolocation } from '@capacitor/geolocation';

export function useGroupPresence(groupId: string | undefined, myUserId: string | undefined) {
  const [memberLocations, setMemberLocations] = useState<Record<string, { lat: number, long: number }>>({});

  // 1. UPLOAD MY LOCATION (Every ~30 seconds while visible)
  useEffect(() => {
    if (!groupId || !myUserId) return;
    let interval: ReturnType<typeof setInterval> | undefined;
    let membershipEnsured = false;

    const pushLocation = async () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      try {
        const perm = await Geolocation.checkPermissions();
        const granted = perm?.location === "granted" || perm?.coarseLocation === "granted";
        if (!granted) return;

        const coordinates = await Geolocation.getCurrentPosition({ enableHighAccuracy: false });
        const { latitude, longitude } = coordinates.coords;

        if (!membershipEnsured) {
          // Ensure membership exists so RLS on group_live_locations passes
          await supabase
            .from('group_members')
            .upsert(
              { group_id: groupId, user_id: myUserId, role: 'member', status: 'active' },
              { onConflict: 'group_id,user_id' }
            );
          membershipEnsured = true;
        }

        await supabase.from('group_live_locations').upsert({
          user_id: myUserId,
          group_id: groupId,
          lat: latitude,
          long: longitude,
          updated_at: new Date().toISOString(),
        });
      } catch (err) {
        // Silently fail if GPS is denied (don't annoy user)
      }
    };

    pushLocation(); // Run immediately
    interval = setInterval(pushLocation, 30000); // Then every 30s to reduce churn
    const onVisible = () => { if (typeof document !== "undefined" && document.visibilityState === "visible") pushLocation(); };
    if (typeof document !== "undefined") document.addEventListener('visibilitychange', onVisible);

    return () => {
      if (interval) clearInterval(interval);
      if (typeof document !== "undefined") document.removeEventListener('visibilitychange', onVisible);
    };
  }, [groupId, myUserId]);

  // 2. LISTEN TO OTHERS (Realtime)
  useEffect(() => {
    if (!groupId) return;

    // Load initial state
    supabase
      .from('group_live_locations')
      .select('user_id, lat, long')
      .eq('group_id', groupId)
      .then(({ data }) => {
        if (data) {
          const map: any = {};
          data.forEach((r: any) => { map[r.user_id] = { lat: r.lat, long: r.long }; });
          setMemberLocations(map);
        }
      });

    // Listen for updates
    const channel = supabase
      .channel(`presence:${groupId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'group_live_locations', filter: `group_id=eq.${groupId}` },
        (payload) => {
          const newData = payload.new as any;
          if (newData && newData.user_id) {
            setMemberLocations((prev) => ({
              ...prev,
              [newData.user_id]: { lat: newData.lat, long: newData.long }
            }));
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [groupId]);

  // 3. MATH HELPER: Are they close?
  function isTogether(otherUserId: string) {
    if (!myUserId || !memberLocations[myUserId] || !memberLocations[otherUserId]) return false;
    if (otherUserId === myUserId) return false; // Don't show dot for myself

    const myLoc = memberLocations[myUserId];
    const otherLoc = memberLocations[otherUserId];

    const dist = getDistanceFromLatLonInKm(myLoc.lat, myLoc.long, otherLoc.lat, otherLoc.long);
    // Return TRUE if closer than 50 meters (0.05 km)
    return dist < 0.05; 
  }

  return { isTogether };
}

// Haversine Formula (Calculates distance between GPS points)
function getDistanceFromLatLonInKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; 
  const dLat = deg2rad(lat2 - lat1);  
  const dLon = deg2rad(lon2 - lon1); 
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon/2) * Math.sin(dLon/2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  return R * c; 
}

function deg2rad(deg: number) {
  return deg * (Math.PI/180);
}
