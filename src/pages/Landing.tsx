import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  Compass,
  Vote,
} from "lucide-react";
import { useAuth } from "@/App";

type HeroVariant = "exact" | "psych";

type HeroCopy = {
  headline: string;
  subheadline: string;
  cta: string;
  micro: string;
};

const HERO_COPY: Record<HeroVariant, HeroCopy> = {
  exact: {
    headline: "Meet your people.\nNot just your feed.",
    subheadline:
      "Circles helps you join small trusted groups near you, vote on real plans, and meet this week — not someday.",
    cta: "Get Started",
    micro: "Takes 30 seconds. Free to try.",
  },
  psych: {
    headline: "Stop scrolling.\nStart meeting.",
    subheadline:
      "Most social apps keep you online. Circles gets you offline — into real small groups that meet this week.",
    cta: "Find your circle",
    micro: "No spam. No noise. Just real plans.",
  },
};

function resolveHeroVariant(): HeroVariant {
  if (typeof window === "undefined") return "exact";
  const params = new URLSearchParams(window.location.search);
  const forced = params.get("hero");
  if (forced === "exact" || forced === "psych") {
    localStorage.setItem("circles_landing_hero_variant", forced);
    return forced;
  }
  const stored = localStorage.getItem("circles_landing_hero_variant");
  if (stored === "exact" || stored === "psych") return stored;
  const assigned: HeroVariant = Math.random() < 0.5 ? "exact" : "psych";
  localStorage.setItem("circles_landing_hero_variant", assigned);
  return assigned;
}

export default function Landing() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [heroVariant] = useState<HeroVariant>(() => resolveHeroVariant());
  const hero = HERO_COPY[heroVariant];
  const prefersReducedMotion = useReducedMotion();

  const sectionVariant = useMemo(
    () => ({
      hidden: { opacity: 0, y: prefersReducedMotion ? 0 : 30 },
      show: {
        opacity: 1,
        y: 0,
        transition: { duration: prefersReducedMotion ? 0 : 0.6, ease: "easeOut" as const },
      },
    }),
    [prefersReducedMotion]
  );

  const cardContainerVariant = useMemo(
    () => ({
      hidden: {},
      show: {
        transition: { staggerChildren: prefersReducedMotion ? 0 : 0.1 },
      },
    }),
    [prefersReducedMotion]
  );

  const cardVariant = useMemo(
    () => ({
      hidden: { opacity: 0, y: prefersReducedMotion ? 0 : 18 },
      show: {
        opacity: 1,
        y: 0,
        transition: { duration: prefersReducedMotion ? 0 : 0.45, ease: "easeOut" as const },
      },
    }),
    [prefersReducedMotion]
  );

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[radial-gradient(circle_at_10%_8%,rgba(16,185,129,0.16),transparent_40%),radial-gradient(circle_at_88%_12%,rgba(14,165,233,0.12),transparent_42%),#f6f7f9] text-neutral-900">
      <div className="pointer-events-none absolute inset-0">
        <motion.div
          className="absolute -left-24 top-20 h-72 w-72 rounded-full bg-emerald-300/20 blur-3xl"
          animate={
            prefersReducedMotion
              ? undefined
              : { x: [0, 24, -12, 0], y: [0, -18, 10, 0], scale: [1, 1.06, 0.97, 1] }
          }
          transition={
            prefersReducedMotion
              ? undefined
              : { duration: 24, repeat: Infinity, ease: "easeInOut", repeatType: "loop" }
          }
        />
        <motion.div
          className="absolute right-[-80px] top-14 h-80 w-80 rounded-full bg-sky-300/18 blur-3xl"
          animate={
            prefersReducedMotion
              ? undefined
              : { x: [0, -28, 8, 0], y: [0, 16, -14, 0], scale: [1, 0.96, 1.08, 1] }
          }
          transition={
            prefersReducedMotion
              ? undefined
              : { duration: 28, repeat: Infinity, ease: "easeInOut", repeatType: "loop" }
          }
        />
      </div>

      <div className="relative mx-auto w-full max-w-6xl px-6 pb-20 pt-8">
        <header className="mb-12 flex items-center justify-between">
          <div className="inline-flex items-center gap-3 rounded-2xl border border-white/70 bg-white/85 px-3 py-2 shadow-sm">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-sky-500 text-sm font-black text-white ring-1 ring-black/5">
              C
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-neutral-500">Circles</p>
              <p className="text-sm font-semibold">From Online to On-Life.</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link to="/onboarding" className="text-sm font-semibold text-neutral-700 underline-offset-2 hover:text-neutral-900 hover:underline">
              Already have an account? Sign in
            </Link>
            {user ? (
              <button
                type="button"
                onClick={() => navigate("/browse")}
                className="rounded-full bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black"
              >
                Go to app
              </button>
            ) : null}
          </div>
        </header>

        <main className="space-y-12">
          <section id="hero" className="rounded-3xl border border-white/70 bg-white/90 p-8 shadow-xl shadow-black/5">
            <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
              <div>
                <motion.h1
                  className="whitespace-pre-line text-4xl font-black leading-tight sm:text-6xl"
                  initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: prefersReducedMotion ? 0 : 0.6, ease: "easeOut" }}
                >
                  {hero.headline}
                </motion.h1>
                <motion.p
                  className="mt-4 max-w-xl text-lg text-neutral-700"
                  initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: prefersReducedMotion ? 0 : 0.6, ease: "easeOut", delay: prefersReducedMotion ? 0 : 0.15 }}
                >
                  {hero.subheadline}
                </motion.p>
                <motion.div
                  className="mt-8 flex flex-wrap items-center gap-3"
                  initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: prefersReducedMotion ? 0 : 0.6, ease: "easeOut", delay: prefersReducedMotion ? 0 : 0.3 }}
                >
                  <motion.button
                    type="button"
                    onClick={() => navigate("/onboarding")}
                    whileHover={prefersReducedMotion ? undefined : { scale: 1.045, boxShadow: "0 14px 36px rgba(5, 150, 105, 0.30)" }}
                    whileTap={prefersReducedMotion ? undefined : { scale: 0.98 }}
                    className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-6 py-3 text-base font-bold text-white shadow-lg shadow-emerald-600/20 transition-all duration-300 ease-out hover:bg-emerald-700"
                  >
                    {hero.cta}
                    <ArrowRight className="h-4 w-4" />
                  </motion.button>
                  <Link
                    to="/legal"
                    className="rounded-full border border-neutral-300 bg-white px-5 py-3 text-sm font-semibold text-neutral-700 transition-all duration-300 ease-out hover:border-neutral-400 hover:text-neutral-900"
                  >
                    Privacy & Terms
                  </Link>
                </motion.div>
                <motion.p
                  className="mt-3 text-sm font-medium text-neutral-600"
                  initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: prefersReducedMotion ? 0 : 0.6, ease: "easeOut", delay: prefersReducedMotion ? 0 : 0.38 }}
                >
                  {hero.micro}
                </motion.p>
              </div>

              <motion.div
                className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5"
                variants={sectionVariant}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, amount: 0.2 }}
              >
                <h2 className="text-lg font-bold">How Circles works</h2>
                <motion.div className="mt-4 space-y-3" variants={cardContainerVariant} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.2 }}>
                  <motion.div variants={cardVariant} className="flex gap-3 rounded-xl border border-neutral-200 bg-white p-3">
                    <Compass className="mt-0.5 h-5 w-5 text-emerald-600" />
                    <div>
                      <p className="text-sm font-semibold">Find your circle</p>
                      <p className="text-xs text-neutral-600">Discover small groups in your city that match your interests.</p>
                    </div>
                  </motion.div>
                  <motion.div variants={cardVariant} className="flex gap-3 rounded-xl border border-neutral-200 bg-white p-3">
                    <Vote className="mt-0.5 h-5 w-5 text-sky-600" />
                    <div>
                      <p className="text-sm font-semibold">Vote on plans</p>
                      <p className="text-xs text-neutral-600">Decide together when and where to meet.</p>
                    </div>
                  </motion.div>
                  <motion.div variants={cardVariant} className="flex gap-3 rounded-xl border border-neutral-200 bg-white p-3">
                    <CalendarCheck2 className="mt-0.5 h-5 w-5 text-amber-600" />
                    <div>
                      <p className="text-sm font-semibold">Meet this week</p>
                      <p className="text-xs text-neutral-600">Turn online connection into real life — quickly.</p>
                    </div>
                  </motion.div>
                </motion.div>
              </motion.div>
            </div>
          </section>

          <motion.section
            className="rounded-2xl border border-emerald-200 bg-emerald-50/65 px-4 py-3 text-sm font-semibold text-emerald-900"
            variants={sectionVariant}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.2 }}
          >
            Small trusted groups • Verified profiles • Real-world meetups
          </motion.section>

          {heroVariant === "psych" ? (
            <motion.section
              className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm"
              variants={sectionVariant}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.2 }}
            >
              <p className="text-center text-base font-semibold text-neutral-800">
                We believe real connection happens in small groups. Not in feeds. Not in likes. In real rooms.
              </p>
              <p className="mt-3 text-center text-sm font-medium text-neutral-600">
                Built for meaningful meetups — not popularity.
              </p>
            </motion.section>
          ) : null}

          <motion.section
            className="rounded-3xl border border-neutral-200 bg-white p-7 shadow-sm"
            variants={sectionVariant}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.2 }}
          >
            <h2 className="text-2xl font-bold">How Circles works</h2>
            <motion.div className="mt-5 grid gap-3 md:grid-cols-3" variants={cardContainerVariant} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.2 }}>
              <motion.div variants={cardVariant} className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                <p className="text-base font-semibold">Find your circle</p>
                <p className="mt-1 text-sm text-neutral-600">Discover small groups in your city that match your interests.</p>
              </motion.div>
              <motion.div variants={cardVariant} className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                <p className="text-base font-semibold">Vote on plans</p>
                <p className="mt-1 text-sm text-neutral-600">Decide together when and where to meet.</p>
              </motion.div>
              <motion.div variants={cardVariant} className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                <p className="text-base font-semibold">Meet this week</p>
                <p className="mt-1 text-sm text-neutral-600">Turn online connection into real life — quickly.</p>
              </motion.div>
            </motion.div>
          </motion.section>

          <motion.section
            className="rounded-3xl border border-neutral-200 bg-white p-7 shadow-sm"
            variants={sectionVariant}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.2 }}
          >
            <h2 className="text-2xl font-bold">Happening near you</h2>
            <p className="mt-1 text-sm text-neutral-600">Real meetups scheduled this week.</p>
            <motion.div className="mt-4 space-y-2" variants={cardContainerVariant} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.2 }}>
              {[
                { circle: "Board Games", time: "Thu 19:00", place: "Freiburg" },
                { circle: "Coffee Walks", time: "Fri 18:30", place: "Freiburg" },
                { circle: "Book Lovers", time: "Sat 16:00", place: "Basel" },
              ].map((item) => (
                <motion.div key={`${item.circle}-${item.time}`} variants={cardVariant} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-neutral-900">{item.circle}</p>
                    <p className="text-xs text-neutral-600">{item.time} · {item.place}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate("/onboarding")}
                    className="rounded-full border border-neutral-300 bg-white px-4 py-1.5 text-xs font-semibold text-neutral-700 transition-all duration-300 ease-out hover:border-neutral-400 hover:text-neutral-900"
                  >
                    Join
                  </button>
                </motion.div>
              ))}
            </motion.div>
          </motion.section>

          <motion.section
            className="rounded-3xl border border-neutral-200 bg-white p-7 shadow-sm"
            variants={sectionVariant}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.2 }}
          >
            <h2 className="text-2xl font-bold">Built for real life</h2>
            <motion.div className="mt-5 grid gap-3 md:grid-cols-3" variants={cardContainerVariant} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.2 }}>
              <motion.div variants={cardVariant} className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                <p className="text-base font-semibold">No noisy feeds</p>
                <p className="mt-1 text-sm text-neutral-600">No endless scrolling. Just clear plans.</p>
              </motion.div>
              <motion.div variants={cardVariant} className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                <p className="text-base font-semibold">Small by design</p>
                <p className="mt-1 text-sm text-neutral-600">Groups are capped to build real trust.</p>
              </motion.div>
              <motion.div variants={cardVariant} className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                <p className="text-base font-semibold">Safety first</p>
                <p className="mt-1 text-sm text-neutral-600">Private circles. Controlled invites. Verified profiles.</p>
              </motion.div>
            </motion.div>
          </motion.section>

          <motion.section
            className="rounded-3xl border border-neutral-900 bg-neutral-900 p-7 text-white shadow-sm"
            variants={sectionVariant}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.2 }}
          >
            <h2 className="text-2xl font-bold">Problem → Solution → Differentiation</h2>
            <p className="mt-2 text-sm text-neutral-200">
              Circles is a real-world social coordination platform. We turn online intent into offline action.
            </p>
            <p className="mt-1 text-sm text-neutral-300">
              Small trusted groups coordinate, vote, and meet — in days, not months.
            </p>
            <motion.div className="mt-5 grid gap-3 md:grid-cols-3" variants={cardContainerVariant} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.2 }}>
              <motion.div variants={cardVariant} className="rounded-2xl border border-white/20 bg-white/5 p-4">
                <p className="text-sm font-semibold">Problem</p>
                <p className="mt-1 text-sm text-neutral-200">Social platforms optimize for attention, not real-life connection.</p>
              </motion.div>
              <motion.div variants={cardVariant} className="rounded-2xl border border-white/20 bg-white/5 p-4">
                <p className="text-sm font-semibold">Solution</p>
                <p className="mt-1 text-sm text-neutral-200">Circles limits group size, structures decisions, and drives real meetups.</p>
              </motion.div>
              <motion.div variants={cardVariant} className="rounded-2xl border border-white/20 bg-white/5 p-4">
                <p className="text-sm font-semibold">Differentiation</p>
                <p className="mt-1 text-sm text-neutral-200">
                  No public feed. No followers. No algorithmic addiction. Small group cap. Real meetup verification.
                </p>
              </motion.div>
            </motion.div>
            <p className="mt-4 text-xs text-neutral-300">Active groups forming weekly. Real meetups scheduled in local cities.</p>
          </motion.section>

          <motion.section
            className="rounded-3xl border border-emerald-200 bg-emerald-50 p-8 text-center shadow-sm"
            variants={sectionVariant}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.2 }}
          >
            <h2 className="text-3xl font-black text-neutral-900">
              {heroVariant === "psych" ? "Your next circle is closer than you think." : "Ready to meet your people?"}
            </h2>
            <div className="mt-5">
              <motion.button
                type="button"
                onClick={() => navigate("/onboarding")}
                whileHover={prefersReducedMotion ? undefined : { scale: 1.045, boxShadow: "0 14px 36px rgba(5, 150, 105, 0.30)" }}
                whileTap={prefersReducedMotion ? undefined : { scale: 0.98 }}
                className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-7 py-3 text-base font-bold text-white shadow-lg shadow-emerald-600/20 transition-all duration-300 ease-out hover:bg-emerald-700"
              >
                {heroVariant === "psych" ? "Join your first circle" : "Get Started"}
                <ArrowRight className="h-4 w-4" />
              </motion.button>
            </div>
            <p className="mt-3 text-sm font-medium text-emerald-900/80">
              {heroVariant === "psych" ? "No spam. No noise. Just real plans." : "Start with one circle today."}
            </p>
          </motion.section>

          <motion.footer
            className="flex justify-center"
            variants={sectionVariant}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.2 }}
          >
            <Link to="/legal" className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-600 hover:text-neutral-900">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Privacy & Terms
            </Link>
          </motion.footer>
        </main>
      </div>
    </div>
  );
}
