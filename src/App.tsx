// src/App.tsx
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  Suspense,
  lazy,
  type PropsWithChildren,
} from "react";
import {
  Routes,
  Route,
  Navigate,
  useLocation,
  useParams,
} from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { HelpCircle } from "lucide-react"; // Modern icons
import Layout from "@/components/Layout";
import { useProfile } from "@/hooks/useProfile";
import LoadingScreen from "@/components/LoadingScreen";


// Pages (statically imported to avoid missing dynamic chunks on GH Pages)
const BrowsePage = lazy(() => import("./pages/Browse"));
const AnnouncementsPage = lazy(() => import("./pages/Announcements"));
const CreateGroup = lazy(() => import("./pages/CreateGroup"));
const GroupDetail = lazy(() => import("./pages/GroupDetail"));
const Groups = lazy(() => import("./pages/Groups"));
const Profile = lazy(() => import("./pages/Profile"));
const ProfileCreation = lazy(() => import("./pages/ProfileCreation"));
const GroupsByGame = lazy(() => import("./pages/groups/GroupsByGame"));
const MyGroups = lazy(() => import("./pages/groups/MyGroups"));
const Landing = lazy(() => import("./pages/Landing"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const JoinByCode = lazy(() => import("./pages/JoinByCode"));
const NotificationsPage = lazy(() => import("./pages/Notifications"));
const Chats = lazy(() => import("./pages/Chats"));
const Legal = lazy(() => import("./pages/Legal"));
const AuthCallback = lazy(() => import("./pages/AuthCallback"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const PersonalityQuizPage = lazy(() => import("./pages/PersonalityQuizPage"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));

/* =========================
   Auth (single source)
   ========================= */
type AuthCtx = { user: User | null; loading: boolean };
const AuthContext = createContext<AuthCtx>({ user: null, loading: true });
export function useAuth() {
  return useContext(AuthContext);
}
function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) console.warn("[auth] getSession error", error.message);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(() => ({ user, loading }), [user, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/* =========================
   Guards
   ========================= */
function RequireAuth({ children }: PropsWithChildren): JSX.Element | null {
  const { user, loading } = useAuth();
  // Use the hook to check profile status (onboarded or not)
  const { data: profile, isLoading: profileLoading } = useProfile(user?.id ?? null);
  const loc = useLocation();

  // 1. Wait while Auth or Profile is loading
  if (loading || (user && profileLoading)) {
    return <LoadingScreen />;
  }

  // 2. If not logged in, send to Onboarding
  if (!user) {
    return <Navigate to="/onboarding" replace state={{ from: loc.pathname }} />;
  }

  // 3. If logged in but profile not created/onboarded, send to Profile Creation
  //    We treat "no profile" or onboarded === false as needing setup.
  const needsProfileSetup = !profile || profile.onboarded === false;
  if (needsProfileSetup && loc.pathname !== "/profile-creation") {
    return <Navigate to="/profile-creation" replace state={{ from: loc.pathname }} />;
  }

  // 4. Authenticated & onboarded (or profile intentionally missing but auth valid)
  return <>{children}</>;
}

/* =========================
   Error Boundary
   ========================= */
class AppErrorBoundary extends React.Component<
  { children?: React.ReactNode },
  { error: unknown }
> {
  constructor(props: { children?: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="grid min-h-screen place-items-center p-6">
          <div className="max-w-md text-center">
            <h1 className="text-2xl font-bold">Something broke</h1>
            <p className="text-sm text-neutral-600 break-words mt-2">
              {String((this.state.error as any)?.message ?? this.state.error)}
            </p>
            <button
              className="mt-4 rounded-md border border-black/10 bg-white px-3 py-2 text-sm hover:bg-black/[0.04]"
              onClick={() => location.reload()}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
   return this.props.children as any;
  }
}

/* =========================
   Root helpers
   ========================= */
function GroupRedirect() {
  const { id } = useParams();
  return <Navigate to={`/group/${id}`} replace />;
}

/* =========================
   App
   ========================= */
export default function App() {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Disable browser scroll restoration
  useEffect(() => {
    try {
      if ('scrollRestoration' in history) {
        (history as any).scrollRestoration = 'manual';
      }
    } catch {}
  }, []);

  const loc = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [loc.pathname, loc.search]);

  return (
    // Added 'pb-20' to ensure content clears the bottom nav
    <div id="page-root" className="min-h-dvh flow-root flex flex-col">
      <AuthProvider>
          {/* Support Button - Styled cleaner */}
          <button
            onClick={() => window.open("mailto:support@meincircles.com?subject=Help%20with%20Circles%20App", "_blank")}
            className="fixed top-4 right-4 z-50 grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-indigo-500 via-purple-500 to-teal-400 text-white shadow-lg shadow-indigo-500/30 ring-1 ring-white/40 transition-all duration-200 hover:-translate-y-0.5 hover:scale-105"
            title="Support"
            aria-label="Support"
          >
            <HelpCircle className="h-6 w-6" />
          </button>

          
          <AppErrorBoundary>
            <Suspense
              fallback={<LoadingScreen />}
            >
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/onboarding" element={<Onboarding />} />
                <Route path="/legal" element={<Legal />} />
                <Route path="/invite/:code" element={<JoinByCode />} />
                <Route path="/auth/callback" element={<AuthCallback />} />

                {/* Authenticated profile-creation flow without the main Layout */}
                <Route
                  path="/profile-creation"
                  element={
                    <RequireAuth>
                      <ProfileCreation />
                    </RequireAuth>
                  }
                />

                <Route element={<RequireAuth><Layout /></RequireAuth>}>
                  <Route path="/browse" element={<BrowsePage />} />
                  <Route path="/groups" element={<Groups />} />
                  <Route path="/announcements" element={<AnnouncementsPage />} />
                  <Route path="/notifications" element={<NotificationsPage />} />
                  <Route path="/profile" element={<Profile />} />
                  <Route path="/profile/:userId" element={<Profile />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/quiz" element={<PersonalityQuizPage />} />
                  <Route path="/create" element={<CreateGroup />} />
                  <Route path="/group/:id" element={<GroupDetail />} />
                  <Route path="/groups/game/:game" element={<GroupsByGame />} />
                  <Route path="/groups/mine" element={<MyGroups />} />
                  <Route path="/chats" element={<Chats />} />
                  <Route path="/admin/dashboard" element={<AdminDashboard />} />
                </Route>

                <Route path="/groups/:id" element={<GroupRedirect />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </AppErrorBoundary>
      </AuthProvider>
    </div>
  );
}
