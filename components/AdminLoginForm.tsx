'use client';

import { FormEvent, useState } from 'react';
import { useAction } from 'convex/react';
import { useRouter } from 'next/navigation';
import { api } from '@/convex/_generated/api';
import { ADMIN_AUTH_CHANGED_EVENT } from '@/components/authEvents';
import { LockKeyhole, LogIn } from 'lucide-react';

export default function AdminLoginForm() {
  const router = useRouter();
  const login = useAction(api.auth.login);
  const [email, setEmail] = useState('admin@navi.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login({ email, password });
      window.localStorage.setItem('navi_admin_session', result.token);
      window.dispatchEvent(new Event(ADMIN_AUTH_CHANGED_EVENT));
      router.replace('/admin');
    } catch {
      setError('Invalid email or password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 text-neutral-200">
      <section className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-8 shadow-2xl">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-cyan-700"><LockKeyhole className="size-5 text-white" /></div>
          <div><p className="text-lg font-bold text-white">NaviCMS</p><p className="text-xs text-neutral-500">Administrator sign in</p></div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div><label htmlFor="email" className="mb-1 block text-[10px] font-bold uppercase text-neutral-500">Email</label><input id="email" type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-600" required /></div>
          <div><label htmlFor="password" className="mb-1 block text-[10px] font-bold uppercase text-neutral-500">Password</label><input id="password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-600" required /></div>
          {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
          <button type="submit" disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-md bg-cyan-700 py-2.5 text-xs font-bold text-white transition-colors hover:bg-cyan-600 disabled:opacity-40"><LogIn className="size-4" />{loading ? 'Signing in...' : 'Sign in'}</button>
        </form>
      </section>
    </main>
  );
}
