import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";

async function requireEditor(ctx: MutationCtx | QueryCtx, token: string) {
  const session = await ctx.db.query("sessions").withIndex("by_token", (q) => q.eq("token", token)).first();
  const user = session ? await ctx.db.get(session.userId) : null;
  if (!session || session.expiresAt <= Date.now() || !user || !["admin", "editor"].includes(user.role)) {
    throw new Error("Editor access required");
  }
  return user;
}

async function logAction(ctx: MutationCtx, user: Doc<"users">, action: string, entity: string, details?: string) {
  await ctx.db.insert("auditLogs", { userId: user._id, userEmail: user.email, action, entity, details, createdAt: Date.now() });
}

const position = v.object({ x: v.number(), y: v.number(), z: v.number() });

export const DEFAULT_VIEW_SETTINGS = {
  eyeHeight: 1.6,
  walkSpeed: 2.2,
  runSpeed: 4.5,
  turnSpeed: 1.8,
  fov: 70,
  headBob: true,
  collisions: true,
  guideSpeed: 1.7,
  hiddenMeshes: [] as string[],
};

async function readViewSettings(ctx: QueryCtx) {
  const row = await ctx.db.query("viewSettings").withIndex("by_key", (q) => q.eq("key", "default")).first();
  if (!row) return { ...DEFAULT_VIEW_SETTINGS, startPosition: null, startYaw: null };
  return {
    eyeHeight: row.eyeHeight, walkSpeed: row.walkSpeed, runSpeed: row.runSpeed, turnSpeed: row.turnSpeed,
    fov: row.fov, headBob: row.headBob, collisions: row.collisions, guideSpeed: row.guideSpeed,
    hiddenMeshes: row.hiddenMeshes,
    startPosition: row.startPosition ?? null, startYaw: row.startYaw ?? null,
  };
}
const landmarkType = v.optional(
  v.union(v.literal("corridor"), v.literal("staircase"), v.literal("elevator"), v.literal("double-door"))
);

export const listMapData = query({
  args: { token: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.token);
    const [floors, nodes, connections, destinations, overrides, viewpoints, viewSettings] = await Promise.all([
      ctx.db.query("floors").collect(),
      ctx.db.query("nodes").collect(),
      ctx.db.query("connections").collect(),
      ctx.db.query("destinations").collect(),
      ctx.db.query("materialOverrides").collect(),
      ctx.db.query("viewpoints").collect(),
      readViewSettings(ctx),
    ]);
    const urls = new Map<string, string>();
    for (const o of overrides) {
      if (o.textureStorageId && !urls.has(String(o.textureStorageId))) {
        urls.set(String(o.textureStorageId), (await ctx.storage.getUrl(o.textureStorageId)) || "");
      }
    }
    return {
      floors, nodes, connections, destinations, viewpoints, viewSettings,
      overrides: overrides.map((o) => ({
        _id: o._id, floorId: o.floorId, meshKey: o.meshKey,
        color: o.color, tiling: o.tiling,
        textureUrl: o.textureStorageId ? urls.get(String(o.textureStorageId)) || "" : "",
      })),
    };
  },
});

// Public API consumed by the user navigation app
export const getPublishedMap = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const [floors, nodes, connections, destinations, overrides, viewpoints, viewSettings] = await Promise.all([
      ctx.db.query("floors").collect(),
      ctx.db.query("nodes").collect(),
      ctx.db.query("connections").collect(),
      ctx.db.query("destinations").collect(),
      ctx.db.query("materialOverrides").collect(),
      ctx.db.query("viewpoints").collect(),
      readViewSettings(ctx),
    ]);
    const urls = new Map<string, string>();
    for (const o of overrides) {
      if (o.textureStorageId && !urls.has(String(o.textureStorageId))) {
        urls.set(String(o.textureStorageId), (await ctx.storage.getUrl(o.textureStorageId)) || "");
      }
    }
    return {
      viewSettings,
      viewpoints: viewpoints.map((p) => ({ _id: p._id, floorId: p.floorId, name: p.name, position: p.position, yaw: p.yaw, pitch: p.pitch })),
      floors: floors.map((f) => ({ _id: f._id, name: f.name, level: f.level, modelUrl: f.modelUrl || "" })),
      nodes: nodes.filter((n) => n.position !== undefined).map((n) => ({
        _id: n._id, floorId: n.floorId, label: n.label, position: n.position, yaw: n.yaw,
        isLandmark: n.isLandmark, landmarkType: n.landmarkType,
      })),
      connections: connections.map((c) => ({
        _id: c._id, fromNodeId: c.fromNodeId, toNodeId: c.toNodeId,
        textDirection: c.textDirection, estimatedWalkingTime: c.estimatedWalkingTime,
      })),
      destinations: destinations.map((d) => ({
        _id: d._id, name: d.name, aliases: d.aliases, floorId: d.floorId,
        targetNodeId: d.targetNodeId, description: d.description,
      })),
      overrides: overrides.map((o) => ({
        floorId: o.floorId, meshKey: o.meshKey, color: o.color, tiling: o.tiling,
        textureUrl: o.textureStorageId ? urls.get(String(o.textureStorageId)) || "" : "",
      })),
    };
  },
});

export const addNode3D = mutation({
  args: { token: v.string(), floorId: v.id("floors"), label: v.string(), position, isLandmark: v.optional(v.boolean()), landmarkType },
  returns: v.id("nodes"),
  handler: async (ctx, args) => {
    const user = await requireEditor(ctx, args.token);
    const id = await ctx.db.insert("nodes", {
      floorId: args.floorId, label: args.label, position: args.position,
      isLandmark: args.isLandmark ?? false, landmarkType: args.landmarkType,
    });
    await logAction(ctx, user, "add_node_3d", "nodes", args.label);
    return id;
  },
});

export const updateNode3D = mutation({
  args: { token: v.string(), _id: v.id("nodes"), label: v.string(), position, isLandmark: v.optional(v.boolean()), landmarkType },
  returns: v.id("nodes"),
  handler: async (ctx, args) => {
    const user = await requireEditor(ctx, args.token);
    const label = args.label.trim();
    if (!label) throw new Error("Label cannot be empty.");
    await ctx.db.patch(args._id, {
      label, position: args.position,
      isLandmark: args.isLandmark ?? false, landmarkType: args.landmarkType,
    });
    const dest = (await ctx.db.query("destinations").collect()).find((d) => d.targetNodeId === args._id);
    if (dest && dest.name !== label) await ctx.db.patch(dest._id, { name: label });
    // refresh walking time of every edge touching this node (it may have moved)
    const edges = await ctx.db.query("connections").collect();
    for (const e of edges) {
      if (e.fromNodeId !== args._id && e.toNodeId !== args._id) continue;
      const a = await ctx.db.get(e.fromNodeId);
      const b = await ctx.db.get(e.toNodeId);
      await ctx.db.patch(e._id, { estimatedWalkingTime: walkSeconds(a?.position, b?.position) });
    }
    await logAction(ctx, user, "update_node_3d", "nodes", label);
    return args._id;
  },
});

export const deleteNode3D = mutation({
  args: { token: v.string(), _id: v.id("nodes") },
  returns: v.id("nodes"),
  handler: async (ctx, args) => {
    const user = await requireEditor(ctx, args.token);
    const edges = await ctx.db.query("connections").collect();
    for (const e of edges) if (e.fromNodeId === args._id || e.toNodeId === args._id) await ctx.db.delete(e._id);
    const dests = await ctx.db.query("destinations").filter((q) => q.eq(q.field("targetNodeId"), args._id)).collect();
    for (const d of dests) await ctx.db.delete(d._id);
    await ctx.db.delete(args._id);
    await logAction(ctx, user, "delete_node_3d", "nodes");
    return args._id;
  },
});

const walkSeconds = (a?: { x: number; y: number; z: number }, b?: { x: number; y: number; z: number }) => {
  if (!a || !b) return 5;
  const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  return Math.max(5, Math.round(d * 1.2));
};

/** Create an undirected edge unless the pair is already connected. Edge weight (distance) is
 *  derived from node positions on the client for Dijkstra; walking time is stored for display. */
async function connectNodes(
  ctx: MutationCtx,
  fromNodeId: Id<"nodes">,
  toNodeId: Id<"nodes">,
  textDirection?: string
): Promise<Id<"connections">> {
  if (fromNodeId === toNodeId) throw new Error("A node cannot be connected to itself.");
  const a = await ctx.db.get(fromNodeId);
  const b = await ctx.db.get(toNodeId);
  if (!a || !b) throw new Error("Node not found.");
  const outgoing = await ctx.db.query("connections").withIndex("by_fromNode", (q) => q.eq("fromNodeId", fromNodeId)).collect();
  const reverse = await ctx.db.query("connections").withIndex("by_fromNode", (q) => q.eq("fromNodeId", toNodeId)).collect();
  const existing =
    outgoing.find((c) => c.toNodeId === toNodeId) ?? reverse.find((c) => c.toNodeId === fromNodeId);
  if (existing) return existing._id;
  return await ctx.db.insert("connections", {
    fromNodeId, toNodeId,
    textDirection: textDirection || `Walk from ${a.label} to ${b.label}.`,
    audioDescription: "",
    estimatedWalkingTime: walkSeconds(a.position, b.position),
  });
}

export const addConnection3D = mutation({
  args: { token: v.string(), fromNodeId: v.id("nodes"), toNodeId: v.id("nodes"), textDirection: v.optional(v.string()) },
  returns: v.id("connections"),
  handler: async (ctx, args) => {
    const user = await requireEditor(ctx, args.token);
    const id = await connectNodes(ctx, args.fromNodeId, args.toNodeId, args.textDirection);
    await logAction(ctx, user, "connect_nodes", "connections");
    return id;
  },
});

/** Bind (or rename) the room/destination of a node. One destination per node: upsert. */
async function upsertRoom(
  ctx: MutationCtx,
  floorId: Id<"floors">,
  nodeId: Id<"nodes">,
  name: string,
  description: string
) {
  const clean = name.trim();
  const aliases = Array.from(new Set([clean.toLowerCase().replace(/\s*\(.*?\)\s*/g, " ").trim()].filter((a) => a && a !== clean)));
  const existing = (await ctx.db.query("destinations").collect()).find((d) => d.targetNodeId === nodeId);
  if (existing) {
    await ctx.db.patch(existing._id, { name: clean, floorId, description, aliases });
    return existing._id;
  }
  return await ctx.db.insert("destinations", { name: clean, aliases, floorId, targetNodeId: nodeId, description });
}

/**
 * One atomic call used by the editor when a point on the floor is clicked:
 * saves the node (x,y,z + label), optionally registers it as a named room, and
 * optionally links it to another node so the walkable graph (Dijkstra) stays connected.
 */
export const addNodeWithRoom = mutation({
  args: {
    token: v.string(), floorId: v.id("floors"), label: v.string(), position,
    isRoom: v.boolean(), description: v.optional(v.string()),
    connectToNodeId: v.optional(v.id("nodes")),
    isLandmark: v.optional(v.boolean()), landmarkType,
  },
  returns: v.object({ nodeId: v.id("nodes"), connectionId: v.union(v.id("connections"), v.null()) }),
  handler: async (ctx, args) => {
    const user = await requireEditor(ctx, args.token);
    const label = args.label.trim();
    if (!label) throw new Error("Please enter a name for this point.");
    if (label.length > 80) throw new Error("Name is too long (max 80 characters).");
    const nodeId = await ctx.db.insert("nodes", {
      floorId: args.floorId, label, position: args.position,
      isLandmark: args.isLandmark ?? false, landmarkType: args.landmarkType,
    });
    if (args.isRoom) await upsertRoom(ctx, args.floorId, nodeId, label, (args.description ?? "").trim());
    let connectionId: Id<"connections"> | null = null;
    if (args.connectToNodeId && args.connectToNodeId !== nodeId) {
      connectionId = await connectNodes(ctx, args.connectToNodeId, nodeId);
    }
    await logAction(ctx, user, "add_node_3d", "nodes", `${label} (${args.position.x}, ${args.position.y}, ${args.position.z})`);
    return { nodeId, connectionId };
  },
});

/** Create the default floor if the building has none, so the editor always works. */
export const ensureDefaultFloor = mutation({
  args: { token: v.string() },
  returns: v.id("floors"),
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.token);
    const first = await ctx.db.query("floors").first();
    if (first) return first._id;
    return await ctx.db.insert("floors", { level: 0, name: "Ground Floor" });
  },
});

export const deleteConnection3D = mutation({
  args: { token: v.string(), _id: v.id("connections") },
  returns: v.id("connections"),
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.token);
    await ctx.db.delete(args._id);
    return args._id;
  },
});

export const addDestination3D = mutation({
  args: {
    token: v.string(), name: v.string(), floorId: v.id("floors"),
    targetNodeId: v.id("nodes"), description: v.optional(v.string()), aliases: v.optional(v.array(v.string())),
  },
  returns: v.id("destinations"),
  handler: async (ctx, args) => {
    const user = await requireEditor(ctx, args.token);
    if (!args.name.trim()) throw new Error("Enter a room name first.");
    const id = await upsertRoom(ctx, args.floorId, args.targetNodeId, args.name, (args.description ?? "").trim());
    if (args.aliases?.length) await ctx.db.patch(id, { aliases: args.aliases });
    // keep the node label in sync with the room name so pins/labels show the same text
    await ctx.db.patch(args.targetNodeId, { label: args.name.trim() });
    await logAction(ctx, user, "save_room", "destinations", args.name.trim());
    return id;
  },
});

export const updateDestination3D = mutation({
  args: { token: v.string(), _id: v.id("destinations"), name: v.string(), description: v.string() },
  returns: v.id("destinations"),
  handler: async (ctx, args) => {
    const user = await requireEditor(ctx, args.token);
    const d = await ctx.db.get(args._id);
    if (!d) throw new Error("Room not found.");
    const name = args.name.trim();
    if (!name) throw new Error("Room name cannot be empty.");
    await ctx.db.patch(args._id, { name, description: args.description.trim() });
    await ctx.db.patch(d.targetNodeId, { label: name });
    await logAction(ctx, user, "update_room", "destinations", name);
    return args._id;
  },
});

export const deleteDestination3D = mutation({
  args: { token: v.string(), _id: v.id("destinations") },
  returns: v.id("destinations"),
  handler: async (ctx, args) => {
    const user = await requireEditor(ctx, args.token);
    await ctx.db.delete(args._id);
    await logAction(ctx, user, "delete_room", "destinations");
    return args._id;
  },
});

export const setMaterialOverride = mutation({
  args: {
    token: v.string(), floorId: v.id("floors"), meshKey: v.string(),
    color: v.optional(v.string()), textureStorageId: v.optional(v.id("_storage")), tiling: v.optional(v.number()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const user = await requireEditor(ctx, args.token);
    const existing = await ctx.db.query("materialOverrides")
      .withIndex("by_floor", (q) => q.eq("floorId", args.floorId))
      .filter((q) => q.eq(q.field("meshKey"), args.meshKey)).first();
    const doc = {
      floorId: args.floorId, meshKey: args.meshKey, color: args.color,
      textureStorageId: args.textureStorageId, tiling: args.tiling ?? 1, updatedAt: Date.now(),
    };
    if (existing) await ctx.db.patch(existing._id, doc);
    else await ctx.db.insert("materialOverrides", doc);
    await logAction(ctx, user, "set_material_override", "materialOverrides", args.meshKey);
    return true;
  },
});

export const deleteMaterialOverride = mutation({
  args: { token: v.string(), floorId: v.id("floors"), meshKey: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.token);
    const existing = await ctx.db.query("materialOverrides")
      .withIndex("by_floor", (q) => q.eq("floorId", args.floorId))
      .filter((q) => q.eq(q.field("meshKey"), args.meshKey)).first();
    if (existing) await ctx.db.delete(existing._id);
    return true;
  },
});

/** Fast patch used by the transform gizmo / nudge pad: move and/or rotate one node. */
export const updateNodeTransform = mutation({
  args: { token: v.string(), _id: v.id("nodes"), position: v.optional(position), yaw: v.optional(v.number()) },
  returns: v.id("nodes"),
  handler: async (ctx, args) => {
    const user = await requireEditor(ctx, args.token);
    const node = await ctx.db.get(args._id);
    if (!node) throw new Error("Node not found.");
    const patch: { position?: { x: number; y: number; z: number }; yaw?: number } = {};
    if (args.position) patch.position = args.position;
    if (args.yaw !== undefined) patch.yaw = args.yaw;
    await ctx.db.patch(args._id, patch);
    if (args.position) {
      const edges = await ctx.db.query("connections").collect();
      for (const e of edges) {
        if (e.fromNodeId !== args._id && e.toNodeId !== args._id) continue;
        const a = e.fromNodeId === args._id ? { position: args.position } : await ctx.db.get(e.fromNodeId);
        const b = e.toNodeId === args._id ? { position: args.position } : await ctx.db.get(e.toNodeId);
        await ctx.db.patch(e._id, { estimatedWalkingTime: walkSeconds(a?.position, b?.position) });
      }
    }
    await logAction(ctx, user, "transform_node", "nodes", node.label);
    return args._id;
  },
});

const clampNum = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export const saveViewSettings = mutation({
  args: {
    token: v.string(),
    eyeHeight: v.number(), walkSpeed: v.number(), runSpeed: v.number(), turnSpeed: v.number(),
    fov: v.number(), headBob: v.boolean(), collisions: v.boolean(), guideSpeed: v.number(),
    startPosition: v.optional(position), startYaw: v.optional(v.number()),
    hiddenMeshes: v.optional(v.array(v.string())),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const user = await requireEditor(ctx, args.token);
    const existing = await ctx.db.query("viewSettings").withIndex("by_key", (q) => q.eq("key", "default")).first();
    const doc = {
      key: "default",
      eyeHeight: clampNum(args.eyeHeight, 0.8, 2.4),
      walkSpeed: clampNum(args.walkSpeed, 0.5, 6),
      runSpeed: clampNum(args.runSpeed, 1, 12),
      turnSpeed: clampNum(args.turnSpeed, 0.4, 5),
      fov: clampNum(args.fov, 40, 100),
      headBob: args.headBob,
      collisions: args.collisions,
      guideSpeed: clampNum(args.guideSpeed, 0.5, 5),
      startPosition: args.startPosition ?? existing?.startPosition,
      startYaw: args.startYaw ?? existing?.startYaw,
      hiddenMeshes: (args.hiddenMeshes ?? existing?.hiddenMeshes ?? []).slice(0, 500),
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.replace(existing._id, doc);
    else await ctx.db.insert("viewSettings", doc);
    await logAction(ctx, user, "save_view_settings", "viewSettings");
    return true;
  },
});

export const addViewpoint = mutation({
  args: { token: v.string(), floorId: v.id("floors"), name: v.string(), position, yaw: v.number(), pitch: v.number() },
  returns: v.id("viewpoints"),
  handler: async (ctx, args) => {
    const user = await requireEditor(ctx, args.token);
    const name = args.name.trim();
    if (!name) throw new Error("Give the viewpoint a name.");
    if (name.length > 60) throw new Error("Viewpoint name is too long (max 60 characters).");
    const id = await ctx.db.insert("viewpoints", {
      floorId: args.floorId, name, position: args.position, yaw: args.yaw, pitch: args.pitch, createdAt: Date.now(),
    });
    await logAction(ctx, user, "add_viewpoint", "viewpoints", name);
    return id;
  },
});

export const deleteViewpoint = mutation({
  args: { token: v.string(), _id: v.id("viewpoints") },
  returns: v.id("viewpoints"),
  handler: async (ctx, args) => {
    const user = await requireEditor(ctx, args.token);
    await ctx.db.delete(args._id);
    await logAction(ctx, user, "delete_viewpoint", "viewpoints");
    return args._id;
  },
});

export const publishMap = mutation({
  args: { token: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const user = await requireEditor(ctx, args.token);
    await logAction(ctx, user, "publish_map", "map", "3D map published");
    return true;
  },
});