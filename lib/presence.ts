// Who has a document open right now, and where their pointer is. Nothing
// here is stored: it lives in this server's memory (the viewer runs as one
// process) and is gone when the last tab closes. A tab joins through
// /api/presence/<id> (a server-sent event stream, opened after the access
// check) and gets a random connection id; it moves its cursor by posting
// that id back, so a cursor update needs no database round trip.
import { randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"

export type Cursor = { page: number; x: number; y: number } | null

export type Viewer = {
  /** One per open tab. */
  conn: string
  userId: string
  name: string
  image: string | null
  cursor: Cursor
}

export type PresenceEvent =
  | { type: "viewers"; viewers: Viewer[] }
  | { type: "cursor"; conn: string; cursor: Cursor }

type Room = { viewers: Map<string, Viewer>; events: EventEmitter }

const rooms = new Map<string, Room>()
/** Connection id to its document, so a cursor post finds its room. */
const connections = new Map<string, string>()

function roomOf(documentId: string) {
  let room = rooms.get(documentId)
  if (!room) {
    room = { viewers: new Map(), events: new EventEmitter() }
    room.events.setMaxListeners(0)
    rooms.set(documentId, room)
  }
  return room
}

function announce(room: Room, event: PresenceEvent) {
  room.events.emit("event", event)
}

const list = (room: Room) => [...room.viewers.values()]

/** Adds a tab to the document's room. Calls send with every event from now
 * on, starting with the room as it is; returns the connection id and a
 * function that leaves the room. */
export function join(
  documentId: string,
  who: { userId: string; name: string; image: string | null },
  send: (event: PresenceEvent) => void
) {
  const room = roomOf(documentId)
  const conn = randomUUID()
  room.viewers.set(conn, { conn, ...who, cursor: null })
  connections.set(conn, documentId)
  room.events.on("event", send)
  announce(room, { type: "viewers", viewers: list(room) })
  const leave = () => {
    room.events.off("event", send)
    if (!room.viewers.delete(conn)) return
    connections.delete(conn)
    if (room.viewers.size === 0) rooms.delete(documentId)
    else announce(room, { type: "viewers", viewers: list(room) })
  }
  return { conn, leave }
}

/** Moves one tab's cursor; false when the connection is gone. */
export function move(conn: string, cursor: Cursor) {
  const documentId = connections.get(conn)
  const room = documentId ? rooms.get(documentId) : undefined
  const viewer = room?.viewers.get(conn)
  if (!room || !viewer) return false
  viewer.cursor = cursor
  announce(room, { type: "cursor", conn, cursor })
  return true
}
