-- Expiring offline access tokens (session-storage-prisma v8) store a refresh token.
ALTER TABLE "Session" ADD COLUMN "refreshToken" TEXT;
ALTER TABLE "Session" ADD COLUMN "refreshTokenExpires" TIMESTAMP(3);
