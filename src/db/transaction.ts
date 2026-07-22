import type { Database } from "./client.js";

export type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export function runInTransaction<T>(
  database: Database,
  operation: (transaction: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  return database.transaction(operation);
}
