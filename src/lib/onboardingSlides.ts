export type OnboardingSlide = {
  title: string;
  text: string;
  image: string;
};

export const ONBOARDING_SLIDES: OnboardingSlide[] = [
  {
    title: "Find your people",
    text: "Start a circle that feels like friends, not followers.",
    image: `${import.meta.env.BASE_URL}image.png`,
  },
  {
    title: "Trusted by Design",
    text: "Safety first. All profiles are verified, so you can meet others with confidence.",
    image: `${import.meta.env.BASE_URL}image2.png`,
  },
  {
    title: "Matched, not random",
    text: "We use AI to understand personalities and build balanced groups where conversations flow naturally.",
    image: `${import.meta.env.BASE_URL}image3.png`,
  },
  {
    title: "Real plans, real meetings",
    text: "We focus on clear dates, verified hosts, and actual activities. No ghosting, no flaking.",
    image: `${import.meta.env.BASE_URL}image4.png`,
  },
  {
    title: "Signal, not noise",
    text: "No endless feed. Just what matters to turn conversations into real-world meetups.",
    image: `${import.meta.env.BASE_URL}image5.png`,
  },
];
