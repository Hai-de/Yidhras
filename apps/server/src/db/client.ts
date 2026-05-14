import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '@prisma/client'

let defaultPrisma: PrismaClient | null = null

export const createPrismaClient = (databaseUrl?: string): PrismaClient => {
  const url = databaseUrl ?? process.env.DATABASE_URL ?? 'file:./data/dev.sqlite'
  const adapter = new PrismaBetterSqlite3({ url })
  return new PrismaClient({ adapter })
}

export const getDefaultPrisma = (): PrismaClient => {
  if (!defaultPrisma) {
    defaultPrisma = createPrismaClient()
  }
  return defaultPrisma
}
