import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __giftflowPrisma: PrismaClient | undefined;
}

// One client per process. Vite reloads the module graph on every change in
// development, which would otherwise open a new pool on each save.
const prisma = global.__giftflowPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") global.__giftflowPrisma = prisma;

export default prisma;
