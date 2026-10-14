"use node";

import bcrypt from "bcryptjs";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";

export const seedAdmin = internalAction({
  args: {},
  returns: v.object({ created: v.boolean(), email: v.string() }),
  handler: async (ctx): Promise<{ created: boolean; email: string }> => {
    const email = (process.env.ADMIN_EMAIL || "admin@navi.local").trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD;
    if (!email.includes("@") || email.length > 254) {
      throw new Error("ADMIN_EMAIL must be a valid email address.");
    }
    if (!password || password.length < 16) {
      throw new Error("Set ADMIN_PASSWORD to a one-time password of at least 16 characters.");
    }
    const passwordHash = await bcrypt.hash(password, 12);
    return await ctx.runMutation(internal.auth.createSeededAdmin, {
      email,
      passwordHash,
    });
  },
});

export const rotateSeededAdminPassword = internalAction({
  args: {},
  returns: v.object({ updated: v.boolean(), email: v.string() }),
  handler: async (ctx): Promise<{ updated: boolean; email: string }> => {
    const email = (process.env.ADMIN_EMAIL || "admin@navi.local").trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD;
    if (!email.includes("@") || email.length > 254) {
      throw new Error("ADMIN_EMAIL must be a valid email address.");
    }
    if (!password || password.length < 16) {
      throw new Error("Set ADMIN_PASSWORD to a one-time password of at least 16 characters.");
    }
    const passwordHash = await bcrypt.hash(password, 12);
    return await ctx.runMutation(internal.auth.resetSeededAdminPassword, {
      email,
      passwordHash,
    });
  },
});
