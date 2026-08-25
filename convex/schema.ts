import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  floors: defineTable({
    level: v.number(),
    name: v.string(),
    floorPlanUrl: v.optional(v.string()),
  }),

  nodes: defineTable({
    floorId: v.id("floors"),
    label: v.string(),
    isLandmark: v.boolean(),
    landmarkType: v.optional(
      v.union(
        v.literal("corridor"),
        v.literal("staircase"),
        v.literal("elevator"),
        v.literal("double-door")
      )
    ),
  }),

  connections: defineTable({
    fromNodeId: v.id("nodes"),
    toNodeId: v.id("nodes"),
    imageUrl: v.string(),
    videoSegmentUrl: v.optional(v.string()),
    textDirection: v.string(),
    audioDescription: v.string(),
    estimatedWalkingTime: v.number(),
  })
    .index("by_fromNode", ["fromNodeId"]),

  destinations: defineTable({
    name: v.string(),
    aliases: v.array(v.string()),
    floorId: v.id("floors"),
    targetNodeId: v.id("nodes"),
    description: v.string(),
  }),

  qrCodes: defineTable({
    entityType: v.union(v.literal("node"), v.literal("destination")),
    entityId: v.string(),
    label: v.string(),
    content: v.string(),
    createdAt: v.number(),
  }).index("by_entity", ["entityType", "entityId"]),

  assistantConfig: defineTable({
    key: v.string(),
    assistantName: v.string(),
    personality: v.string(),
    task: v.string(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  users: defineTable({
    email: v.string(),
    passwordHash: v.string(),
    role: v.union(v.literal("admin"), v.literal("editor"), v.literal("viewer")),
    createdAt: v.number(),
  }).index("by_email", ["email"]),

  sessions: defineTable({
    userId: v.id("users"),
    token: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
  }).index("by_token", ["token"]),

  auditLogs: defineTable({
    userId: v.optional(v.id("users")),
    userEmail: v.string(),
    action: v.string(),
    entity: v.string(),
    details: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_createdAt", ["createdAt"]),
});