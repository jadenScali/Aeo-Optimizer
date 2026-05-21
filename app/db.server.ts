import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg(process.env.DATABASE_URL ?? "");
  return new PrismaClient({ adapter });
}

/**
 * In development, `global.prismaGlobal` can outlive `prisma generate`. An old
 * client instance will not expose new models (e.g. aiReferrerDailyStat), which
 * throws when calling findMany on undefined.
 */
function isClientInSync(client: PrismaClient | undefined): boolean {
  return (
    client != null &&
    typeof client.aiReferrerDailyStat?.findMany === "function"
  );
}

function getPrisma(): PrismaClient {
  if (process.env.NODE_ENV === "production") {
    if (!global.prismaGlobal) {
      global.prismaGlobal = createPrismaClient();
    }
    return global.prismaGlobal;
  }

  if (!isClientInSync(global.prismaGlobal)) {
    void global.prismaGlobal?.$disconnect().catch(() => {});
    global.prismaGlobal = createPrismaClient();
  }
  return global.prismaGlobal as PrismaClient;
}

const prisma = getPrisma();

export default prisma;
