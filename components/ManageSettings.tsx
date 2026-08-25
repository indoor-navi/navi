'use client';

import { FormEvent, useState } from 'react';
import { useAction, useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { ClipboardList, UserPlus, Users, Trash2 } from 'lucide-react';

interface ManageSettingsProps {
  token: string;
}

type UserRole = 'admin' | 'editor' | 'viewer';

export default function ManageSettings({ token }: ManageSettingsProps) {
  const [view, setView] = useState<'users' | 'audit'>('users');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('viewer');
  const [message, setMessage] = useState('');
  const users = useQuery(api.auth.listUsers, { token });
  const auditLogs = useQuery(api.auth.listAuditLogs, { token });
  const createUser = useAction(api.auth.createUser);
  const resetUserPassword = useAction(api.auth.resetUserPassword);
  const deleteUser = useMutation(api.auth.deleteUser);

  const handleCreateUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage('');
    try {
      await createUser({ token, email, password, role });
      setEmail('');
      setPassword('');
      setMessage('User created successfully.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create user.');
    }
  };

  const handleDelete = async (userId: string) => {
    if (!window.confirm('Delete this user?')) return;
    try {
      await deleteUser({ token, userId: userId as Id<'users'> });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to delete user.');
    }
  };

  const handleResetPassword = async (userId: string) => {
    const password = window.prompt('Enter a new password (at least 8 characters):');
    if (!password) return;
    setMessage('');
    try {
      await resetUserPassword({ token, userId: userId as Id<'users'>, password });
      setMessage('Password reset successfully. Existing sessions were signed out.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to reset password.');
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex items-center gap-2 border-b border-neutral-800 pb-3">
        <button onClick={() => setView('users')} className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs font-bold ${view === 'users' ? 'bg-cyan-700 text-white' : 'text-neutral-400 hover:bg-neutral-800'}`}><Users className="size-4" />Manage users</button>
        <button onClick={() => setView('audit')} className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs font-bold ${view === 'audit' ? 'bg-cyan-700 text-white' : 'text-neutral-400 hover:bg-neutral-800'}`}><ClipboardList className="size-4" />Audit logs</button>
      </div>

      {view === 'users' ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.4fr]">
          <form onSubmit={handleCreateUser} className="h-fit space-y-4 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
            <div className="flex items-center gap-2"><UserPlus className="size-4 text-cyan-400" /><h2 className="text-sm font-semibold text-white">Create admin user</h2></div>
            <input type="email" placeholder="Email" value={email} onChange={event => setEmail(event.target.value)} className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-600" required />
            <input type="password" placeholder="Temporary password" minLength={8} value={password} onChange={event => setPassword(event.target.value)} className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-600" required />
            <select value={role} onChange={event => setRole(event.target.value as UserRole)} className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-600"><option value="viewer">Viewer</option><option value="editor">Editor</option><option value="admin">Admin</option></select>
            {message && <p className="text-xs text-neutral-400">{message}</p>}
            <button type="submit" className="w-full rounded-md bg-cyan-700 py-2.5 text-xs font-bold text-white hover:bg-cyan-600">Create user</button>
          </form>
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5"><h2 className="mb-3 text-sm font-semibold text-white">Users</h2><div className="space-y-2">{users?.map(user => <div key={user._id} className="flex items-center justify-between gap-3 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2.5"><div className="min-w-0"><p className="truncate text-xs text-white">{user.email}</p><p className="font-mono text-[10px] uppercase text-neutral-600">{user.role}</p></div><div className="flex shrink-0 items-center gap-3"><button onClick={() => handleResetPassword(user._id)} className="text-[10px] font-bold text-cyan-400 hover:text-cyan-300" title="Reset password">Reset password</button><button onClick={() => handleDelete(user._id)} className="text-red-400 hover:text-red-300" title="Delete user"><Trash2 className="size-4" /></button></div></div>)}</div></div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900"><div className="border-b border-neutral-800 px-5 py-4"><h2 className="text-sm font-semibold text-white">Recent activity</h2><p className="mt-1 text-xs text-neutral-500">The latest 100 administrator events.</p></div><div className="divide-y divide-neutral-800">{auditLogs?.map(log => <div key={log._id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"><div><p className="text-xs font-semibold capitalize text-white">{log.action.replaceAll('_', ' ')}</p><p className="text-[11px] text-neutral-500">{log.userEmail} · {log.entity}{log.details ? ` · ${log.details}` : ''}</p></div><time className="font-mono text-[10px] text-neutral-600">{new Date(log.createdAt).toLocaleString()}</time></div>)}{auditLogs?.length === 0 && <p className="p-5 text-xs text-neutral-500">No activity recorded yet.</p>}</div></div>
      )}
    </div>
  );
}
