import { checkOrigin, failure, json, readInput, ticketId } from "@/lib/api";
import { ApiError, listTickets, mutateBoard } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const id = ticketId((await context.params).id);
    const ticket = (await listTickets()).find((ticket) => ticket.id === id);
    if (!ticket) throw new ApiError(404, "Ticket not found.");
    return json({ ticket });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const id = ticketId((await context.params).id);
    const input = await readInput(request, true);
    const ticket = await mutateBoard((board) => {
      const ticket = board.tickets.find((ticket) => ticket.id === id);
      if (!ticket) throw new ApiError(404, "Ticket not found.");
      if (ticket.updatedAt !== input.updatedAt) {
        throw new ApiError(409, "This ticket changed. Close and reopen it before editing.");
      }
      const updatedAt = new Date(Math.max(Date.now(), Date.parse(ticket.updatedAt) + 1)).toISOString();
      Object.assign(ticket, input, { updatedAt });
      return ticket;
    });
    return json({ ticket });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    checkOrigin(request);
    const id = ticketId((await context.params).id);
    await mutateBoard((board) => {
      const index = board.tickets.findIndex((ticket) => ticket.id === id);
      if (index < 0) throw new ApiError(404, "Ticket not found.");
      board.tickets.splice(index, 1);
    });
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
