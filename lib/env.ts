import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    NEXTAUTH_SECRET: z.string().min(32),
    NEXTAUTH_URL: z.string().url().optional(),
    APP_ENC_KEY_HEX: z.string().regex(/^[0-9a-fA-F]{64}$/).default("0".repeat(64))
  },
  client: {},
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    APP_ENC_KEY_HEX: process.env.APP_ENC_KEY_HEX
  },
  emptyStringAsUndefined: true
});
