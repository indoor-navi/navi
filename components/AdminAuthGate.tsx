'use client';

import { startTransition, useEffect, useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import AdminLoginForm from '@/components/AdminLoginForm';
import { ADMIN_AUTH_CHANGED_EVENT } from '@/components/authEvents';

const SESSION_KEY = 'navi_admin_session';

export default function AdminAuthGate({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | undefined>(() =>
    typeof window === 'undefined' ? undefined : window.localStorage.getItem(SESSION_KEY) || undefined
  );
  const session = useQuery(api.auth.getSession, { token });

  useEffect(() => {
    const refreshToken = () => {
      startTransition(() => {
        setToken(window.localStorage.getItem(SESSION_KEY) || undefined);
      });
    };
    window.addEventListener(ADMIN_AUTH_CHANGED_EVENT, refreshToken);
    window.addEventListener('storage', refreshToken);
    return () => {
      window.removeEventListener(ADMIN_AUTH_CHANGED_EVENT, refreshToken);
      window.removeEventListener('storage', refreshToken);
    };
  }, []);

  if (session === undefined) {
    return <div className="min-h-screen bg-neutral-950" />;
  }

  if (!token || !session) {
    return <AdminLoginForm />;
  }

  return <>{children}</>;
}
