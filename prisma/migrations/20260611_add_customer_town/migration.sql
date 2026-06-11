-- Add town field to Customer model
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "town" TEXT;
