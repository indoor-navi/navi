import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  floors: defineTable({
    level: v.number(),
    name: v.string(),
    floorPlanUrl: v.optional(v.string()),
    modelUrl: v.optional(v.string()),
  }),

  nodes: defineTable({
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
    // 3D position in the GLB scene (metres, Y-up)
    position: v.optional(v.object({ x: v.number(), y: v.number(), z: v.number() })),
    // Facing direction in radians (0 = looking toward -Z). Set with the admin rotate tool.
    yaw: v.optional(v.number()),
  }),

  connections: defineTable({
    fromNodeId: v.id("nodes"),
    toNodeId: v.id("nodes"),
    textDirection: v.string(),
    audioDescription: v.string(),
    estimatedWalkingTime: v.number(),
  }).index("by_fromNode", ["fromNodeId"]),

  destinations: defineTable({
    name: v.string(),
    aliases: v.array(v.string()),
    floorId: v.id("floors"),
    targetNodeId: v.id("nodes"),
    description: v.string(),
  }),

  materialOverrides: defineTable({
    floorId: v.id("floors"),
    meshKey: v.string(),
    color: v.optional(v.string()),
    textureStorageId: v.optional(v.id("_storage")),
    tiling: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_floor", ["floorId"]),

  // Visitor (first-person) camera and movement settings, edited by admins, read by the navigation app.
  viewSettings: defineTable({
    key: v.string(),
    eyeHeight: v.number(),
    walkSpeed: v.number(),
    runSpeed: v.number(),
    turnSpeed: v.number(),
    fov: v.number(),
    headBob: v.boolean(),
    collisions: v.boolean(),
    guideSpeed: v.number(),
    startPosition: v.optional(v.object({ x: v.number(), y: v.number(), z: v.number() })),
    startYaw: v.optional(v.number()),
    hiddenMeshes: v.array(v.string()),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  // Named camera spots saved by admins; visitors can jump to them.
  viewpoints: defineTable({
    floorId: v.id("floors"),
    name: v.string(),
    position: v.object({ x: v.number(), y: v.number(), z: v.number() }),
    yaw: v.number(),
    pitch: v.number(),
    createdAt: v.number(),
  }).index("by_floor", ["floorId"]),

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
    auraColorA: v.optional(v.string()),
    auraColorB: v.optional(v.string()),
    backgroundColor: v.optional(v.string()),
    logoStorageId: v.optional(v.id("_storage")),
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