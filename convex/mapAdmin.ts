import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
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
const landmarkType = v.optional(
  v.union(v.literal("corridor"), v.literal("staircase"), v.literal("elevator"), v.literal("double-door"))
);

export const listMapData = query({
  args: { token: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.token);
    const [floors, nodes, connections, destinations, overrides] = await Promise.all([
      ctx.db.query("floors").collect(),
      ctx.db.query("nodes").collect(),
      ctx.db.query("connections").collect(),
      ctx.db.query("destinations").collect(),
      ctx.db.query("materialOverrides").collect(),
    ]);
    const urls = new Map<string, string>();
    for (const o of overrides) {
      if (o.textureStorageId && !urls.has(String(o.textureStorageId))) {
        urls.set(String(o.textureStorageId), (await ctx.storage.getUrl(o.textureStorageId)) || "");
      }
    }
    return {
      floors, nodes, connections, destinations,
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
    const [floors, nodes, connections, destinations, overrides] = await Promise.all([
      ctx.db.query("floors").collect(),
      ctx.db.query("nodes").collect(),
      ctx.db.query("connections").collect(),
      ctx.db.query("destinations").collect(),
      ctx.db.query("materialOverrides").collect(),
    ]);
    const urls = new Map<string, string>();
    for (const o of overrides) {
      if (o.textureStorageId && !urls.has(String(o.textureStorageId))) {
        urls.set(String(o.textureStorageId), (await ctx.storage.getUrl(o.textureStorageId)) || "");
      }
    }
    return {
      floors: floors.map((f) => ({ _id: f._id, name: f.name, level: f.level, modelUrl: f.modelUrl || "" })),
      nodes: nodes.filter((n) => n.position !== undefined).map((n) => ({
        _id: n._id, floorId: n.floorId, label: n.label, position: n.position,
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
    await requireEditor(ctx, args.token);
    await ctx.db.patch(args._id, {
      label: args.label, position: args.position,
      isLandmark: args.isLandmark ?? false, landmarkType: args.landmarkType,
    });
    return args._id;
  },
});

export const deleteNode3D = mutation({
  args: { token: v.string(), _id: v.id("nodes") },
  returns: v.id("nodes"),
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.token);
    const edges = await ctx.db.query("connections").collect();
    for (const e of edges) if (e.fromNodeId === args._id || e.toNodeId === args._id) await ctx.db.delete(e._id);
    const dests = await ctx.db.query("destinations").filter((q) => q.eq(q.field("targetNodeId"), args._id)).collect();
    for (const d of dests) await ctx.db.delete(d._id);
    await ctx.db.delete(args._id);
    return args._id;
  },
});

export const addConnection3D = mutation({
  args: { token: v.string(), fromNodeId: v.id("nodes"), toNodeId: v.id("nodes"), textDirection: v.optional(v.string()) },
  returns: v.id("connections"),
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.token);
    const a = await ctx.db.get(args.fromNodeId);
    const b = await ctx.db.get(args.toNodeId);
    const dist = a?.position && b?.position
      ? Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) : 0;
    return await ctx.db.insert("connections", {
      fromNodeId: args.fromNodeId, toNodeId: args.toNodeId,
      textDirection: args.textDirection || `Walk from ${a?.label ?? "node"} to ${b?.label ?? "node"}.`,
      audioDescription: "", estimatedWalkingTime: Math.max(5, Math.round(dist * 1.2)),
    });
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
    await requireEditor(ctx, args.token);
    return await ctx.db.insert("destinations", {
      name: args.name, aliases: args.aliases ?? [], floorId: args.floorId,
      targetNodeId: args.targetNodeId, description: args.description ?? "",
    });
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

export const publishMap = mutation({
  args: { token: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const user = await requireEditor(ctx, args.token);
    await logAction(ctx, user, "publish_map", "map", "3D map published");
    return true;
  },
});