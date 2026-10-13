"use node";

import bcrypt from "bcryptjs";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { FunctionReference } from "convex/server";

type CreateSeededAdmin = FunctionReference<
  "mutation",
  "internal",
  { email: string; passwordHash: string },
  { created: boolean; email: string; passwordReset?: boolean }
>;
const createSeededAdmin = (internal.auth as unknown as { createSeededAdmin: CreateSeededAdmin }).createSeededAdmin;

const ADMIN_EMAIL = "admin@navi.local";
const ADMIN_PASSWORD = "NaviAdmin123!";

export const seedAdmin = action({
  args: {},
  handler: async (ctx): Promise<{ created: boolean; email: string; passwordReset?: boolean }> => {
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    const result = await ctx.runMutation(createSeededAdmin, {
      email: ADMIN_EMAIL,
      passwordHash,
    });
    return result;

  },
});
