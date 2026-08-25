"use node";

import bcrypt from "bcryptjs";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";

const authInternal = internal.auth as any;

const ADMIN_EMAIL = "admin@navi.local";
const ADMIN_PASSWORD = "NaviAdmin123!";

export const seedAdmin = action({
  args: {},
  handler: async (ctx) => {
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    return await ctx.runMutation(authInternal.createSeededAdmin, {
      email: ADMIN_EMAIL,
      passwordHash,
    });

  },
});
