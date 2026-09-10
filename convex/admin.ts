// convex/admin.ts
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

async function requireEditor(ctx: any, token: string) {
  const session = await ctx.db.query("sessions").withIndex("by_token", (q: any) => q.eq("token", token)).first();
  const user = session ? await ctx.db.get(session.userId) : null;
  if (!session || session.expiresAt <= Date.now() || !user || !["admin", "editor"].includes(user.role)) throw new Error("Editor access required");
  await ctx.db.insert("auditLogs", {
    userId: user._id,
    userEmail: user.email,
    action: "admin_mutation",
    entity: "content",
    details: "Authenticated content management operation",
    createdAt: Date.now(),
  });
  return user;
}

async function requireAdmin(ctx: any, token: string) {
  const user = await requireEditor(ctx, token);
  if (user.role !== "admin") throw new Error("Admin access required");
  return user;
}

// --- CREATE MUTATIONS ---

export const addFloor = mutation({
  args: {
    token: v.string(),
    level: v.number(),
    name: v.string(),
    floorPlanUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.token);
    return await ctx.db.insert("floors", {
      level: args.level,
      name: args.name,
      floorPlanUrl: args.floorPlanUrl,
    });
  },
});

export const updateFloor = mutation({
  args: {
    token: v.string(),
    _id: v.id("floors"),
    level: v.number(),
    name: v.string(),
    floorPlanUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.token);
    await ctx.db.patch(args._id, {
      level: args.level,
      name: args.name,
      floorPlanUrl: args.floorPlanUrl,
    });
    return args._id;
  },
});

export const deleteFloor = mutation({
  args: { token: v.string(), _id: v.id("floors") },
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.token);
    const nodes = await ctx.db.query("nodes").filter((q) => q.eq(q.field("floorId"), args._id)).collect();
    for (const node of nodes) {
      await ctx.db.delete(node._id);
    }

    const destinations = await ctx.db.query("destinations").filter((q) => q.eq(q.field("floorId"), args._id)).collect();
    for (const destination of destinations) {
      await ctx.db.delete(destination._id);
    }

    await ctx.db.delete(args._id);
    return args._id;
  },
});

export const addNode = mutation({
  args: {
    token: v.string(),
    floorId: v.id("floors"),
    label: v.string(),
    isLandmark: v.boolean(),
    videoClipUrl: v.optional(v.string()),
    landmarkType: v.optional(
      v.union(
        v.literal("corridor"),
        v.literal("staircase"),
        v.literal("elevator"),
        v.literal("double-door")
      )
    ),
  },
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.token);
    const nodeId = await ctx.db.insert("nodes", {
      floorId: args.floorId,
      label: args.label,
      isLandmark: args.isLandmark,
      videoClipUrl: args.videoClipUrl,
      landmarkType: args.landmarkType,
    });

    return nodeId;
  },
});

export const updateNode = mutation({
  args: {
    token: v.string(),
    _id: v.id("nodes"),
    floorId: v.id("floors"),
    label: v.string(),
    isLandmark: v.boolean(),
    videoClipUrl: v.optional(v.string()),
    landmarkType: v.optional(
      v.union(
        v.literal("corridor"),
        v.literal("staircase"),
        v.literal("elevator"),
        v.literal("double-door")
      )
    ),
  },
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.token);
    await ctx.db.patch(args._id, {
      floorId: args.floorId,
      label: args.label,
      isLandmark: args.isLandmark,
      videoClipUrl: args.videoClipUrl,
      landmarkType: args.landmarkType,
    });

    return args._id;
  },
});

export const deleteNode = mutation({
  args: { token: v.string(), _id: v.id("nodes") },
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.token);
    const incomingEdges = await ctx.db.query("connections").filter((q) => q.eq(q.field("fromNodeId"), args._id)).collect();
    for (const edge of incomingEdges) {
      await ctx.db.delete(edge._id);
    }

    const outgoingEdges = await ctx.db.query("connections").filter((q) => q.eq(q.field("toNodeId"), args._id)).collect();
    for (const edge of outgoingEdges) {
      await ctx.db.delete(edge._id);
    }

    const destinations = await ctx.db.query("destinations").filter((q) => q.eq(q.field("targetNodeId"), args._id)).collect();
    for (const destination of destinations) {
      const qr = await ctx.db
        .query("qrCodes")
        .withIndex("by_entity", (q) => q.eq("entityType", "destination").eq("entityId", String(destination._id)))
        .first();
      if (qr) await ctx.db.delete(qr._id);
      await ctx.db.delete(destination._id);
    }

    const nodeQrCode = await ctx.db
      .query("qrCodes")
      .withIndex("by_entity", (q) => q.eq("entityType", "node").eq("entityId", String(args._id)))
      .first();

    if (nodeQrCode) {
      await ctx.db.delete(nodeQrCode._id);
    }

    await ctx.db.delete(args._id);
    return args._id;
  },
});

export const addDestination = mutation({
  args: {
    token: v.string(),
    name: v.string(),
    aliases: v.array(v.string()),
    floorId: v.id("floors"),
    description: v.string(),
    targetNodeId: v.id("nodes"),
  },
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.token);
    const destinationId = await ctx.db.insert("destinations", {
      name: args.name,
      aliases: args.aliases,
      floorId: args.floorId,
      description: args.description,
      targetNodeId: args.targetNodeId,
    });

    const existing = await ctx.db
      .query("qrCodes")
      .withIndex("by_entity", (q) => q.eq("entityType", "destination").eq("entityId", destinationId))
      .first();

    if (!existing) {
      const content = `https://navi-mauve-mu.vercel.app/continue?entityType=destination&entityId=${encodeURIComponent(String(destinationId))}&label=${encodeURIComponent(args.name)}`;
      await ctx.db.insert("qrCodes", {
        entityType: "destination",
        entityId: String(destinationId),
        label: args.name,
        content,
        createdAt: Date.now(),
      });
    }

    return destinationId;
  },
});

export const updateDestination = mutation({
  args: {
    token: v.string(),
    _id: v.id("destinations"),
    name: v.string(),
    aliases: v.array(v.string()),
    floorId: v.id("floors"),
    description: v.string(),
    targetNodeId: v.id("nodes"),
  },
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.token);
    await ctx.db.patch(args._id, {
      name: args.name,
      aliases: args.aliases,
      floorId: args.floorId,
      description: args.description,
      targetNodeId: args.targetNodeId,
    });

    const qrCode = await ctx.db
      .query("qrCodes")
      .withIndex("by_entity", (q) => q.eq("entityType", "destination").eq("entityId", String(args._id)))
      .first();

    if (qrCode) {
      await ctx.db.patch(qrCode._id, {
        label: args.name,
        content: `https://navi-mauve-mu.vercel.app/continue?entityType=destination&entityId=${encodeURIComponent(String(args._id))}&label=${encodeURIComponent(args.name)}`,
      });
    }

    return args._id;
  },
});

export const deleteDestination = mutation({
  args: { token: v.string(), _id: v.id("destinations") },
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.token);
    const qrCode = await ctx.db
      .query("qrCodes")
      .withIndex("by_entity", (q) => q.eq("entityType", "destination").eq("entityId", String(args._id)))
      .first();

    if (qrCode) {
      await ctx.db.delete(qrCode._id);
    }

    await ctx.db.delete(args._id);
    return args._id;
  },
});

export const addConnection = mutation({
  args: {
    token: v.string(),
    fromNodeId: v.id("nodes"),
    toNodeId: v.id("nodes"),
    textDirection: v.string(),
    audioDescription: v.string(),
    estimatedWalkingTime: v.number(),
  },
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.token);
    return await ctx.db.insert("connections", {
      fromNodeId: args.fromNodeId,
      toNodeId: args.toNodeId,
      textDirection: args.textDirection,
      audioDescription: args.audioDescription,
      estimatedWalkingTime: args.estimatedWalkingTime,
    });
  },
});

export const updateConnection = mutation({
  args: {
    token: v.string(),
    _id: v.id("connections"),
    fromNodeId: v.id("nodes"),
    toNodeId: v.id("nodes"),
    textDirection: v.string(),
    audioDescription: v.string(),
    estimatedWalkingTime: v.number(),
  },
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.token);
    await ctx.db.patch(args._id, {
      fromNodeId: args.fromNodeId,
      toNodeId: args.toNodeId,
      textDirection: args.textDirection,
      audioDescription: args.audioDescription,
      estimatedWalkingTime: args.estimatedWalkingTime,
    });
    return args._id;
  },
});

export const deleteConnection = mutation({
  args: { token: v.string(), _id: v.id("connections") },
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.token);
    await ctx.db.delete(args._id);
    return args._id;
  },
});

// --- FETCH QUERIES ---

export const ensureQrCodeRecords = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.token);
    const destinations = await ctx.db.query("destinations").collect();

    const nodeQrCodes = await ctx.db.query("qrCodes").filter((q) => q.eq(q.field("entityType"), "node")).collect();
    for (const qr of nodeQrCodes) {
      await ctx.db.delete(qr._id);
    }

    const createQr = async (entityId: string, label: string) => {
      const existing = await ctx.db
        .query("qrCodes")
        .withIndex("by_entity", (q) => q.eq("entityType", "destination").eq("entityId", entityId))
        .first();

      if (existing) return;

      const content = `https://navi-mauve-mu.vercel.app/continue?entityType=destination&entityId=${encodeURIComponent(entityId)}&label=${encodeURIComponent(label)}`;

      await ctx.db.insert("qrCodes", {
        entityType: "destination",
        entityId,
        label,
        content,
        createdAt: Date.now(),
      });
    };

    for (const destination of destinations) {
      await createQr(String(destination._id), destination.name);
    }

    return { created: true };
  },
});

export const listAllData = query({
  args: {},
  handler: async (ctx) => {
    const floors = await ctx.db.query("floors").order("asc").collect();
    const nodes = await ctx.db.query("nodes").collect();
    const destinations = await ctx.db.query("destinations").collect();
    const connections = await ctx.db.query("connections").collect();
    const qrCodes = (await ctx.db.query("qrCodes").collect()).filter((code) => code.entityType === "destination");
    const assistantConfig = await ctx.db
      .query("assistantConfig")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .first();

    return { floors, nodes, destinations, connections, qrCodes, assistantConfig };
  },
});

export const getAssistantConfig = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("assistantConfig")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .first();
  },
});

export const updateAssistantConfig = mutation({
  args: {
    token: v.string(),
    assistantName: v.string(),
    personality: v.string(),
    task: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.query("sessions").withIndex("by_token", (q) => q.eq("token", args.token)).first();
    const actor = session ? await ctx.db.get(session.userId) : null;
    if (!session || !actor || actor.role !== "admin" || session.expiresAt <= Date.now()) throw new Error("Admin access required");
    const existing = await ctx.db
      .query("assistantConfig")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .first();
    const values = { assistantName: args.assistantName, personality: args.personality, task: args.task, updatedAt: Date.now() };

    if (existing) {
      await ctx.db.patch(existing._id, values);
      await ctx.db.insert("auditLogs", { userId: actor._id, userEmail: actor.email, action: "update_assistant_config", entity: "assistantConfig", createdAt: Date.now() });
      return existing._id;
    }

    const id = await ctx.db.insert("assistantConfig", { key: "default", ...values });
    await ctx.db.insert("auditLogs", { userId: actor._id, userEmail: actor.email, action: "create_assistant_config", entity: "assistantConfig", createdAt: Date.now() });
    return id;
  },
});

export const generateUploadUrl = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.token);
    return await ctx.storage.generateUploadUrl();
  },
});