import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import "./Landing.css";

const HERO_CARDS = [
  { emoji: "👥", title: "Small groups, real energy", text: "Less noise, better plans", chip: "Social fit" },
  { emoji: "🗳️", title: "Vote on plans together", text: "No endless where/when threads", chip: "Fast decisions" },
  { emoji: "✅", title: "Safety tools built-in", text: "Designed for respectful meetups", chip: "Trust-minded" },
] as const;

const CATEGORIES = [
  { emoji: "☕", title: "Coffee & Walks", text: "Casual meetups, low pressure, great for first connections." },
  { emoji: "🎲", title: "Games", text: "Board games, party games, and regular group nights." },
  { emoji: "🏃", title: "Fitness", text: "Run clubs, gym buddies, and outdoor workout circles." },
  { emoji: "🎨", title: "Creative", text: "Photo walks, sketch sessions, and idea meetups." },
  { emoji: "🍳", title: "Food", text: "Dinner circles, brunch crews, and tasting adventures." },
  { emoji: "💬", title: "Language Exchange", text: "Small conversation groups to practice and connect." },
] as const;

const TESTIMONIALS = [
  {
    quote: "I met two close friends in my city in the first week. The voting flow saved so much time.",
    initials: "LM",
    name: "Lina M.",
    city: "Berlin",
  },
  {
    quote: "Feels less performative than social feeds. More practical, more human.",
    initials: "AS",
    name: "Aria S.",
    city: "Hamburg",
  },
  {
    quote: "Our game night circle fills up every week. It has become part of my routine.",
    initials: "DN",
    name: "David N.",
    city: "Freiburg",
  },
] as const;

const SAFETY_FEATURES = [
  {
    icon: "🛡️",
    title: "Report and block controls",
    text: "Clear options to report behavior and remove unwanted contact quickly.",
  },
  {
    icon: "🧭",
    title: "Context-first group pages",
    text: "Group norms, location context, and event details are visible before joining.",
  },
  {
    icon: "🤝",
    title: "Small group structure",
    text: "Smaller circles reduce chaos and make interactions easier to manage.",
  },
] as const;

const SHOWCASE_SLIDES = [
  {
    image: `${import.meta.env.BASE_URL}image.png`,
    title: "Real profiles, not random feeds",
    text: "See people, context, and plans clearly before you join a circle.",
  },
  {
    image: `${import.meta.env.BASE_URL}image2.png`,
    title: "Group spaces that stay calm",
    text: "Small circles keep conversations focused and easier to trust.",
  },
  {
    image: `${import.meta.env.BASE_URL}image3.png`,
    title: "Decide plans together fast",
    text: "Voting removes planning friction so meetups actually happen.",
  },
  {
    image: `${import.meta.env.BASE_URL}image4.png`,
    title: "From online chat to real life",
    text: "Move from messages to a real meetup with people who show up.",
  },
  {
    image: `${import.meta.env.BASE_URL}image5.png`,
    title: "Simple, human, and social",
    text: "Built for genuine connection, not endless scrolling.",
  },
] as const;

export default function Landing() {
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const currentSlide = useMemo(() => SHOWCASE_SLIDES[activeSlide], [activeSlide]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cleanups: Array<() => void> = [];

    const revealElements = Array.from(root.querySelectorAll<HTMLElement>(".reveal"));
    if (reducedMotion || typeof IntersectionObserver === "undefined") {
      revealElements.forEach((el) => el.classList.add("visible"));
    } else {
      const observer = new IntersectionObserver(
        (entries, obs) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add("visible");
              obs.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.14, rootMargin: "0px 0px -8% 0px" },
      );
      revealElements.forEach((el) => observer.observe(el));
      cleanups.push(() => observer.disconnect());
    }

    const anchorHandler = (event: Event) => {
      const anchor = event.currentTarget as HTMLAnchorElement;
      const href = anchor.getAttribute("href");
      if (!href || href === "#") return;
      const target = root.querySelector<HTMLElement>(href) ?? document.querySelector<HTMLElement>(href);
      if (!target) return;

      event.preventDefault();
      target.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "start",
      });
    };

    const anchors = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'));
    anchors.forEach((anchor) => anchor.addEventListener("click", anchorHandler));
    cleanups.push(() => anchors.forEach((anchor) => anchor.removeEventListener("click", anchorHandler)));

    return () => cleanups.forEach((cleanup) => cleanup());
  }, []);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;

    const timer = window.setInterval(() => {
      setActiveSlide((prev) => (prev + 1) % SHOWCASE_SLIDES.length);
    }, 5200);

    return () => window.clearInterval(timer);
  }, []);

  function goToSlide(nextIndex: number) {
    setActiveSlide(nextIndex);
  }

  function nextSlide() {
    setActiveSlide((prev) => (prev + 1) % SHOWCASE_SLIDES.length);
  }

  function prevSlide() {
    setActiveSlide((prev) => (prev - 1 + SHOWCASE_SLIDES.length) % SHOWCASE_SLIDES.length);
  }

  return (
    <div className="circles-landing" ref={rootRef}>
      <div className="noise" aria-hidden="true" />

      <header className="nav">
        <div className="container nav-inner">
          <a href="#top" className="logo" aria-label="Circles home">
            <span className="logo-rings" aria-hidden="true">
              <span className="ring r1" />
              <span className="ring r2" />
              <span className="ring r3" />
            </span>
            Circles
          </a>

          <nav className="nav-links" aria-label="Primary">
            <a href="#how">How it works</a>
            <a href="#explore">Explore</a>
            <a href="#safety">Safety</a>
          </nav>

          <div className="nav-actions">
            <button type="button" className="btn btn-outline" onClick={() => navigate("/auth?mode=signin")}>
              Log in
            </button>
            <button type="button" className="btn btn-primary" onClick={() => navigate("/auth")}>
              Get Started <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="container hero-inner">
            <div className="badge reveal">
              <span className="badge-dot" aria-hidden="true" />
              MVP · Early Access
            </div>

            <h1 className="hero-title reveal">
              Find your people.
              <span className="line2">Go do things.</span>
            </h1>

            <p className="hero-sub reveal">
              Circles helps you build small trusted groups, make plans together, and meet in real life this week.
            </p>

            <div className="hero-actions reveal">
              <button type="button" className="btn btn-primary" onClick={() => navigate("/auth")}>
                Join now <span aria-hidden="true">→</span>
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => navigate("/auth?mode=signin")}>
                I already have an account
              </button>
            </div>

            <div className="floating-cards reveal" aria-label="Highlights">
              {HERO_CARDS.map((card) => (
                <article key={card.title} className="float-card">
                  <div className="float-icon" aria-hidden="true">
                    {card.emoji}
                  </div>
                  <div>
                    <p className="float-title">{card.title}</p>
                    <p className="float-text">{card.text}</p>
                    <span className="chip">{card.chip}</span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="proof">
          <div className="container proof-inner reveal">
            <div>
              <strong>2,000+</strong> early members
            </div>
            <span className="proof-divider" aria-hidden="true" />
            <div>
              <strong>120+</strong> weekly meetups
            </div>
            <span className="proof-divider" aria-hidden="true" />
            <div>
              <strong>Safety tools built-in</strong>
            </div>
            <span className="proof-divider" aria-hidden="true" />
            <div>
              <strong>Small groups by default</strong>
            </div>
          </div>
        </section>

        <section id="how" className="section">
          <div className="container how-grid">
            <div className="reveal">
              <div className="phone" aria-label="Circles app preview">
                <div className="phone-notch" aria-hidden="true" />
                <div className="phone-head">
                  <strong>Circles</strong>
                  <span className="live-dot" aria-hidden="true" />
                </div>

                <article className="phone-card">
                  <div className="phone-row">
                    <div>
                      <p className="phone-title">Sunday Brunch Run</p>
                      <p className="phone-sub">Food • Freiburg</p>
                    </div>
                    <span className="tag green">Open</span>
                  </div>
                  <div className="phone-meta">
                    <span>8 members</span>
                    <button className="mini-btn" type="button">
                      Join
                    </button>
                  </div>
                </article>

                <article className="phone-card">
                  <div className="phone-row">
                    <div>
                      <p className="phone-title">Board Game Night</p>
                      <p className="phone-sub">Games • Tonight</p>
                    </div>
                    <span className="tag">Voting</span>
                  </div>
                  <div className="phone-meta">
                    <span>5 members</span>
                    <button className="mini-btn" type="button">
                      Join
                    </button>
                  </div>
                </article>

                <article className="phone-card">
                  <div className="phone-row">
                    <div>
                      <p className="phone-title">Morning Walk Group</p>
                      <p className="phone-sub">Wellness • Daily</p>
                    </div>
                    <span className="tag green">Active</span>
                  </div>
                  <div className="phone-meta">
                    <span>12 members</span>
                    <button className="mini-btn" type="button">
                      Join
                    </button>
                  </div>
                </article>
              </div>
            </div>

            <div>
              <div className="eyebrow reveal">How it works</div>
              <h2 className="section-title reveal">Simple flow, real-life outcomes</h2>
              <p className="section-desc reveal">
                Start with shared interests, decide fast, and show up. Circles is built to move people from chat to
                plans.
              </p>

              <div className="how-steps">
                <article className="step reveal">
                  <div className="step-num" aria-hidden="true">
                    1
                  </div>
                  <div>
                    <h3 className="step-title">Discover circles near you</h3>
                    <p className="step-desc">Find small groups around your city based on activities you actually enjoy.</p>
                  </div>
                </article>
                <article className="step reveal">
                  <div className="step-num" aria-hidden="true">
                    2
                  </div>
                  <div>
                    <h3 className="step-title">Vote on place and time</h3>
                    <p className="step-desc">Members pick options together so planning takes minutes, not days.</p>
                  </div>
                </article>
                <article className="step reveal">
                  <div className="step-num" aria-hidden="true">
                    3
                  </div>
                  <div>
                    <h3 className="step-title">Meet this week</h3>
                    <p className="step-desc">Turn online coordination into real meetups with people who show up.</p>
                  </div>
                </article>
              </div>
            </div>
          </div>
        </section>

        <section id="preview" className="section">
          <div className="container showcase-grid reveal">
            <div className="showcase-frame">
              <img
                key={currentSlide.image}
                src={currentSlide.image}
                alt={`Circles preview slide ${activeSlide + 1}`}
                className="showcase-image"
              />
              <span className="showcase-chip">Live app preview</span>
            </div>

            <div className="showcase-panel">
              <div className="eyebrow">Preview</div>
              <h2 className="section-title showcase-title">{currentSlide.title}</h2>
              <p className="section-desc">{currentSlide.text}</p>

              <div className="showcase-actions">
                <button type="button" className="btn btn-outline" onClick={prevSlide}>
                  Previous
                </button>
                <button type="button" className="btn btn-primary" onClick={nextSlide}>
                  Next
                </button>
              </div>

              <div className="showcase-dots" role="tablist" aria-label="Preview slides">
                {SHOWCASE_SLIDES.map((slide, index) => (
                  <button
                    key={slide.title}
                    type="button"
                    className={`showcase-dot ${index === activeSlide ? "active" : ""}`}
                    onClick={() => goToSlide(index)}
                    aria-label={`Go to preview slide ${index + 1}`}
                    aria-selected={index === activeSlide}
                  />
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="explore" className="section">
          <div className="container">
            <div className="eyebrow reveal">Explore</div>
            <h2 className="section-title reveal">Categories people actually use</h2>
            <p className="section-desc reveal">
              Choose a vibe and join groups where the atmosphere feels right for you.
            </p>

            <div className="explore-grid">
              {CATEGORIES.map((item) => (
                <article key={item.title} className="cat-card reveal">
                  <div className="cat-emoji" aria-hidden="true">
                    {item.emoji}
                  </div>
                  <h3 className="cat-title">{item.title}</h3>
                  <p className="cat-text">{item.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="safety" className="section safety">
          <div className="container safety-grid">
            <div className="reveal">
              <div className="eyebrow">Safety</div>
              <h2 className="section-title">Built for respectful, real-world meetups</h2>
              <p className="section-desc">
                Circles includes practical safety tools and moderation patterns to help members feel comfortable
                meeting.
              </p>
            </div>

            <div className="safety-features">
              {SAFETY_FEATURES.map((feature) => (
                <article key={feature.title} className="feature reveal">
                  <div className="feature-icon" aria-hidden="true">
                    {feature.icon}
                  </div>
                  <div>
                    <h4>{feature.title}</h4>
                    <p>{feature.text}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section">
          <div className="container">
            <div className="eyebrow reveal">Testimonials</div>
            <h2 className="section-title reveal">People are actually meeting up</h2>
            <p className="section-desc reveal">Early members use Circles to turn chats into regular plans.</p>

            <div className="test-grid">
              {TESTIMONIALS.map((item) => (
                <article key={item.name} className="test-card reveal">
                  <div className="stars" aria-label="5 stars">
                    <span>★</span>
                    <span>★</span>
                    <span>★</span>
                    <span>★</span>
                    <span>★</span>
                  </div>
                  <p className="test-quote">"{item.quote}"</p>
                  <div className="test-user">
                    <div className="avatar" aria-hidden="true">
                      {item.initials}
                    </div>
                    <div>
                      <strong>{item.name}</strong>
                      <span>{item.city}</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section">
          <div className="container">
            <div className="final-cta reveal">
              <h2>Ready to find your people?</h2>
              <p>Join Circles and start building small groups that actually meet offline.</p>
              <button type="button" className="btn btn-green" onClick={() => navigate("/auth")}>
                Get Started →
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="container footer-inner">
          <div>© {new Date().getFullYear()} Circles</div>
          <nav className="footer-links" aria-label="Footer">
            <Link to="/legal">Privacy</Link>
            <Link to="/legal">Terms</Link>
            <a href="#safety">Safety</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
