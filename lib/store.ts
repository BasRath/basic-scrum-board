import { BlobPreconditionFailedError, get, put } from "@vercel/blob";
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
  const result = await get(pathname, { access: "private", useCache: false });
  if (!result) return { board: { nextId: 1, tickets: [] } };
  if (result.statusCode !== 200) throw new Error("Unexpected storage response");
  const board: Board = await new Response(result.stream).json();
  if (!Number.isSafeInteger(board.nextId) || board.nextId < 1 || !Array.isArray(board.tickets)) {
    throw new Error("Invalid board data");
  }
  return { board, etag: result.blob.etag };
}

export async function listTickets() {
  return (await readBoard()).board.tickets;
}

export async function mutateBoard<T>(mutate: (board: Board) => T): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
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
      if (error instanceof BlobPreconditionFailedError) continue;
      // Another request may have initialized the previously empty store.
      if (!etag && (await readBoard()).etag) continue;
      throw error;
    }
  }
  throw new ApiError(409, "The board is busy. Please try again.");
}
