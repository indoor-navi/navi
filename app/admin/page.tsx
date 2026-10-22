/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import AdminAuthGate from '@/components/AdminAuthGate';
import MapEditor3D from '@/components/MapEditor3D';
import { AnalyticsPanel, DashboardPanel, DestinationsPanel, RoutesPanel } from '@/components/AdminPanels';
import {
  Boxes, Compass, LayoutDashboard, LogOut, Map as MapIcon,
  Navigation, BarChart3, Bell, ChevronDown,
} from 'lucide-react';

type AdminTab = 'dashboard' | 'maps' | 'destinations' | 'routes' | 'analytics';

const tabs: Array<{ id: AdminTab; name: string; Icon: any }> = [
  { id: 'dashboard', name: 'Dashboard', Icon: LayoutDashboard },
  { id: 'maps', name: 'Building Maps', Icon: MapIcon },
  { id: 'destinations', name: 'Destinations', Icon: Compass },
  { id: 'routes', name: 'Routes', Icon: Navigation },
  { id: 'analytics', name: 'Analytics', Icon: BarChart3 },
];

function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<AdminTab>('maps');
  const [menuOpen, setMenuOpen] = useState(false);
  const [token] = useState(() => typeof window === 'undefined' ? '' : window.localStorage.getItem('navi_admin_session') || '');
  const logout = useMutation(api.auth.logout);
  const session = useQuery(api.auth.getSession, { token: token || undefined });
  const logs = useQuery(api.auth.listAuditLogs, { token }) as Array<{ _id: string; action: string; details?: string; createdAt: number }> | undefined;
  const [bellOpen, setBellOpen] = useState(false);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const email = session?.email ?? '';
  const initials = (email.split('@')[0] || 'AD').slice(0, 2).toUpperCase();
  const locate = (nodeId: string) => { setFocusNodeId(nodeId); setActiveTab('maps'); };

  const handleLogout = async () => {
    try { await logout({ token }); } catch { /* session may already be gone */ }
    window.localStorage.removeItem('navi_admin_session');
    window.dispatchEvent(new Event('navi-admin-auth-changed'));
    window.location.reload();
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0a0f1c] text-slate-200 overflow-hidden">
      {/* ── TOP BAR ── */}
      <header className="h-14 shrink-0 flex items-center gap-2 px-4 border-b border-white/10 bg-[#0d1526]">
        <div className="flex items-center gap-2 mr-6">
          <Boxes className="size-6 text-blue-500" />
          <span className="font-bold text-white tracking-tight">ODeL NavAdmin</span>
        </div>

        <nav className="flex items-center gap-1 h-full">
          {tabs.map(({ id, name, Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`relative flex items-center gap-2 px-4 h-full text-sm transition-colors ${
                activeTab === id ? 'text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className="size-4" />
              {name}
              {activeTab === id && (
                <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-blue-500" />
              )}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <div className="relative">
            <button onClick={() => { setBellOpen((o) => !o); setMenuOpen(false); }} className="p-2 rounded-lg hover:bg-white/5 relative" aria-label="Notifications">
              <Bell className="size-5 text-slate-400" />
              {(logs?.length ?? 0) > 0 && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-red-500" />}
            </button>
            {bellOpen && (
              <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto rounded-lg border border-white/10 bg-[#0d1526] shadow-2xl z-50">
                <p className="px-3 py-2 text-xs font-semibold text-slate-400 border-b border-white/10">Recent activity</p>
                {(logs ?? []).slice(0, 10).map((l) => (
                  <div key={l._id} className="px-3 py-2 text-xs border-b border-white/5">
                    <p className="text-slate-200">{l.action.replace(/_/g, ' ')} <span className="text-slate-500">{l.details ?? ''}</span></p>
                    <p className="text-slate-500">{new Date(l.createdAt).toLocaleString()}</p>
                  </div>
                ))}
                {!(logs?.length) && <p className="px-3 py-4 text-xs text-slate-500">Nothing new.</p>}
                <button onClick={() => { setActiveTab('analytics'); setBellOpen(false); }} className="w-full px-3 py-2 text-xs text-blue-400 hover:bg-white/5">View all activity</button>
              </div>
            )}
          </div>
          <div className="relative">
            <button
              onClick={() => { setMenuOpen((o) => !o); setBellOpen(false); }}
              className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-lg hover:bg-white/5"
            >
              <span className="size-8 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold text-white">
                {initials}
              </span>
              <span className="text-left hidden sm:block">
                <span className="block text-xs font-semibold text-white leading-tight capitalize">{session?.role ?? 'Administrator'}</span>
                <span className="block text-[10px] text-slate-500 leading-tight">{email}</span>
              </span>
              <ChevronDown className="size-4 text-slate-500" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 mt-2 w-44 rounded-lg border border-white/10 bg-[#0d1526] shadow-2xl py-1 z-50">
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-white/5"
                >
                  <LogOut className="size-4" /> Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── BODY ── */}
      <div className="flex-1 min-h-0">
        {/* the map stays mounted so camera, nodes and selection survive tab switches */}
        <div className={activeTab === 'maps' ? 'h-full' : 'hidden'}>
          <MapEditor3D focusNodeId={focusNodeId} onFocusDone={() => setFocusNodeId(null)} />
        </div>
        {activeTab === 'dashboard' && <DashboardPanel onOpenMap={() => setActiveTab('maps')} />}
        {activeTab === 'destinations' && <DestinationsPanel onLocate={locate} />}
        {activeTab === 'routes' && <RoutesPanel onLocate={locate} />}
        {activeTab === 'analytics' && <AnalyticsPanel />}
      </div>
    </div>
  );
}

export default function AdminPage() {
  return (
    <AdminAuthGate>
      <AdminDashboard />
    </AdminAuthGate>
  );
}
