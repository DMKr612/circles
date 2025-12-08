// src/types/index.ts

// --- Database Entities (Mirrors your Supabase Schema) ---

export type Profile = {
  user_id: string;
  id?: string; // sometimes you use id, sometimes user_id. Good to have both for now.
  name: string | null;
  avatar_url: string | null;
  city?: string | null;
  rating_avg?: number;
  rating_count?: number;
  verification_level?: number | null;
};

export type Group = {
  id: string;
  host_id: string;
  creator_id?: string | null;
  title: string;
  description?: string | null; // Unified 'purpose' and 'description' here
  purpose?: string | null;     // keeping both for compatibility with your current code
  category: string | null;
  game: string | null;
  game_slug?: string | null;
  city: string | null;
  location?: string | null;
  capacity: number;
  visibility: string | null;
  requires_verification_level?: number | null;
  is_online: boolean;
  online_link: string | null;
  created_at: string;
  code?: string | null;
};

export type GroupMember = {
  user_id: string;
  group_id: string;
  role: string | null; // 'host', 'member'
  status: string;      // 'active', 'pending'
  last_joined_at?: string | null;
  created_at: string;
  // Joined fields (optional because they aren't always fetched)
  profiles?: {
    name: string | null;
    avatar_url?: string | null;
  } | null;
  name?: string | null; // Helper for flattened data
};

export type Message = {
  id: string;
  group_id: string;
  user_id: string;
  content: string;
  created_at: string;
  parent_id: string | null;
  attachments: any[]; // You can refine this later if you have a specific attachment type
  profiles?: { name: string | null } | null;
};

// --- Feature Specific Types ---

export type Poll = {
  id: string;
  group_id: string;
  title: string;
  status: string;
  closes_at: string | null;
  created_by: string;
  late_voter_ids?: string[] | null;
};

export type PollOption = {
  id: string;
  poll_id: string;
  label: string;
  starts_at: string | null;
  place: string | null;
};

export type Thread = {
  other_id: string;
  name: string;
  avatar_url: string | null;
  last_body: string;
  last_at: string;
  last_from_me: boolean;
  unread: boolean;
};

export type DMMessage = {
  id: string;
  sender: string;
  receiver: string;
  content: string;
  created_at: string;
};

export type Game = {
  id: string;
  name: string;
  blurb: string;
  tag: string;
  online: number;
  groups: number;
  image: string;
};

export type GroupRow = {
  id: string;
  title: string;
  description?: string | null;
  city: string | null;
  category: string | null;
  capacity: number;
  created_at: string;
  game: string | null;
  code?: string | null;
};

export type BrowseGroupRow = {
  id: string;
  title: string;
  description?: string | null;
  city: string | null;
  category: string | null;
  capacity: number;
  created_at: string;
  game: string | null;
  code?: string | null;
};

export type MyGroupRow = {
  id: string;
  host_id: string;
  title: string;
  description?: string | null;
  city: string | null;
  category: string | null;
  capacity: number;
  created_at: string;
  game: string | null;
  code?: string | null;
};

export type GroupEvent = {
  id: string;
  group_id: string;
  poll_id: string | null;
  option_id: string | null;
  title: string;
  starts_at: string | null;
  place: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type GroupMoment = {
  id: string;
  group_id: string;
  created_by: string;
  photo_url: string;
  caption?: string | null;
  verified: boolean;
  min_view_level: number | null;
  created_at: string;
  verified_at?: string | null;
};
