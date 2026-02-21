import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export default function AuthCallback() {
  const navigate = useNavigate();
  useEffect(() => {
    (async () => {
      await supabase.auth.getSession(); // completes OAuth on web/PWA/native
      const stored = localStorage.getItem("postLoginRedirect");
      if (stored) localStorage.removeItem("postLoginRedirect");
      navigate(stored || "/profile", { replace: true });
    })();
  }, [navigate]);
  return null;
}
