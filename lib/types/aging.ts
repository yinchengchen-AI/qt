export const AGING_BUCKET_KEYS = ["0-30", "31-60", "61-90", "90+"] as const;
export type AgingBucketKey = (typeof AGING_BUCKET_KEYS)[number];
export type AgingBuckets = Record<AgingBucketKey, number>;
