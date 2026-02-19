import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

export type AppLanguage = "en" | "de" | "fa";

const LANGUAGE_KEY = "circles_app_language";
const VALID: AppLanguage[] = ["en", "de", "fa"];

function normalizeLanguage(value: unknown): AppLanguage {
  return VALID.includes(value as AppLanguage) ? (value as AppLanguage) : "en";
}

type LanguageContextValue = {
  lang: AppLanguage;
  setLang: (next: AppLanguage) => void;
};

const LanguageContext = createContext<LanguageContextValue>({
  lang: "en",
  setLang: () => {},
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<AppLanguage>(() => {
    try {
      return normalizeLanguage(localStorage.getItem(LANGUAGE_KEY));
    } catch {
      return "en";
    }
  });

  const setLang = (next: AppLanguage) => {
    const normalized = normalizeLanguage(next);
    setLangState(normalized);
    try {
      localStorage.setItem(LANGUAGE_KEY, normalized);
    } catch {}
  };

  useEffect(() => {
    try {
      const handleStorage = (e: StorageEvent) => {
        if (e.key !== LANGUAGE_KEY) return;
        setLangState(normalizeLanguage(e.newValue));
      };
      window.addEventListener("storage", handleStorage);
      return () => window.removeEventListener("storage", handleStorage);
    } catch {}
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "fa" ? "rtl" : "ltr";
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang }), [lang]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useAppLanguage() {
  return useContext(LanguageContext);
}

