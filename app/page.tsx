"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Ticket, TicketStatus } from "@/lib/tickets";

const columns: { status: TicketStatus; label: string; note: string; icon: string }[] = [
  { status: "todo", label: "To Do", note: "Every great plan starts here.", icon: "○" },
  { status: "in-progress", label: "In Progress", note: "A little progress, every day.", icon: "◒" },
  { status: "done", label: "Done", note: "One less thing to worry about.", icon: "✓" },
];

type SortOrder = "newest" | "oldest" | "az" | "za";

const sortOptions: { value: SortOrder; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "az", label: "Title A–Z" },
  { value: "za", label: "Title Z–A" },
];

const titleCollator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

function sortTickets(items: Ticket[], order: SortOrder) {
  const byAge = (a: Ticket, b: Ticket) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id - b.id;
  const byTitle = (a: Ticket, b: Ticket) => titleCollator.compare(a.title, b.title) || byAge(a, b);
  const compare = { newest: (a: Ticket, b: Ticket) => byAge(b, a), oldest: byAge, az: byTitle, za: (a: Ticket, b: Ticket) => byTitle(b, a) }[order];
  return [...items].sort(compare);
}

function SortMenu({ label, value, onChange }: { label: string; value: SortOrder; onChange: (value: SortOrder) => void }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = `sort-menu-${label.toLowerCase().replace(/\s+/g, "-")}`;

  useEffect(() => {
    if (!open) return;
    container.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const move = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (move) {
      event.preventDefault();
      items[(index + move + items.length) % items.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div className="sort-menu" ref={container}>
      <button ref={trigger} type="button" className="sort-button" aria-label={`Sort ${label} tickets`} title="Sort tickets"
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}>
        <span aria-hidden="true">···</span>
      </button>
      {open && <div id={menuId} className="sort-options" role="menu" aria-label={`Sort ${label}`} onKeyDown={onMenuKeyDown}>
        <span className="sort-heading" aria-hidden="true">Sort by</span>
        {sortOptions.map((option) => <button key={option.value} type="button" role="menuitemradio" aria-checked={value === option.value}
          tabIndex={-1} onClick={() => { onChange(option.value); close(); }}>
          <span className="sort-check" aria-hidden="true">{value === option.value ? "✓" : ""}</span>{option.label}
        </button>)}
      </div>}
    </div>
  );
}

function date(value: string, full = false) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short", day: "numeric", ...(full ? { year: "numeric" } : {}),
  });
}

async function responseData(response: Response) {
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      response.status === 409
        ? data?.error || "The board changed or is busy. Refresh the board and try again."
        : data?.error || `Request failed (${response.status}). Please try again.`,
    );
  }
  if (!data) throw new Error("The server returned an unexpected response. Please try again.");
  return data;
}

function Modal({ title, children, onClose, busy = false, wide = false }: {
  title: string; children: ReactNode; onClose: () => void; busy?: boolean; wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    element.querySelector<HTMLElement>("input, textarea, select")?.focus();
    return () => {
      element.close();
      if (previous?.isConnected) previous.focus();
      else document.getElementById("create-ticket")?.focus();
    };
  }, []);
  return (
    <dialog ref={dialog} className={`modal ${wide ? "modal-wide" : ""}`} aria-labelledby="modal-title"
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <div className="modal-heading">
        <h2 id="modal-title">{title}</h2>
        <button type="button" className="icon-button" aria-label="Close dialog" disabled={busy} onClick={onClose}>×</button>
      </div>
      {children}
    </dialog>
  );
}

export default function Home() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [modal, setModal] = useState<"create" | "detail" | "docs" | null>(null);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TicketStatus>("todo");
  const [pending, setPending] = useState(false);
  const [modalError, setModalError] = useState("");
  const [notice, setNotice] = useState("");
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [sortOrders, setSortOrders] = useState<Record<TicketStatus, SortOrder>>({ todo: "newest", "in-progress": "newest", done: "newest" });
  const poll = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const mutating = useRef(false);
  const mutationController = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (mutating.current) return;
    poll.current?.abort();
    const controller = new AbortController();
    poll.current = controller;
    const current = ++generation.current;
    setRefreshing(true);
    try {
      const data = await responseData(await fetch("/api/tickets", { signal: controller.signal, cache: "no-store" }));
      if (current !== generation.current || controller.signal.aborted) return;
      if (!Array.isArray(data.tickets)) throw new Error("Could not read the board. Please try again.");
      setTickets(data.tickets);
      setError("");
      setLastSync(new Date());
    } catch (cause) {
      if (!controller.signal.aborted && current === generation.current)
        setError(cause instanceof Error ? cause.message : "Could not load the board. Please try again.");
    } finally {
      if (current === generation.current) { setLoading(false); setRefreshing(false); }
    }
  }, []);

  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const interval = setInterval(() => void refresh(), 30_000);
    return () => {
      clearInterval(interval);
      clearTimeout(initial);
      poll.current?.abort();
      mutationController.current?.abort();
    };
  }, [refresh]);

  function closeModal() {
    if (mutating.current) return;
    setModal(null);
    setModalError("");
    setConfirmDelete(false);
  }

  function openCreate() {
    setTitle(""); setDescription(""); setStatus("todo");
    setModalError(""); setModal("create");
  }

  function openTicket(ticket: Ticket) {
    setSelected(ticket); setTitle(ticket.title); setDescription(ticket.description);
    setStatus(ticket.status); setEditing(false); setConfirmDelete(false);
    setModalError(""); setModal("detail");
  }

  async function mutate(action: "create" | "save" | "delete", movement?: { ticket: Ticket; status: TicketStatus }) {
    if (mutating.current) return;
    if (action !== "delete" && !movement && (!title.trim() || !description.trim())) {
      setModalError("Title and description are required.");
      return;
    }
    const currentTicket = movement?.ticket ?? selected;
    mutating.current = true;
    poll.current?.abort();
    generation.current++;
    const controller = new AbortController();
    let shouldRefresh = false;
    mutationController.current = controller;
    setPending(true); setRefreshing(false); setLoading(false); setModalError(""); setNotice("");
    try {
      const data = await responseData(await fetch(
        action === "create" ? "/api/tickets" : `/api/tickets/${currentTicket!.id}`,
        {
          method: action === "create" ? "POST" : action === "save" ? "PATCH" : "DELETE",
          signal: controller.signal,
          ...(action === "delete" ? {} : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(movement ? {
              status: movement.status, updatedAt: movement.ticket.updatedAt,
            } : {
              title: title.trim(), description,
              ...(action === "save" ? { status, updatedAt: currentTicket!.updatedAt } : {}),
            }),
          }),
        },
      ));
      if (action === "delete") {
        setTickets((previous) => previous.filter((ticket) => ticket.id !== currentTicket!.id));
        setNotice(`Ticket #${currentTicket!.id} deleted.`);
        setModal(null);
      } else {
        const ticket: Ticket = data.ticket;
        if (!ticket || typeof ticket.id !== "number") throw new Error("The server returned an unexpected ticket. Refresh the board before trying again.");
        setTickets((previous) => action === "create"
          ? [ticket, ...previous.filter((item) => item.id !== ticket.id)]
          : previous.some((item) => item.id === ticket.id)
            ? previous.map((item) => item.id === ticket.id ? ticket : item)
            : [ticket, ...previous]);
        if (!movement) {
          setSelected(ticket); setEditing(false);
          setModal(null);
        }
        setNotice(`Ticket #${ticket.id} ${action === "create" ? "created" : "updated"}.`);
      }
      setError("");
      setLastSync(new Date());
    } catch (cause) {
      if (!controller.signal.aborted) {
        shouldRefresh = true;
        const message = cause instanceof Error ? cause.message : "Something went wrong. Please try again.";
        if (movement) setError(message);
        else setModalError(message);
      }
    } finally {
      mutating.current = false;
      setPending(false);
      if (shouldRefresh && !movement) void refresh();
    }
  }

  const doneCount = tickets.filter((ticket) => ticket.status === "done").length;
  const progress = tickets.length ? Math.round(doneCount / tickets.length * 100) : 0;

  return (
    <div className="site-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Scrum shelter home"><span className="brand-icon">✳</span> scrum<span className="brand-light">shelter</span><span className="brand-dot">.</span></Link>
        <div className="header-note"><span className="live-dot" /> A little organized. A lot prepared.</div>
        <span className="version-tag">EST. END OF THE WORLD</span>
      </header>

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <div className="eyebrow"><span /> YOUR CALM BEFORE THE STORM</div>
            <h1 id="hero-title">Big plans.<br /><span>Tiny steps.</span> We got this.</h1>
            <p>For the everyday tasks and the end-of-days plans.<br className="desktop-break" /> Get your crew on the same page, one ticket at a time.</p>
            <button id="create-ticket" className="button primary" onClick={openCreate}><span aria-hidden="true">＋</span> Create Ticket <span className="button-arrow" aria-hidden="true">↗</span></button>
            <div className="hero-footnote"><span aria-hidden="true">♡</span> Less chaos. More canned peaches.</div>
          </div>
          <div className="hero-art">
            <span className="art-orbit orbit-one" /><span className="art-orbit orbit-two" />
            <span className="art-star star-one">✦</span><span className="art-star star-two">✧</span>
            <span className="art-label"><span className="live-dot" /> PREPARED, NOT PANICKED</span>
            <Image src="/scrum-girl.svg" alt="Cheerful pink-haired prepper with a survival backpack holding a scrum board sign" width={410} height={342} priority />
            <span className="art-caption">your friendly neighborhood task survivor</span>
          </div>
        </section>

        <section className="board-section" aria-labelledby="board-title">
          <div className="board-toolbar">
            <div className="board-heading"><span className="grid-icon" aria-hidden="true">▦</span><h2 id="board-title">The survival plan</h2><span className="ticket-total">{tickets.length} tickets</span></div>
            <div className="sync-status"><span className={error ? "warning-dot" : "live-dot"} /><span>{loading ? "Connecting to shelter…" : refreshing ? "Syncing board…" : error ? "Sync interrupted" : "Live · syncs every 30s"}</span><button className="refresh-button" aria-label="Refresh board" disabled={refreshing || pending} onClick={() => void refresh()}>↻</button></div>
          </div>
          <div className="shared-note"><span aria-hidden="true">◎</span> One board. Your whole crew. <span>Everyone with this URL can view, edit, and delete tickets.</span></div>
          {error && <div className="error-banner" role="alert"><span>{error} Your existing tickets are still here.</span><button disabled={refreshing || pending} onClick={() => void refresh()}>Try again</button></div>}
          <div className="sr-only" role="status" aria-live="polite">{notice}</div>
          {loading && <div className="loading-message" role="status">Gathering your supplies… loading tickets.</div>}
          <div className="board-grid" aria-busy={loading}>
            {columns.map((column) => {
              const items = sortTickets(tickets.filter((ticket) => ticket.status === column.status), sortOrders[column.status]);
              return (
                <section className={`board-column ${column.status}`} key={column.status} aria-labelledby={`column-${column.status}`}
                  onDragOver={(event) => {
                    if (draggedId === null || pending) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const ticket = tickets.find((item) => item.id === draggedId);
                    setDraggedId(null);
                    if (ticket && ticket.status !== column.status && !pending) {
                      void mutate("save", { ticket, status: column.status });
                    }
                  }}>
                  <div className="column-heading"><span className="status-icon" aria-hidden="true">{column.icon}</span><h3 id={`column-${column.status}`}>{column.label}</h3><span className="column-count">{items.length}</span><SortMenu label={column.label} value={sortOrders[column.status]} onChange={(order) => setSortOrders((previous) => ({ ...previous, [column.status]: order }))} /></div>
                  <p className="column-note">{column.note}</p>
                  <div className="card-list">
                    {items.map((ticket) => <button className="ticket-card" key={ticket.id} disabled={pending}
                      draggable={!pending}
                      onDragStart={(event) => {
                        event.dataTransfer.setData("text/plain", String(ticket.id));
                        event.dataTransfer.effectAllowed = "move";
                        setDraggedId(ticket.id);
                      }}
                      onDragEnd={() => setDraggedId(null)}
                      onClick={() => openTicket(ticket)} aria-label={`Open ticket #${ticket.id}: ${ticket.title}`}>
                      <span className="card-meta"><span className="ticket-id">#{ticket.id}</span><time dateTime={ticket.createdAt}>{date(ticket.createdAt)}</time></span>
                      <span className="card-title">{ticket.title}</span>
                      {ticket.description && <span className="card-description">{ticket.description}</span>}
                      <span className="card-bottom"><span className="card-status"><span />{column.label}</span><span aria-hidden="true">↗</span></span>
                    </button>)}
                    {!items.length && <div className="empty-state"><span className="empty-icon" aria-hidden="true">{column.status === "done" ? "✧" : column.status === "todo" ? "☷" : "◷"}</span><strong>{loading ? "Getting ready…" : column.status === "todo" ? "A fresh start" : column.status === "in-progress" ? "Room for a little momentum" : "Small wins live here"}</strong><p>{column.status === "todo" ? "Add a ticket. Make a little plan." : column.status === "in-progress" ? "Edit a ticket’s status to get it moving." : "Finished something? Send it this way."}</p></div>}
                  </div>
                  {column.status === "todo" && <button className="add-ticket" onClick={openCreate}><span aria-hidden="true">＋</span> Add a ticket</button>}
                </section>
              );
            })}
          </div>
          <div className="board-bottom">
            <span><span aria-hidden="true">✦</span> Progress is progress. Even during the apocalypse.</span>
            <div className="progress-summary"><span>{doneCount} of {tickets.length} safely done</span><div className="progress-track" role="progressbar" aria-label="Tickets completed" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div><strong>{progress}%</strong></div>
          </div>
        </section>
      </main>

      <footer className="footer"><span>Built for the little things. <span className="footer-heart">And whatever comes next. ♡</span></span><div><span className="last-sync">{lastSync ? `Last synced ${lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Make yourself at home."}</span><button className="api-button" onClick={() => setModal("docs")}><span aria-hidden="true">{"{ }"}</span> api-spec <span aria-hidden="true">↗</span></button></div></footer>

      {modal === "create" && <Modal title="A little plan starts here." onClose={closeModal} busy={pending}>
        <p className="modal-subtitle">Create a ticket for your crew. It’ll land in To Do.</p>
        <form onSubmit={(event) => { event.preventDefault(); void mutate("create"); }}>
          <fieldset disabled={pending} className="form-fields">
            <label htmlFor="ticket-title">Title <span>required · {title.length}/160</span></label>
            <input id="ticket-title" name="title" autoFocus required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Stock the emergency snack drawer" />
            <label htmlFor="ticket-description">Description <span>required · {description.length}/10,000</span></label>
            <textarea id="ticket-description" name="description" required maxLength={10000} rows={6} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="The details, the checklist, the grand plan…" />
          </fieldset>
          <p className="form-hint">Shared board: everyone with this URL can edit this ticket. Don’t include secrets.</p>
          {modalError && <p className="form-error" role="alert">{modalError}</p>}
          <div className="modal-actions"><button type="button" className="button secondary" disabled={pending} onClick={closeModal}>Cancel</button><button type="submit" className="button primary" disabled={pending || !title.trim() || !description.trim()}>{pending ? "Creating…" : "Create Ticket"}</button></div>
        </form>
      </Modal>}

      {modal === "detail" && selected && <Modal title={confirmDelete ? `Delete ticket #${selected.id}?` : `Ticket #${selected.id}`} onClose={closeModal} busy={pending}>
        {confirmDelete ? <>
          <p className="delete-warning">This permanently removes <strong>{selected.title}</strong> from the shared board for everyone. This can’t be undone.</p>
          {modalError && <p className="form-error" role="alert">{modalError}</p>}
          <div className="modal-actions"><button autoFocus className="button secondary" disabled={pending} onClick={() => { setConfirmDelete(false); setModalError(""); }}>Keep ticket</button><button className="button danger" disabled={pending} onClick={() => void mutate("delete")}>{pending ? "Deleting…" : "Delete ticket"}</button></div>
        </> : <form onSubmit={(event) => { event.preventDefault(); if (editing) void mutate("save"); }}>
          {editing ? <fieldset className="form-fields" disabled={pending}>
            <label htmlFor="edit-title">Title <span>required · {title.length}/160</span></label>
            <input autoFocus id="edit-title" required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} />
            <label htmlFor="edit-description">Description <span>required · {description.length}/10,000</span></label>
            <textarea id="edit-description" required rows={7} maxLength={10000} value={description} onChange={(event) => setDescription(event.target.value)} />
            <label htmlFor="edit-status">Status</label>
            <select id="edit-status" value={status} onChange={(event) => setStatus(event.target.value as TicketStatus)}>{columns.map((column) => <option value={column.status} key={column.status}>{column.label}</option>)}</select>
          </fieldset> : <div className="ticket-detail"><span className={`detail-badge ${selected.status}`}>{columns.find((column) => column.status === selected.status)?.label}</span><h3>{selected.title}</h3><p>{selected.description || "No description yet. A little mystery never hurt a plan."}</p></div>}
          {modalError && <p className="form-error" role="alert">{modalError}</p>}
          <div className="ticket-dates"><span>Created <time dateTime={selected.createdAt}>{date(selected.createdAt, true)}</time></span><span>Updated <time dateTime={selected.updatedAt}>{date(selected.updatedAt, true)}</time></span></div>
          <div className="modal-actions detail-actions"><button type="button" className="delete-button" disabled={pending} onClick={() => { setConfirmDelete(true); setModalError(""); }}>Delete ticket</button><div>{editing && <button type="button" className="button secondary" disabled={pending} onClick={() => { setEditing(false); setTitle(selected.title); setDescription(selected.description); setStatus(selected.status); setModalError(""); }}>Cancel</button>}{editing ? <button key="save" type="submit" className="button mint" disabled={pending || !title.trim() || !description.trim()}>{pending ? "Saving…" : "Save changes"}</button> : <button key="edit" type="button" className="button primary" onClick={(event) => { event.preventDefault(); setEditing(true); }}>Edit ticket <span aria-hidden="true">↗</span></button>}</div></div>
        </form>}
      </Modal>}

      {modal === "docs" && <Modal title="The shelter API" onClose={closeModal} wide>
        <p className="modal-subtitle">Simple REST. Same-origin JSON. A shared plan for everyone.</p>
        <div className="docs-warning"><strong>Public, collaborative board — no authentication.</strong><br />Anyone with this URL can read, create, update, or delete tickets. Never store passwords, personal information, or other secrets.</div>
        <div className="api-docs">
          <h3>Endpoints <span>application/json</span></h3>
          <details open><summary><span className="method get">GET</span><code>/api/tickets</code><span>List tickets</span></summary><p>200 · All tickets. The board polls this endpoint every 30 seconds.</p><pre>{'{ "tickets": [Ticket] }'}</pre></details>
          <details><summary><span className="method get">GET</span><code>/api/tickets/{"{id}"}</code><span>Read ticket</span></summary><p>200 · Read one ticket by its positive integer ID. Returns 404 if the ticket does not exist.</p><pre>{'{ "ticket": Ticket }'}</pre></details>
          <details><summary><span className="method post">POST</span><code>/api/tickets</code><span>Create ticket</span></summary><p>201 · New tickets start in To Do. Send:</p><pre>{'{\n  "title": "Pack the go-bag",\n  "description": "Snacks, flashlight, good vibes."\n}'}</pre><p>Response: <code>{'{ "ticket": Ticket }'}</code></p></details>
          <details><summary><span className="method patch">PATCH</span><code>/api/tickets/{"{id}"}</code><span>Update ticket</span></summary><p>200 · Send changed fields and the ticket’s most recent updatedAt value. This optimistic concurrency guard prevents overwriting someone else’s work.</p><pre>{'{\n  "title": "Pack the go-bag",\n  "description": "Snacks secured.",\n  "status": "done",\n  "updatedAt": "2026-01-01T12:00:00.000Z"\n}'}</pre><p>Response: <code>{'{ "ticket": Ticket }'}</code>. On 409, fetch the latest ticket before retrying.</p></details>
          <details><summary><span className="method del">DELETE</span><code>/api/tickets/{"{id}"}</code><span>Delete ticket</span></summary><p>204 · Permanently deletes the ticket. No request body or response body.</p></details>
          <h3>Ticket schema</h3><pre>{'{\n  "id": 1,\n  "title": "Pack the go-bag",\n  "description": "Snacks, flashlight, good vibes.",\n  "status": "todo",\n  "createdAt": "2026-01-01T12:00:00.000Z",\n  "updatedAt": "2026-01-01T12:00:00.000Z"\n}'}</pre>
          <p><strong>Limits:</strong> title and description are required on creation and cannot be blank when updated. Title is 1–160 characters after trimming; description up to 10,000 characters. Request bodies are limited to 64 KiB; unknown fields are rejected. PATCH requires at least one editable field and the latest <code>updatedAt</code>. Status: <code>todo</code>, <code>in-progress</code>, or <code>done</code>. IDs are positive integers; timestamps are server-generated ISO dates. Writes must be same-origin; POST and PATCH require <code>Content-Type: application/json</code>.</p>
          <h3>Errors</h3><p><code>{'{ "error": "Human-readable message" }'}</code></p><dl className="error-codes"><dt>400</dt><dd>Invalid input, unknown fields, or malformed JSON</dd><dt>403</dt><dd>Cross-origin write rejected</dd><dt>404</dt><dd>Ticket not found</dd><dt>409</dt><dd>Stale edit: reload the ticket before saving. Board contention: wait and retry. Board capacity reached: delete old tickets first.</dd><dt>413</dt><dd>Request body exceeds 64 KiB</dd><dt>415</dt><dd>Unsupported media type — use application/json</dd><dt>500 / 503</dt><dd>Server or storage unavailable — try again later</dd></dl>
        </div>
        <div className="modal-actions"><button className="button primary" onClick={closeModal}>Got it</button></div>
      </Modal>}
    </div>
  );
}
