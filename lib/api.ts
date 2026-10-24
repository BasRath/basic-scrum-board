import { ApiError } from "./store";
import { statuses, type Ticket } from "./tickets";

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function failure(error: unknown) {
  if (error instanceof ApiError) return json({ error: error.message }, error.status);
  return json({ error: "Storage is temporarily unavailable. Please try again." }, 503);
}

export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site" ||
      (origin && origin !== new URL(request.url).origin)) {
    throw new ApiError(403, "Cross-origin writes are not allowed.");
  }
}

export async function readInput(request: Request, editing = false) {
  checkOrigin(request);
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    throw new ApiError(415, "Use Content-Type: application/json.");
  }
  // Enforce the bound while streaming, including requests without Content-Length.
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "A JSON body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 65536) {
      await reader.cancel();
      throw new ApiError(413, "Request body exceeds 64 KiB.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApiError(400, "Invalid JSON.");
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ApiError(400, "Expected a JSON object.");
  }
  const allowed = editing ? ["title", "description", "status", "updatedAt"] : ["title", "description"];
  if (Object.keys(input).some((key) => !allowed.includes(key))) {
    throw new ApiError(400, "Unexpected ticket field.");
  }
  const data: Partial<Pick<Ticket, "title" | "description" | "status" | "updatedAt">> = {};
  if (!editing || "title" in input) {
    if (typeof input.title !== "string" || !input.title.trim() || input.title.trim().length > 160) {
      throw new ApiError(400, "Title must contain 1–160 characters.");
    }
    data.title = input.title.trim();
  }
  if (!editing || "description" in input) {
    if (input.description !== undefined && typeof input.description !== "string") {
      throw new ApiError(400, "Description must be text.");
    }
    const description = (input.description as string | undefined) ?? "";
    if (description.length > 10000) throw new ApiError(400, "Description exceeds 10,000 characters.");
    data.description = description;
  }
  if ("status" in input) {
    if (!statuses.includes(input.status as Ticket["status"])) throw new ApiError(400, "Invalid status.");
    data.status = input.status as Ticket["status"];
  }
  if (editing) {
    if (typeof input.updatedAt !== "string" || !Number.isFinite(Date.parse(input.updatedAt))) {
      throw new ApiError(400, "Include the ticket's updatedAt value to prevent overwriting edits.");
    }
    if (!["title", "description", "status"].some((key) => key in input)) {
      throw new ApiError(400, "Include at least one field to update.");
    }
    data.updatedAt = input.updatedAt;
  }
  return data;
}

export function ticketId(value: string) {
  const id = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(id)) throw new ApiError(400, "Invalid ticket ID.");
  return id;
}
