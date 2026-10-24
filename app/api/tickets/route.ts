import { failure, json, readInput } from "@/lib/api";
import { ApiError, listTickets, mutateBoard } from "@/lib/store";
import type { Ticket } from "@/lib/tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return json({ tickets: await listTickets() });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = await readInput(request);
    const ticket = await mutateBoard((board) => {
      if (board.tickets.length >= 5000 || board.nextId >= Number.MAX_SAFE_INTEGER) {
        throw new ApiError(409, "Board capacity reached. Delete old tickets first.");
      }
      const now = new Date().toISOString();
      const ticket: Ticket = {
        id: board.nextId++,
        title: input.title!,
        description: input.description!,
        status: "todo",
        createdAt: now,
        updatedAt: now,
      };
      board.tickets.push(ticket);
      return ticket;
    });
    return json({ ticket }, 201);
  } catch (error) {
    return failure(error);
  }
}
