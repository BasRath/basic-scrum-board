export const statuses = ["todo", "in-progress", "done"] as const;
export type TicketStatus = (typeof statuses)[number];

export interface Ticket {
  id: number;
  title: string;
  description: string;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
}
