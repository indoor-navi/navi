import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const authInternal = internal.auth as any;

const SESSION_DURATION_MS = 1000 * 60 * 60 * 24;

export const getUserByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email.trim().toLowerCase()))
      .first();
  },
});

export const createSession = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const token = crypto.randomUUID();
    await ctx.db.insert("sessions", {
      userId: args.userId,
      token,
      expiresAt: Date.now() + SESSION_DURATION_MS,
      createdAt: Date.now(),
    });
    const user = await ctx.db.get(args.userId);
    if (user) {
      await ctx.db.insert("auditLogs", {
        userId: user._id,
        userEmail: user.email,
        action: "login",
        entity: "session",
        createdAt: Date.now(),
      });
    }
    return token;
  },
});

export const createSeededAdmin = internalMutation({
  args: { email: v.string(), passwordHash: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        passwordHash: args.passwordHash,
        role: "admin",
      });
      return { created: false, email: existing.email, passwordReset: true };
    }

    await ctx.db.insert("users", {
      email: args.email,
      passwordHash: args.passwordHash,
      role: "admin",
      createdAt: Date.now(),
    });
    return { created: true, email: args.email };
  },
});

export const login = action({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, args) => {
    const bcrypt = await import("bcryptjs");
    const user = await ctx.runQuery(authInternal.getUserByEmail, {
      email: args.email,
    });

    if (!user || !(await bcrypt.compare(args.password, user.passwordHash))) {
      throw new Error("Invalid email or password");
    }

    const token = await ctx.runMutation(authInternal.createSession, {
      userId: user._id,
    });
    return { token, user: { email: user.email, role: user.role } };
  },
});

export const getSession = query({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!args.token) return null;
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token!))
      .first();
    if (!session || session.expiresAt <= Date.now()) return null;

    const user = await ctx.db.get(session.userId);
    if (!user) return null;
    return { email: user.email, role: user.role };
  },
});

export const logout = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (session) {
      const user = await ctx.db.get(session.userId);
      if (user) {
        await ctx.db.insert("auditLogs", {
          userId: user._id,
          userEmail: user.email,
          action: "logout",
          entity: "session",
          createdAt: Date.now(),
        });
      }
      await ctx.db.delete(session._id);
    }
  },
});

export const listUsers = query({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const session = args.token
      ? await ctx.db.query("sessions").withIndex("by_token", (q) => q.eq("token", args.token!)).first()
      : null;
    if (!session || session.expiresAt <= Date.now()) return [];
    const user = await ctx.db.get(session.userId);
    if (!user || user.role !== "admin") return [];
    return await ctx.db.query("users").collect();
  },
});

export const listAuditLogs = query({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const session = args.token
      ? await ctx.db.query("sessions").withIndex("by_token", (q) => q.eq("token", args.token!)).first()
      : null;
    if (!session || session.expiresAt <= Date.now()) return [];
    const user = await ctx.db.get(session.userId);
    if (!user || user.role !== "admin") return [];
    return await ctx.db.query("auditLogs").withIndex("by_createdAt").order("desc").take(100);
  },
});

export const createUser = action({
  args: { token: v.string(), email: v.string(), password: v.string(), role: v.union(v.literal("admin"), v.literal("editor"), v.literal("viewer")) },
  handler: async (ctx, args) => {
    const bcrypt = await import("bcryptjs");
    const user = await ctx.runQuery(authInternal.getUserByToken, { token: args.token });
    if (!user || user.role !== "admin") throw new Error("Admin access required");
    const existing = await ctx.runQuery(authInternal.getUserByEmail, { email: args.email });
    if (existing) throw new Error("A user with that email already exists");
    return await ctx.runMutation(authInternal.createUserRecord, {
      email: args.email.trim().toLowerCase(),
      passwordHash: await bcrypt.hash(args.password, 12),
      role: args.role,
      actorId: user._id,
    });
  },
});

export const getUserByToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db.query("sessions").withIndex("by_token", (q) => q.eq("token", args.token)).first();
    if (!session || session.expiresAt <= Date.now()) return null;
    return await ctx.db.get(session.userId);
  },
});

export const createUserRecord = internalMutation({
  args: { email: v.string(), passwordHash: v.string(), role: v.union(v.literal("admin"), v.literal("editor"), v.literal("viewer")), actorId: v.id("users") },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("users", { email: args.email, passwordHash: args.passwordHash, role: args.role, createdAt: Date.now() });
    const actor = await ctx.db.get(args.actorId);
    if (actor) await ctx.db.insert("auditLogs", { userId: actor._id, userEmail: actor.email, action: "create_user", entity: args.email, details: `role=${args.role}`, createdAt: Date.now() });
    return id;
  },
});

export const resetUserPassword = action({
  args: { token: v.string(), userId: v.id("users"), password: v.string() },
  handler: async (ctx, args) => {
    const bcrypt = await import("bcryptjs");
    const actor = await ctx.runQuery(authInternal.getUserByToken, { token: args.token });
    if (!actor || actor.role !== "admin") throw new Error("Admin access required");
    if (args.password.length < 8) throw new Error("Password must be at least 8 characters");

    return await ctx.runMutation(authInternal.resetUserPasswordRecord, {
      userId: args.userId,
      passwordHash: await bcrypt.hash(args.password, 12),
      actorId: actor._id,
    });
  },
});

export const resetUserPasswordRecord = internalMutation({
  args: { userId: v.id("users"), passwordHash: v.string(), actorId: v.id("users") },
  handler: async (ctx, args) => {
    const target = await ctx.db.get(args.userId);
    const actor = await ctx.db.get(args.actorId);
    if (!target || !actor) throw new Error("User not found");

    await ctx.db.patch(target._id, { passwordHash: args.passwordHash });
    const sessions = await ctx.db.query("sessions").collect();
    for (const session of sessions) {
      if (session.userId === target._id) await ctx.db.delete(session._id);
    }
    await ctx.db.insert("auditLogs", {
      userId: actor._id,
      userEmail: actor.email,
      action: "reset_user_password",
      entity: target.email,
      details: "All existing sessions revoked",
      createdAt: Date.now(),
    });
    return { email: target.email };
  },
});

export const deleteUser = mutation({
  args: { token: v.string(), userId: v.id("users") },
  handler: async (ctx, args) => {
    const session = await ctx.db.query("sessions").withIndex("by_token", (q) => q.eq("token", args.token)).first();
    const actor = session ? await ctx.db.get(session.userId) : null;
    if (!actor || actor.role !== "admin" || actor._id === args.userId) throw new Error("Invalid admin operation");
    const target = await ctx.db.get(args.userId);
    if (!target) return;
    await ctx.db.insert("auditLogs", { userId: actor._id, userEmail: actor.email, action: "delete_user", entity: target.email, createdAt: Date.now() });
    await ctx.db.delete(args.userId);
  },
});