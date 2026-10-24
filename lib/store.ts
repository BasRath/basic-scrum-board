import { BlobError, BlobPreconditionFailedError, get, put } from "@vercel/blob";
import type { Ticket } from "./tickets";

interface Board {
  nextId: number;
  tickets: Ticket[];
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const pathname = "scrum-board/board.json";

async function readBoard(): Promise<{ board: Board; etag?: string }> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new ApiError(503, "Storage is not configured. Connect a private Vercel Blob store.");
  }
  // Compressed responses carry a weak ETag (W/"…"), which never satisfies a
  // conditional write and would leave the board permanently unwritable.
  const result = await get(pathname, {
    access: "private", useCache: false, headers: { "accept-encoding": "identity" },
  });
  if (!result) return { board: { nextId: 1, tickets: [] } };
  if (result.statusCode !== 200) throw new Error("Unexpected storage response");
  const etag = result.blob.etag.replace(/^W\//, "");
  if (!etag) throw new Error("Storage response is missing an ETag");
  const board: Board = await new Response(result.stream).json();
  if (!Number.isSafeInteger(board.nextId) || board.nextId < 1 || !Array.isArray(board.tickets)) {
    throw new Error("Invalid board data");
  }
  return { board, etag };
}

function isWriteConflict(error: unknown) {
  return error instanceof BlobPreconditionFailedError ||
    (error instanceof BlobError && /conflicting operation|already exists/i.test(error.message));
}

export async function listTickets() {
  return (await readBoard()).board.tickets;
}

export async function mutateBoard<T>(mutate: (board: Board) => T): Promise<T> {
  for (let attempt = 0; attempt < 8; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** Math.min(attempt, 5) * Math.random()));
    const { board, etag } = await readBoard();
    const result = mutate(board);
    try {
      await put(pathname, JSON.stringify(board), {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: Boolean(etag),
        ...(etag ? { ifMatch: etag } : {}),
      });
      return result;
    } catch (error) {
      // Covers ETag mismatches, simultaneous writes, and another request
      // initializing the previously empty store.
      if (isWriteConflict(error)) continue;
      throw error;
    }
  }
  throw new ApiError(409, "The board is busy. Please try again.");
}
