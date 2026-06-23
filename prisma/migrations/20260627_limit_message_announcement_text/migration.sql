-- Limit Message / Announcement title and content length to match frontend / Zod constraints
ALTER TABLE "Message" ALTER COLUMN "title" SET DATA TYPE VARCHAR(200);
ALTER TABLE "Message" ALTER COLUMN "content" SET DATA TYPE VARCHAR(10000);
ALTER TABLE "Announcement" ALTER COLUMN "title" SET DATA TYPE VARCHAR(200);
ALTER TABLE "Announcement" ALTER COLUMN "content" SET DATA TYPE VARCHAR(10000);
