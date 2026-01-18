import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";

export type ProfileData = {
  id: string;
  name: string;
  avatar_url: string | null;
  city: string | null;
  personality_traits: any | null;
  social_battery: number | null;
  reputation_score: number;
  rating_avg: number;
  rating_count: number;
  groups_created: number;
  groups_joined: number;
  onboarded: boolean;
};

export function useProfile(userId: string | null) {
  return useQuery({
    queryKey: ["profile", userId],
    enabled: !!userId,
    queryFn: async (): Promise<ProfileData> => {
      if (!userId) throw new Error("No user ID");

      // Fetch profile; if missing, create a default row so the app doesn't get stuck on "Loading"
      const prof = await supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle();
      if (prof.error && prof.error.code !== "PGRST116") {
        // Any error other than "no rows" should bubble up
        throw prof.error;
      }

      let pData = prof.data;
      if (!pData) {
        const inserted = await supabase
          .from("profiles")
          .insert({ user_id: userId, name: "", onboarded: false })
          .select("*")
          .single();
        if (inserted.error) throw inserted.error;
        pData = inserted.data;
      }

      const [created, joined] = await Promise.all([
        supabase
          .from("group_members")
          .select("group_id", { count: "exact", head: true })
          .eq("user_id", userId)
          .in("role", ["owner", "host"])
          .in("status", ["active", "accepted"]),
        supabase
          .from("group_members")
          .select("group_id", { count: "exact", head: true })
          .eq("user_id", userId)
          .in("status", ["active", "accepted"]),
      ]);

      return {
        id: userId,
        name: pData.name || "",
        avatar_url: pData.avatar_url,
        city: pData.city,
        personality_traits: pData.personality_traits ?? null,
        social_battery: typeof pData.social_battery === "number" ? pData.social_battery : null,
        reputation_score: pData.reputation_score || 0,
        rating_avg: pData.rating_avg || 0,
        rating_count: pData.rating_count || 0,
        groups_created: created.count || 0,
        groups_joined: joined.count || 0,
        onboarded: Boolean(pData.onboarded),
      };
    },
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ userId, updates }: { userId: string; updates: any }) => {
      const { error } = await supabase.from("profiles").update(updates).eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["profile", variables.userId] });
    },
  });
}

export default useProfile;
