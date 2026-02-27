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
const UserProfileView = lazy(() => import("./pages/UserProfileView"));
const ProfileCreation = lazy(() => import("./pages/ProfileCreation"));
const GroupsByGame = lazy(() => import("./pages/groups/GroupsByGame"));
const Landing = lazy(() => import("./pages/Landing"));
const AuthEntry = lazy(() => import("./pages/AuthEntry"));
const JoinByCode = lazy(() => import("./pages/JoinByCode"));
const NotificationsPage = lazy(() => import("./pages/Notifications"));
const Chats = lazy(() => import("./pages/Chats"));
const Legal = lazy(() => import("./pages/Legal"));
const AuthCallback = lazy(() => import("./pages/AuthCallback"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const PersonalityQuizPage = lazy(() => import("./pages/PersonalityQuizPage"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const EventRatingPage = lazy(() => import("./pages/EventRatingPage"));

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

  // 2. If not logged in, send to auth entry
  if (!user) {
    const from = `${loc.pathname}${loc.search}${loc.hash}`;
    return <Navigate to="/auth" replace state={{ from }} />;
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
  // Disable browser scroll restoration
  useEffect(() => {
    try {
      if ('scrollRestoration' in history) {
        (history as any).scrollRestoration = 'manual';
      }
    } catch {}
  }, []);

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        window.scrollTo(0, 0);
      }
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  const loc = useLocation();
  useEffect(() => {
    const scrollToTop = () => window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    scrollToTop();
    const raf = window.requestAnimationFrame(scrollToTop);
    return () => window.cancelAnimationFrame(raf);
  }, [loc.pathname, loc.search, loc.hash]);

  return (
    // Added 'pb-20' to ensure content clears the bottom nav
    <div id="page-root" className="min-h-dvh flow-root flex flex-col">
      <AuthProvider>
          <AppErrorBoundary>
            <Suspense
              fallback={<LoadingScreen />}
            >
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/auth" element={<AuthEntry />} />
                <Route path="/onboarding" element={<Navigate to="/auth" replace />} />
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
                  <Route path="/browse/:activity" element={<GroupsByGame />} />
                  <Route path="/groups" element={<Groups />} />
                  <Route path="/announcements" element={<AnnouncementsPage />} />
                  <Route path="/notifications" element={<NotificationsPage />} />
                  <Route path="/profile" element={<Profile />} />
                  <Route path="/profile/:userId" element={<UserProfileView />} />
                  <Route path="/users/:userId" element={<UserProfileView />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/quiz" element={<PersonalityQuizPage />} />
                  <Route path="/create" element={<CreateGroup />} />
                  <Route path="/group/:id" element={<GroupDetail />} />
                  <Route path="/groups/game/:game" element={<GroupsByGame />} />
                  <Route path="/groups/mine" element={<Navigate to="/groups" replace />} />
                  <Route path="/chats" element={<Chats />} />
                  <Route path="/events/:eventId/rate" element={<EventRatingPage />} />
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
