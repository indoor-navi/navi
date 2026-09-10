'use client';

import React, { startTransition, useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import AdminAuthGate from '@/components/AdminAuthGate';
import { ADMIN_AUTH_CHANGED_EVENT } from '@/components/authEvents';
import ManageSettings from '@/components/ManageSettings';
import {
  Layers, MapPin, Compass, Navigation, Plus, Info, Upload, FileImage,
  Loader2, Link2, ChevronLeft, ChevronRight, Trash2, GripVertical,
  X, Check, Move, Bot, Users, LogOut
} from 'lucide-react';

type LandmarkType = 'corridor' | 'staircase' | 'elevator' | 'double-door';

interface NodePos {
  id: string;
  label: string;
  x: number;
  y: number;
}

function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<'floors' | 'nodes' | 'destinations' | 'connections' | 'qrCodes' | 'assistant' | 'settings'>('connections');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const data = useQuery(api.admin.listAllData);
  const [sessionToken] = useState(() => typeof window === 'undefined' ? '' : window.localStorage.getItem('navi_admin_session') || '');
  const session = useQuery(api.auth.getSession, { token: sessionToken || undefined });

  const insertFloor = useMutation(api.admin.addFloor);
  const updateFloor = useMutation(api.admin.updateFloor);
  const deleteFloor = useMutation(api.admin.deleteFloor);
  const insertNode = useMutation(api.admin.addNode);
  const updateNode = useMutation(api.admin.updateNode);
  const deleteNode = useMutation(api.admin.deleteNode);
  const insertDestination = useMutation(api.admin.addDestination);
  const updateDestination = useMutation(api.admin.updateDestination);
  const deleteDestination = useMutation(api.admin.deleteDestination);
  const insertConnection = useMutation(api.admin.addConnection);
  const updateConnection = useMutation(api.admin.updateConnection);
  const deleteConnection = useMutation(api.admin.deleteConnection);
  const getUploadUrl = useMutation(api.admin.generateUploadUrl);
  const updateAssistantConfig = useMutation(api.admin.updateAssistantConfig);
  const logout = useMutation(api.auth.logout);

  // Forms
  const [floorForm, setFloorForm] = useState({ level: 0, name: '' });
  const [nodeForm, setNodeForm] = useState({ floorId: '', label: '', isLandmark: false, landmarkType: 'corridor' as LandmarkType });
  const [destForm, setDestForm] = useState({ name: '', aliasesRaw: '', floorId: '', description: '', targetNodeId: '' });
  const [connForm, setConnForm] = useState({
    fromNodeId: '', toNodeId: '',
    textDirection: '', audioDescription: '', estimatedWalkingTime: 30
  });
  const [assistantForm, setAssistantForm] = useState({
    assistantName: 'NaviSense',
    personality: 'Warm, welcoming, and conversational. Be concise but friendly.',
    task: 'Help visitors navigate the building and answer questions about its rooms, facilities, and information.',
  });
  useEffect(() => {
    const config = data?.assistantConfig;
    if (config) {
      startTransition(() => {
        setAssistantForm({
          assistantName: config.assistantName,
          personality: config.personality,
          task: config.task,
        });
      });
    }
  }, [data?.assistantConfig]);

  // Graph canvas
  const canvasRef = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<NodePos[]>([]);
  const [draggingNode, setDraggingNode] = useState<string | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activeDraft, setActiveDraft] = useState(false);

  // Files
  const [floorFile, setFloorFile] = useState<File | null>(null);
  const [nodeFile, setNodeFile] = useState<File | null>(null);
  const [connFile, setConnFile] = useState<File | null>(null);
  const floorFileRef = useRef<HTMLInputElement>(null);
  const nodeFileRef = useRef<HTMLInputElement>(null);
  const connFileRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editingFloorId, setEditingFloorId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingDestinationId, setEditingDestinationId] = useState<string | null>(null);
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null);

  // ─── Helpers ───
  const uploadToConvex = async (file: File): Promise<string> => {
    setUploading(true);
    try {
      const url = await getUploadUrl({ token: sessionToken });
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
      if (!res.ok) throw new Error('Upload failed');
      const { storageId } = await res.json();
      return storageId;
    } finally { setUploading(false); }
  };

  const getFloorName = (id: string) => data?.floors?.find(f => f._id === id)?.name || 'Unknown';
  const getNodeLabel = (id: string) => data?.nodes?.find(n => n._id === id)?.label || 'Unknown';
  const getStorageAssetUrl = (value?: string) => {
    if (!value) return '';
    if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:')) return value;
    const base = (process.env.NEXT_PUBLIC_CONVEX_URL || '').replace(/\/$/, '');
    const clean = value.startsWith('/') ? value.slice(1) : value;
    return base ? `${base}/api/storage/${clean}` : clean;
  };

  // ─── Layout nodes in circle on first data load ───
  useEffect(() => {
    if (data?.nodes && positions.length === 0) {
      const nodes = data.nodes;
      const cx = 400, cy = 300, r = Math.min(280, nodes.length * 35);
      setPositions(nodes.map((n, i) => ({
        id: n._id,
        label: n.label,
        x: cx + r * Math.cos((i / Math.max(nodes.length, 1)) * 2 * Math.PI),
        y: cy + r * Math.sin((i / Math.max(nodes.length, 1)) * 2 * Math.PI),
      })));
    }
  }, [data?.nodes]);

  // ─── Canvas mouse tracking ───
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setMousePos({ x, y });

      if (draggingNode) {
        setPositions(prev => prev.map(p => p.id === draggingNode ? { ...p, x, y } : p));
      }
    };
    const onUp = () => {
      setDraggingNode(null);
      setConnectingFrom(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [draggingNode]);

  // ─── Node interactions ───
  const onNodeMouseDown = (nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedNodeId(nodeId);
    // If clicking the connect handle area (right side of circle), start connection
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const localX = e.clientX - rect.left;
    if (localX > 28) {
      setConnectingFrom(nodeId);
    } else {
      setDraggingNode(nodeId);
    }
  };

  const onNodeMouseUp = (nodeId: string) => {
    if (connectingFrom && connectingFrom !== nodeId) {
      setConnForm(prev => ({ ...prev, fromNodeId: connectingFrom, toNodeId: nodeId }));
      setActiveDraft(true);
    }
    setConnectingFrom(null);
  };

  const onCanvasClick = () => setSelectedNodeId(null);

  // ─── Submit handlers ───
  const resetFloorForm = () => {
    setFloorForm({ level: 0, name: '' });
    setFloorFile(null);
    setEditingFloorId(null);
    if (floorFileRef.current) floorFileRef.current.value = '';
  };

  const resetNodeForm = () => {
    setNodeForm({ floorId: '', label: '', isLandmark: false, landmarkType: 'corridor' });
    setNodeFile(null);
    setEditingNodeId(null);
    if (nodeFileRef.current) nodeFileRef.current.value = '';
  };

  const resetDestinationForm = () => {
    setDestForm({ name: '', aliasesRaw: '', floorId: '', description: '', targetNodeId: '' });
    setEditingDestinationId(null);
  };

  const resetConnectionForm = () => {
    setConnForm({ fromNodeId: '', toNodeId: '', textDirection: '', audioDescription: '', estimatedWalkingTime: 30 });
    setConnFile(null);
    setActiveDraft(false);
    setEditingConnectionId(null);
    if (connFileRef.current) connFileRef.current.value = '';
  };

  const handleFloor = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true);
    try {
      let url: string | undefined = undefined;
      if (floorFile) url = await uploadToConvex(floorFile);

      if (editingFloorId) {
        await updateFloor({ token: sessionToken,
          _id: editingFloorId as Id<"floors">,
          level: Number(floorForm.level),
          name: floorForm.name,
          floorPlanUrl: url ?? data?.floors?.find(f => f._id === editingFloorId)?.floorPlanUrl,
        });
      } else {
        await insertFloor({ token: sessionToken, level: Number(floorForm.level), name: floorForm.name, floorPlanUrl: url });
      }

      resetFloorForm();
    } catch (err) { console.error(err); alert('Error saving floor'); }
    setLoading(false);
  };

  const handleNode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nodeForm.floorId) return alert('Select a floor');
    if (!editingNodeId && !nodeFile) return alert('A video clip is required for every node');
    setLoading(true);
    try {
      const currentVideoClipUrl = editingNodeId ? data?.nodes?.find(n => n._id === editingNodeId)?.videoClipUrl : '';
      const nextVideoClipUrl = editingNodeId
        ? (nodeFile ? await uploadToConvex(nodeFile as File) : currentVideoClipUrl || '')
        : nodeFile ? await uploadToConvex(nodeFile as File) : '';

      if (!nextVideoClipUrl) throw new Error('A node video clip is required');

      if (editingNodeId) {
        await updateNode({ token: sessionToken,
          _id: editingNodeId as Id<"nodes">,
          floorId: nodeForm.floorId as Id<"floors">,
          label: nodeForm.label,
          isLandmark: nodeForm.isLandmark,
          videoClipUrl: nextVideoClipUrl,
          landmarkType: nodeForm.isLandmark ? nodeForm.landmarkType : undefined,
        });
      } else {
        await insertNode({ token: sessionToken,
          floorId: nodeForm.floorId as Id<"floors">,
          label: nodeForm.label,
          isLandmark: nodeForm.isLandmark,
          videoClipUrl: nextVideoClipUrl,
          landmarkType: nodeForm.isLandmark ? nodeForm.landmarkType : undefined,
        });
      }
      resetNodeForm();
    } catch (err) { console.error(err); alert('Error saving node'); }
    setLoading(false);
  };

  const handleDest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!destForm.floorId || !destForm.targetNodeId) return alert('Fill required fields');
    setLoading(true);
    try {
      const aliases = destForm.aliasesRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      if (editingDestinationId) {
        await updateDestination({ token: sessionToken,
          _id: editingDestinationId as Id<"destinations">,
          name: destForm.name,
          aliases,
          floorId: destForm.floorId as Id<"floors">,
          description: destForm.description,
          targetNodeId: destForm.targetNodeId as Id<"nodes">,
        });
      } else {
        await insertDestination({ token: sessionToken,
          name: destForm.name, aliases,
          floorId: destForm.floorId as Id<"floors">,
          description: destForm.description,
          targetNodeId: destForm.targetNodeId as Id<"nodes">,
        });
      }
      resetDestinationForm();
    } catch (err) { console.error(err); alert('Error saving destination'); }
    setLoading(false);
  };

  const handleConn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connForm.fromNodeId || !connForm.toNodeId) return alert('Select start and end nodes');
    if (connForm.fromNodeId === connForm.toNodeId) return alert('Cannot connect node to itself');
    setLoading(true);
    try {
      if (editingConnectionId) {
        await updateConnection({ token: sessionToken,
          _id: editingConnectionId as Id<"connections">,
          fromNodeId: connForm.fromNodeId as Id<"nodes">,
          toNodeId: connForm.toNodeId as Id<"nodes">,
          textDirection: connForm.textDirection,
          audioDescription: connForm.audioDescription,
          estimatedWalkingTime: Number(connForm.estimatedWalkingTime),
        });
      } else {
        await insertConnection({ token: sessionToken,
          fromNodeId: connForm.fromNodeId as Id<"nodes">,
          toNodeId: connForm.toNodeId as Id<"nodes">,
          textDirection: connForm.textDirection,
          audioDescription: connForm.audioDescription,
          estimatedWalkingTime: Number(connForm.estimatedWalkingTime),
        });
      }
      resetConnectionForm();
    } catch (err) { console.error(err); alert('Error saving connection'); }
    setLoading(false);
  };

  const handleAssistantConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await updateAssistantConfig({ token: sessionToken, ...assistantForm });
      alert('Assistant configuration saved');
    } catch (err) {
      console.error(err);
      alert('Error saving assistant configuration');
    }
    setLoading(false);
  };

  // ─── Sidebar config ───
  const navItems = [
    { key: 'floors' as const, icon: Layers, label: 'Floors', count: data?.floors?.length || 0 },
    { key: 'nodes' as const, icon: MapPin, label: 'Nodes', count: data?.nodes?.length || 0 },
    { key: 'destinations' as const, icon: Compass, label: 'Destinations', count: data?.destinations?.length || 0 },
    { key: 'connections' as const, icon: Navigation, label: 'Graph', count: data?.connections?.length || 0 },
    { key: 'qrCodes' as const, icon: Link2, label: 'QR Codes', count: data?.qrCodes?.length || 0 },
    { key: 'assistant' as const, icon: Bot, label: 'Assistant', count: data?.assistantConfig ? 1 : 0 },
    { key: 'settings' as const, icon: Users, label: 'Manage settings', count: 0 },
  ];
  const visibleNavItems = session?.role === 'admin' ? navItems : navItems.filter(item => item.key !== 'settings' && item.key !== 'assistant');

  const selectedNode = positions.find(p => p.id === selectedNodeId);
  const originPos = positions.find(p => p.id === connectingFrom);
  const isEditingConnection = Boolean(editingConnectionId);

  const buildQrImageUrl = (content: string) => {
    if (!content) return '';
    return `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(content)}&size=1500x1500&margin=2`;
  };

  const downloadQrCard = async (code: any) => {
    const qrUrl = buildQrImageUrl(code.content);
    if (!qrUrl) return;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = 1400;
    canvas.height = 1700;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const qrImage = new Image();
    qrImage.crossOrigin = 'anonymous';
    qrImage.onload = () => {
      const margin = 180;
      const qrSize = 900;
      const x = (canvas.width - qrSize) / 2;
      const y = 180;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, qrSize, qrSize);
      ctx.drawImage(qrImage, x, y, qrSize, qrSize);

      ctx.fillStyle = '#111827';
      ctx.font = '700 54px Arial';
      ctx.textAlign = 'center';
      const lines = code.label ? [code.label] : ['QR Code'];
      const textY = 1280;
      lines.forEach((line, index) => {
        ctx.fillText(line, canvas.width / 2, textY + index * 62);
      });

      ctx.font = '500 30px Arial';
      ctx.fillStyle = '#4b5563';
      ctx.fillText(code.entityType?.toUpperCase() || 'DESTINATION', canvas.width / 2, 1420);

      const link = document.createElement('a');
      link.download = `${(code.label || 'qr-code').replace(/\s+/g, '-').toLowerCase()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    };
    qrImage.src = qrUrl;
  };

  const startEditFloor = (floor: any) => {
    setEditingFloorId(floor._id);
    setFloorForm({ level: floor.level, name: floor.name });
    setFloorFile(null);
  };

  const startEditNode = (node: any) => {
    setEditingNodeId(node._id);
    setNodeForm({
      floorId: node.floorId,
      label: node.label,
      isLandmark: node.isLandmark,
      landmarkType: node.landmarkType || 'corridor',
    });
    setNodeFile(null);
  };

  const startEditDestination = (destination: any) => {
    setEditingDestinationId(destination._id);
    setDestForm({
      name: destination.name,
      aliasesRaw: destination.aliases?.join(', ') || '',
      floorId: destination.floorId,
      description: destination.description,
      targetNodeId: destination.targetNodeId,
    });
  };

  const startEditConnection = (connection: any) => {
    setEditingConnectionId(connection._id);
    setConnForm({
      fromNodeId: connection.fromNodeId,
      toNodeId: connection.toNodeId,
      textDirection: connection.textDirection,
      audioDescription: connection.audioDescription,
      estimatedWalkingTime: connection.estimatedWalkingTime,
    });
    setActiveDraft(true);
  };

  const handleDeleteFloor = async (id: string) => {
    if (!confirm('Delete this floor and its related data?')) return;
    await deleteFloor({ token: sessionToken, _id: id as Id<"floors"> });
  };

  const handleDeleteNode = async (id: string) => {
    if (!confirm('Delete this node and any related edges/destinations?')) return;
    await deleteNode({ token: sessionToken, _id: id as Id<"nodes"> });
  };

  const handleDeleteDestination = async (id: string) => {
    if (!confirm('Delete this destination?')) return;
    await deleteDestination({ token: sessionToken, _id: id as Id<"destinations"> });
  };

  const handleDeleteConnection = async (id: string) => {
    if (!confirm('Delete this edge?')) return;
    await deleteConnection({ token: sessionToken, _id: id as Id<"connections"> });
  };

  return (
    <div className="h-screen bg-neutral-950 text-neutral-200 flex font-sans overflow-hidden selection:bg-cyan-500/30">
      {/* ─── Sidebar ─── */}
      <aside className={`flex flex-col border-r border-neutral-800 bg-neutral-900 transition-all duration-300 ${sidebarCollapsed ? 'w-16' : 'w-60'}`}>
        <div className="h-14 flex items-center justify-between px-4 border-b border-neutral-800">
          {!sidebarCollapsed && <span className="text-sm font-bold tracking-tight text-white">NaviCMS</span>}
          <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} className="p-1.5 rounded-md hover:bg-neutral-800 text-neutral-400 transition-colors">
            {sidebarCollapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
          </button>
        </div>

        <nav className="flex-1 py-3 px-2 space-y-1">
          {visibleNavItems.map(item => {
            const active = activeTab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setActiveTab(item.key)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-all
                  ${active ? 'bg-cyan-600 text-white' : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'}
                  ${sidebarCollapsed ? 'justify-center' : ''}
                `}
                title={sidebarCollapsed ? item.label : undefined}
              >
                <item.icon className="size-4 shrink-0" />
                {!sidebarCollapsed && (
                  <>
                    <span className="flex-1 text-left">{item.label}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-md ${active ? 'bg-white/20' : 'bg-neutral-800 text-neutral-500'}`}>
                      {item.count}
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-neutral-800">
          <div className={`flex items-center gap-2 text-[10px] text-neutral-500 ${sidebarCollapsed ? 'justify-center' : ''}`}>
            <div className="size-2 rounded-full bg-emerald-500" />
            {!sidebarCollapsed && <span>System Online</span>}
          </div>
        </div>
      </aside>

      {/* ─── Main ─── */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-14 border-b border-neutral-800 flex items-center justify-between px-6 bg-neutral-900/30">
          <h1 className="text-sm font-semibold text-white">
            {activeTab === 'floors' && 'Floor Configuration'}
            {activeTab === 'nodes' && 'Waypoint Nodes'}
            {activeTab === 'destinations' && 'Destination Endpoints'}
            {activeTab === 'connections' && 'Graph Topology Editor'}
            {activeTab === 'qrCodes' && 'QR Code Registry'}
            {activeTab === 'assistant' && 'Assistant Configuration'}
            {activeTab === 'settings' && 'Manage Settings'}
          </h1>
          <div className="flex shrink-0 items-center gap-3 text-[10px] font-mono text-neutral-500">
            {session && <span className="hidden text-neutral-300 sm:inline">Signed in as {session.email}</span>}
            {session && <button type="button" onClick={async () => { await logout({ token: sessionToken }); window.localStorage.removeItem('navi_admin_session'); window.dispatchEvent(new Event(ADMIN_AUTH_CHANGED_EVENT)); }} className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-neutral-700 px-2.5 py-1.5 text-neutral-300 hover:border-cyan-600 hover:text-white" title="Sign out"><LogOut className="size-3.5" />Sign out</button>}
            {data ? `${data.floors.length} floors · ${data.nodes.length} nodes · ${data.connections.length} edges` : 'Loading...'}
          </div>
        </header>

        {/* Content */}
        <div className={`flex-1 overflow-auto p-6 ${session?.role === 'viewer' ? '[&_form]:hidden [&_button]:hidden' : ''}`}>
          {activeTab === 'settings' ? (
            <ManageSettings token={sessionToken} />
          ) : activeTab === 'assistant' ? (
            <div className="max-w-3xl mx-auto">
              <div className="bg-neutral-900 rounded-xl border border-neutral-800 p-5">
                <div className="flex items-center gap-2 mb-1">
                  <Bot className="size-4 text-cyan-400" />
                  <h2 className="text-sm font-semibold text-white">LLM personality and task</h2>
                </div>
                <p className="text-xs text-neutral-500 mb-5">These values are stored in Convex and used by the voice assistant when building its system prompt.</p>
                <form onSubmit={handleAssistantConfig} className="space-y-4">
                  <div>
                    <label className="text-[10px] font-bold text-neutral-500 uppercase block mb-1">Assistant name</label>
                    <input type="text" value={assistantForm.assistantName} onChange={e => setAssistantForm({ ...assistantForm, assistantName: e.target.value })} className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-600" required />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-neutral-500 uppercase block mb-1">Personality</label>
                    <textarea value={assistantForm.personality} onChange={e => setAssistantForm({ ...assistantForm, personality: e.target.value })} rows={5} className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-600 resize-y" required />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-neutral-500 uppercase block mb-1">Task</label>
                    <textarea value={assistantForm.task} onChange={e => setAssistantForm({ ...assistantForm, task: e.target.value })} rows={5} className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-600 resize-y" required />
                  </div>
                  <button type="submit" disabled={loading} className="w-full bg-cyan-700 hover:bg-cyan-600 disabled:opacity-40 text-white text-xs font-bold py-2.5 rounded-md transition-colors">
                    {loading ? 'Saving...' : 'Save assistant configuration'}
                  </button>
                </form>
              </div>
            </div>
          ) : activeTab === 'qrCodes' ? (
            <div className="max-w-7xl mx-auto">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-[0.24em] text-cyan-400">Print-ready</p>
                  <h2 className="text-base font-semibold text-white mt-1">QR labels for A4 printing</h2>
                </div>
                <button
                  type="button"
                  onClick={() => data?.qrCodes?.forEach((code: any) => downloadQrCard(code))}
                  className="px-3 py-2 bg-cyan-700 hover:bg-cyan-600 text-white text-xs font-bold rounded-md"
                >
                  Download all
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {(data?.qrCodes || []).map((code: any) => (
                  <div key={code._id} className="rounded-2xl border border-neutral-800 bg-white p-5 text-black shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[10px] font-mono uppercase tracking-[0.26em] text-zinc-500">{code.entityType}</span>
                      <button
                        type="button"
                        onClick={() => downloadQrCard(code)}
                        className="px-2 py-1 bg-neutral-900 text-white text-[10px] font-bold rounded-md"
                      >
                        Download
                      </button>
                    </div>
                    <div className="flex items-center justify-center rounded-xl border border-zinc-200 bg-white p-4">
                      <img
                        src={buildQrImageUrl(code.content)}
                        alt={`${code.label} QR code`}
                        className="w-full max-w-[360px] aspect-square object-contain"
                      />
                    </div>
                    <div className="mt-4 text-center">
                      <p className="text-xl font-bold truncate text-black">{code.label}</p>
                      <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-zinc-500 mt-2">Scan to continue</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : activeTab === 'connections' ? (
            <div className="h-full flex gap-4">
              {/* Canvas */}
              <div
                ref={canvasRef}
                className="flex-1 bg-neutral-900 rounded-xl border border-neutral-800 relative overflow-hidden cursor-crosshair select-none"
                onClick={onCanvasClick}
              >
                <div className="absolute top-3 left-3 flex items-center gap-2 text-[10px] font-mono text-neutral-500 bg-neutral-950/80 px-2 py-1 rounded border border-neutral-800">
                  <Move className="size-3" /> Drag to move · Drag right edge to connect
                </div>

                <svg className="absolute inset-0 w-full h-full pointer-events-none">
                  <defs>
                    <marker id="arr" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                      <path d="M0 1 L10 5 L0 9z" fill="#52525b" />
                    </marker>
                    <marker id="arr-active" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                      <path d="M0 1 L10 5 L0 9z" fill="#0891b2" />
                    </marker>
                  </defs>

                  {/* Existing edges */}
                  {data?.connections?.map(c => {
                    const s = positions.find(p => p.id === c.fromNodeId);
                    const t = positions.find(p => p.id === c.toNodeId);
                    if (!s || !t) return null;
                    return (
                      <line key={c._id} x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                        stroke="#27272a" strokeWidth={1.5} markerEnd="url(#arr)" />
                    );
                  })}

                  {/* Draft edge */}
                  {connectingFrom && originPos && (
                    <line x1={originPos.x} y1={originPos.y} x2={mousePos.x} y2={mousePos.y}
                      stroke="#0891b2" strokeWidth={2} strokeDasharray="4 4" markerEnd="url(#arr-active)" />
                  )}
                </svg>

                {/* Nodes */}
                {positions.map(node => {
                  const isSelected = selectedNodeId === node.id;
                  const isDraft = connForm.fromNodeId === node.id || connForm.toNodeId === node.id;
                  return (
                    <div
                      key={node.id}
                      className="absolute"
                      style={{ left: node.x, top: node.y, transform: 'translate(-50%, -50%)' }}
                      onMouseDown={e => onNodeMouseDown(node.id, e)}
                      onMouseUp={() => onNodeMouseUp(node.id)}
                    >
                      <div className={`relative flex flex-col items-center group cursor-grab active:cursor-grabbing ${draggingNode === node.id ? 'cursor-grabbing' : ''}`}>
                        {/* Circle node */}
                        <div className={`
                          size-10 rounded-full border-2 flex items-center justify-center transition-all
                          ${isSelected ? 'border-cyan-500 bg-cyan-950/40 shadow-lg shadow-cyan-500/10' :
                            isDraft ? 'border-cyan-600 bg-cyan-950/30' :
                            'border-neutral-700 bg-neutral-800 hover:border-neutral-600'}
                        `}>
                          <MapPin className={`size-4 ${isSelected ? 'text-cyan-400' : 'text-neutral-400'}`} />
                        </div>
                        {/* Label */}
                        <span className={`
                          mt-1.5 text-[10px] font-medium whitespace-nowrap px-1.5 py-0.5 rounded
                          ${isSelected ? 'text-cyan-300 bg-cyan-950/50' : 'text-neutral-400'}
                        `}>
                          {node.label}
                        </span>
                        {/* Connection handle (invisible hit area on right) */}
                        <div className="absolute -right-2 top-1/2 -translate-y-1/2 size-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <div className="size-2 rounded-full bg-cyan-500" />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Side panel */}
              <div className="w-80 flex flex-col gap-3 shrink-0">
                {activeDraft ? (
                  <div className="bg-neutral-900 rounded-xl border border-neutral-800 p-4 space-y-3">
                    <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
                      <span className="text-[10px] font-mono font-bold text-cyan-400 uppercase tracking-wider">{isEditingConnection ? 'Edit Edge' : 'New Edge'}</span>
                      <button onClick={() => { resetConnectionForm(); setActiveDraft(false); setConnForm(prev => ({ ...prev, fromNodeId: '', toNodeId: '' })); }} className="text-neutral-500 hover:text-white">
                        <X className="size-3.5" />
                      </button>
                    </div>
                    <div className="text-[11px] font-mono space-y-1 text-neutral-400">
                      <div>From: <span className="text-white">{getNodeLabel(connForm.fromNodeId)}</span></div>
                      <div>To: <span className="text-cyan-400">{getNodeLabel(connForm.toNodeId)}</span></div>
                    </div>
                    <form onSubmit={handleConn} className="space-y-3">
                      <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-2 text-[10px] text-neutral-400">
                        Video clips are attached to nodes, not connections. The route visuals will come from the node video for each step.
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-neutral-500 uppercase block mb-1">Text Direction</label>
                        <input type="text" value={connForm.textDirection} onChange={e => setConnForm({ ...connForm, textDirection: e.target.value })}
                          className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-600" required />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-neutral-500 uppercase block mb-1">Audio Description</label>
                        <textarea value={connForm.audioDescription} onChange={e => setConnForm({ ...connForm, audioDescription: e.target.value })} rows={2}
                          className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-600 resize-none" required />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-neutral-500 uppercase block mb-1">Walk Time (s)</label>
                        <input type="number" value={connForm.estimatedWalkingTime} onChange={e => setConnForm({ ...connForm, estimatedWalkingTime: parseInt(e.target.value) || 0 })}
                          className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-600" required />
                      </div>
                      <div className="flex gap-2">
                        <button type="submit" disabled={loading || uploading}
                          className="flex-1 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-40 text-white text-xs font-bold py-2 rounded-md transition-colors flex items-center justify-center gap-2">
                          {(loading || uploading) && <Loader2 className="size-3.5 animate-spin" />}
                          {uploading ? 'Uploading...' : loading ? (isEditingConnection ? 'Updating...' : 'Saving...') : isEditingConnection ? 'Update Edge' : 'Create Edge'}
                        </button>
                        {isEditingConnection && (
                          <button type="button" onClick={() => { resetConnectionForm(); setActiveDraft(false); }} className="px-3 py-2 bg-neutral-800 border border-neutral-700 text-neutral-300 rounded-md text-xs font-bold">Cancel</button>
                        )}
                      </div>
                    </form>
                  </div>
                ) : selectedNode ? (
                  <div className="bg-neutral-900 rounded-xl border border-neutral-800 p-4">
                    <div className="flex items-center justify-between border-b border-neutral-800 pb-2 mb-3">
                      <span className="text-[10px] font-mono font-bold text-neutral-400 uppercase tracking-wider">Node Details</span>
                      <button onClick={() => setSelectedNodeId(null)} className="text-neutral-500 hover:text-white"><X className="size-3.5" /></button>
                    </div>
                    <div className="space-y-2 text-xs font-mono">
                      <div className="text-white font-semibold text-sm">{selectedNode.label}</div>
                      <div className="text-neutral-500">ID: <span className="text-neutral-300">{selectedNode.id}</span></div>
                      <div className="text-neutral-500">Position: <span className="text-neutral-300">{Math.round(selectedNode.x)}, {Math.round(selectedNode.y)}</span></div>
                      <div className="text-neutral-500">Floor: <span className="text-neutral-300">{getFloorName(data?.nodes?.find(n => n._id === selectedNode.id)?.floorId || '')}</span></div>
                      {data?.nodes?.find(n => n._id === selectedNode.id)?.isLandmark && (
                        <span className="inline-block text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-900 px-1.5 py-0.5 rounded">Landmark</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="bg-neutral-900/50 rounded-xl border border-dashed border-neutral-800 p-6 text-center">
                    <Link2 className="size-6 text-neutral-700 mx-auto mb-2" />
                    <p className="text-[11px] text-neutral-500">Select a node or drag between nodes to create an edge.</p>
                  </div>
                )}

                {/* Connections list */}
                <div className="flex-1 bg-neutral-900 rounded-xl border border-neutral-800 overflow-hidden flex flex-col">
                  <div className="px-3 py-2 border-b border-neutral-800 text-[10px] font-bold text-neutral-500 uppercase tracking-wider">Edges</div>
                  <div className="flex-1 overflow-auto p-2 space-y-1">
                    {!data ? (
                      <div className="text-[11px] text-neutral-600 text-center py-4">Loading...</div>
                    ) : data.connections.length === 0 ? (
                      <div className="text-[11px] text-neutral-600 text-center py-4">No edges</div>
                    ) : data.connections.map(c => (
                      <div key={c._id} className="flex items-center gap-2 text-[10px] font-mono bg-neutral-950 border border-neutral-800 rounded-md px-2 py-1.5">
                        <div className="size-1.5 rounded-full bg-neutral-600 shrink-0" />
                        <span className="truncate text-neutral-400">{getNodeLabel(c.fromNodeId)}</span>
                        <Navigation className="size-3 text-neutral-700 shrink-0" />
                        <span className="truncate text-neutral-300">{getNodeLabel(c.toNodeId)}</span>
                        <div className="ml-auto flex items-center gap-1.5">
                          <button type="button" onClick={() => startEditConnection(c)} className="text-[9px] text-cyan-400 hover:text-cyan-300">Edit</button>
                          <button type="button" onClick={() => handleDeleteConnection(c._id)} className="text-[9px] text-red-400 hover:text-red-300">Delete</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Form */}
              <div className="bg-neutral-900 rounded-xl border border-neutral-800 p-5 h-fit">
                <h2 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2 mb-4">
                  <Plus className="size-3.5 text-cyan-500" /> Add {activeTab.slice(0, -1)}
                </h2>

                {activeTab === 'floors' && (
                  <form onSubmit={handleFloor} className="space-y-3">
                    <div>
                      <label className="text-[10px] font-bold text-neutral-500 uppercase block mb-1">Level</label>
                      <input type="number" value={floorForm.level} onChange={e => setFloorForm({ ...floorForm, level: parseInt(e.target.value) || 0 })}
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-600" required />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-neutral-500 uppercase block mb-1">Name</label>
                      <input type="text" value={floorForm.name} onChange={e => setFloorForm({ ...floorForm, name: e.target.value })}
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-600" required />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-neutral-500 uppercase block mb-1">Blueprint</label>
                      <div className="relative border border-dashed border-neutral-700 rounded-lg p-4 hover:border-neutral-600 transition-colors cursor-pointer">
                        <input type="file" accept="image/*" ref={floorFileRef} onChange={e => setFloorFile(e.target.files?.[0] || null)} className="absolute inset-0 opacity-0 cursor-pointer" />
                        <div className="flex items-center gap-2 text-xs text-neutral-400">
                          {floorFile ? <><FileImage className="size-4 text-cyan-500" /> {floorFile.name}</> : <><Upload className="size-4" /> Select blueprint image</>}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button type="submit" disabled={loading || uploading} className="flex-1 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-40 text-white text-xs font-bold py-2.5 rounded-md transition-colors flex items-center justify-center gap-2">
                        {(loading || uploading) && <Loader2 className="size-3.5 animate-spin" />}
                        {uploading ? 'Uploading...' : loading ? (editingFloorId ? 'Updating...' : 'Saving...') : editingFloorId ? 'Update Floor' : 'Save Floor'}
                      </button>
                      {editingFloorId && (
                        <button type="button" onClick={resetFloorForm} className="px-3 py-2.5 bg-neutral-800 border border-neutral-700 text-neutral-300 rounded-md text-xs font-bold">Cancel</button>
                      )}
                    </div>
                  </form>
                )}

                {activeTab === 'nodes' && (
                  <form onSubmit={handleNode} className="space-y-3">
                    <div>
                      <label className="text-[10px] font-bold text-neutral-500 uppercase block mb-1">Floor</label>
                      <select value={nodeForm.floorId} onChange={e => setNodeForm({ ...nodeForm, floorId: e.target.value })}
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-600" required>
                        <option value="">Select floor</option>
                        {data?.floors?.map(f => <option key={f._id} value={f._id}>{f.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-neutral-500 uppercase block mb-1">Label</label>
                      <input type="text" value={nodeForm.label} onChange={e => setNodeForm({ ...nodeForm, label: e.target.value })}
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-600" required />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-neutral-500 uppercase block mb-1">Node video clip</label>
                      <div className="relative border border-dashed border-neutral-700 rounded-lg p-3 hover:border-neutral-600 transition-colors cursor-pointer">
                        <input type="file" accept="video/*" ref={nodeFileRef} onChange={e => setNodeFile(e.target.files?.[0] || null)} className="absolute inset-0 opacity-0 cursor-pointer" />
                        <div className="flex items-center gap-2 text-[11px] text-neutral-400">
                          {nodeFile ? <><Check className="size-3.5 text-emerald-500" /> {nodeFile.name}</> : <><Upload className="size-3.5" /> Upload mp4 clip</>}
                        </div>
                      </div>
                      {(nodeFile || (editingNodeId && getStorageAssetUrl(data?.nodes?.find(n => n._id === editingNodeId)?.videoClipUrl))) && (
                        <div className="mt-3 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
                          <video
                            src={nodeFile ? URL.createObjectURL(nodeFile) : getStorageAssetUrl(data?.nodes?.find(n => n._id === editingNodeId)?.videoClipUrl)}
                            controls
                            muted
                            playsInline
                            className="h-32 w-full object-cover"
                          />
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 py-1">
                      <input type="checkbox" id="lm" checked={nodeForm.isLandmark} onChange={e => setNodeForm({ ...nodeForm, isLandmark: e.target.checked })}
                        className="size-4 rounded border-neutral-700 bg-neutral-950 text-cyan-600 focus:ring-0" />
                      <label htmlFor="lm" className="text-xs text-neutral-300 select-none cursor-pointer">Is Landmark</label>
                    </div>
                    {nodeForm.isLandmark && (
                      <div>
                        <label className="text-[10px] font-bold text-neutral-500 uppercase block mb-1">Type</label>
                        <select value={nodeForm.landmarkType} onChange={e => setNodeForm({ ...nodeForm, landmarkType: e.target.value as LandmarkType })}
                          className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-600">
                          <option value="corridor">Corridor</option>
                          <option value="staircase">Staircase</option>
                          <option value="elevator">Elevator</option>
                          <option value="double-door">Double Door</option>
                        </select>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button type="submit" disabled={loading} className="flex-1 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-40 text-white text-xs font-bold py-2.5 rounded-md transition-colors">
                        {loading ? (editingNodeId ? 'Updating...' : 'Saving...') : editingNodeId ? 'Update Node' : 'Save Node'}
                      </button>
                      {editingNodeId && (
                        <button type="button" onClick={resetNodeForm} className="px-3 py-2.5 bg-neutral-800 border border-neutral-700 text-neutral-300 rounded-md text-xs font-bold">Cancel</button>
                      )}
                    </div>
                  </form>
                )}

                {activeTab === 'destinations' && (
                  <form onSubmit={handleDest} className="space-y-3">
                    <div>
                      <label className="text-[10px] font-bold text-neutral-500 uppercase block mb-1">Name</label>
                      <input type="text" value={destForm.name} onChange={e => setDestForm({ ...destForm, name: e.target.value })}
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-600" required />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-neutral-500 uppercase block mb-1">Aliases (comma separated)</label>
                      <input type="text" value={destForm.aliasesRaw} onChange={e => setDestForm({ ...destForm, aliasesRaw: e.target.value })}
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-600" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-bold text-neutral-500 uppercase block mb-1">Floor</label>
                        <select value={destForm.floorId} onChange={e => setDestForm({ ...destForm, floorId: e.target.value })}
                          className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-600" required>
                          <option value="">Select</option>
                          {data?.floors?.map(f => <option key={f._id} value={f._id}>{f.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-neutral-500 uppercase block mb-1">Target Node</label>
                        <select value={destForm.targetNodeId} onChange={e => setDestForm({ ...destForm, targetNodeId: e.target.value })}
                          className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-600" required>
                          <option value="">Select</option>
                          {data?.nodes?.map(n => <option key={n._id} value={n._id}>{n.label}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-neutral-500 uppercase block mb-1">Description</label>
                      <textarea value={destForm.description} onChange={e => setDestForm({ ...destForm, description: e.target.value })} rows={3}
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-600 resize-none" required />
                    </div>
                    <div className="flex gap-2">
                      <button type="submit" disabled={loading} className="flex-1 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-40 text-white text-xs font-bold py-2.5 rounded-md transition-colors">
                        {loading ? (editingDestinationId ? 'Updating...' : 'Saving...') : editingDestinationId ? 'Update Destination' : 'Save Destination'}
                      </button>
                      {editingDestinationId && (
                        <button type="button" onClick={resetDestinationForm} className="px-3 py-2.5 bg-neutral-800 border border-neutral-700 text-neutral-300 rounded-md text-xs font-bold">Cancel</button>
                      )}
                    </div>
                  </form>
                )}
              </div>

              {/* List */}
              <div className="bg-neutral-900 rounded-xl border border-neutral-800 overflow-hidden flex flex-col h-fit max-h-[600px]">
                <div className="px-4 py-3 border-b border-neutral-800 flex items-center gap-2 text-[10px] font-bold text-neutral-500 uppercase tracking-wider">
                  <Info className="size-3.5" /> Records
                </div>
                <div className="overflow-auto p-2 space-y-1">
                  {!data ? (
                    <div className="text-xs text-neutral-600 text-center py-8">Loading...</div>
                  ) : activeTab === 'floors' && (data.floors.length === 0 ? <div className="text-xs text-neutral-600 text-center py-8">No floors</div> : data.floors.map(f => (
                    <div key={f._id} className="flex items-center justify-between gap-2 px-3 py-2.5 bg-neutral-950 border border-neutral-800 rounded-md">
                      <div>
                        <div className="text-xs font-medium text-white">Level {f.level}: {f.name}</div>
                        <div className="text-[10px] font-mono text-neutral-600">{f._id}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        {f.floorPlanUrl && <span className="text-[10px] bg-neutral-800 text-neutral-400 px-1.5 py-0.5 rounded">Image</span>}
                        <button type="button" onClick={() => startEditFloor(f)} className="text-[10px] text-cyan-400 hover:text-cyan-300">Edit</button>
                        <button type="button" onClick={() => handleDeleteFloor(f._id)} className="text-[10px] text-red-400 hover:text-red-300">Delete</button>
                      </div>
                    </div>
                  )))}
                  {activeTab === 'nodes' && ((data?.nodes?.length ?? 0) === 0 ? <div className="text-xs text-neutral-600 text-center py-8">No nodes</div> : (data?.nodes ?? []).map(n => (
                    <div key={n._id} className="px-3 py-2.5 bg-neutral-950 border border-neutral-800 rounded-md space-y-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-medium text-white">{n.label}</div>
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => startEditNode(n)} className="text-[10px] text-cyan-400 hover:text-cyan-300">Edit</button>
                          <button type="button" onClick={() => handleDeleteNode(n._id)} className="text-[10px] text-red-400 hover:text-red-300">Delete</button>
                        </div>
                      </div>
                      <div className="text-[10px] text-neutral-500">Floor: {getFloorName(n.floorId)} {n.isLandmark && <span className="text-emerald-500 ml-1">● Landmark</span>}</div>
                    </div>
                  )))}
                  {activeTab === 'destinations' && ((data?.destinations?.length ?? 0) === 0 ? <div className="text-xs text-neutral-600 text-center py-8">No destinations</div> : (data?.destinations ?? []).map(d => (
                    <div key={d._id} className="px-3 py-2.5 bg-neutral-950 border border-neutral-800 rounded-md space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-white">{d.name}</span>
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => startEditDestination(d)} className="text-[10px] text-cyan-400 hover:text-cyan-300">Edit</button>
                          <button type="button" onClick={() => handleDeleteDestination(d._id)} className="text-[10px] text-red-400 hover:text-red-300">Delete</button>
                        </div>
                      </div>
                      <span className="text-[10px] text-neutral-500">{getNodeLabel(d.targetNodeId)}</span>
                      <p className="text-[11px] text-neutral-400 leading-snug">{d.description}</p>
                      <div className="flex flex-wrap gap-1">
                        {d.aliases.map((a, i) => <span key={i} className="text-[9px] bg-neutral-800 text-neutral-500 px-1 py-0.5 rounded">"{a}"</span>)}
                      </div>
                    </div>
                  )))}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
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