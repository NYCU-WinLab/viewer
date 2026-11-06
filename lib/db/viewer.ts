import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

import { user } from "@/lib/db/auth-schema"

// A document is what members open and comment on; its file changes over
// time, and each upload is a version. Files live in Nextcloud under
// <root>/<document id>/: v<n>.<ext> as uploaded and v<n>.pdf as shown.
export const documents = pgTable(
  "documents",
  {
    id: uuid().defaultRandom().primaryKey(),
    name: text().notNull(),
    ownerId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The newest version's number; 0 until the first one is ready. */
    latestVersion: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index().on(table.ownerId)]
)

export type DocumentKind = "pdf" | "docx" | "pptx"

export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid().defaultRandom().primaryKey(),
    documentId: uuid()
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    number: integer().notNull(),
    kind: text().$type<DocumentKind>().notNull(),
    /** The file name as uploaded, extension included. */
    fileName: text().notNull(),
    size: integer().notNull(),
    uploadedBy: uuid().references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique().on(table.documentId, table.number)]
)

export type Role = "view" | "comment" | "edit"

// Who else may open a document, and what they may do: view reads, comment
// also marks and writes notes, edit also uploads versions and shares. The
// owner can do everything and has no row here.
export const documentGrants = pgTable(
  "document_grants",
  {
    documentId: uuid()
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text().$type<Role>().notNull(),
    grantedBy: uuid().references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.documentId, table.userId] }),
    index().on(table.userId),
  ]
)

export type Tool = "highlight" | "box" | "pen"

/** Where a mark sits, in page fractions (0 to 1 from the top left), so it
 * holds at any zoom. highlight: the selected lines' boxes; box: one box;
 * pen: one stroke's points. */
export type Geometry =
  { rects: [number, number, number, number][] } | { points: [number, number][] }

/** The text under a mark when there is any, to find it again in a newer
 * version: the exact words and a little context on each side. */
export type Quote = { exact: string; prefix: string; suffix: string }

// A mark on one page of one version. Its sticky note is the thread of
// comments on it.
export const annotations = pgTable(
  "annotations",
  {
    id: uuid().defaultRandom().primaryKey(),
    documentId: uuid()
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    versionId: uuid()
      .notNull()
      .references(() => documentVersions.id, { onDelete: "cascade" }),
    authorId: uuid().references(() => user.id, { onDelete: "set null" }),
    tool: text().$type<Tool>().notNull(),
    /** 1-based. */
    page: integer().notNull(),
    geometry: jsonb().$type<Geometry>().notNull(),
    quote: jsonb().$type<Quote>(),
    resolvedAt: timestamp({ withTimezone: true }),
    resolvedBy: uuid().references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index().on(table.documentId)]
)

export const comments = pgTable(
  "comments",
  {
    id: uuid().defaultRandom().primaryKey(),
    annotationId: uuid()
      .notNull()
      .references(() => annotations.id, { onDelete: "cascade" }),
    authorId: uuid().references(() => user.id, { onDelete: "set null" }),
    body: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    editedAt: timestamp({ withTimezone: true }),
  },
  (table) => [index().on(table.annotationId)]
)

// Every earlier wording of an edited comment, so its changes can be shown.
export const commentRevisions = pgTable(
  "comment_revisions",
  {
    id: uuid().defaultRandom().primaryKey(),
    commentId: uuid()
      .notNull()
      .references(() => comments.id, { onDelete: "cascade" }),
    body: text().notNull(),
    /** When this wording was replaced. */
    replacedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index().on(table.commentId)]
)
