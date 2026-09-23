import mongoose, { type ClientSession } from 'mongoose';

/**
 * Executes an operation within a MongoDB multi-document transaction.
 * If the operation throws, MongoDB aborts the transaction and rolls back
 * all modifications across all touched collections automatically.
 */
export async function withTransaction<T>(
  operation: (session: ClientSession) => Promise<T>
): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await operation(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}
