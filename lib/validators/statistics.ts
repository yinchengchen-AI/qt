import { z } from "zod";

const dateStr = z.string().optional().transform((v) => (v ? new Date(v) : undefined));
export const dateRangeSchema = z.object({ from: dateStr, to: dateStr });
