import {
  addAnnotation,
  addComment,
  deleteAnnotation,
  deleteComment,
  editComment,
  listAnnotations,
  resolveAnnotation,
} from "@/lib/actions/annotations"
import type { Action } from "@/lib/actions/define"
import {
  deleteDocument,
  getDocument,
  getDocumentPdf,
  listDocuments,
  listShares,
  renameDocument,
  shareDocument,
  unshareDocument,
  uploadDocument,
} from "@/lib/actions/documents"
import {
  createGuestLink,
  guestLinkInfo,
  joinAsGuest,
  listGuestLinks,
  revokeGuestLink,
} from "@/lib/actions/guests"
import { listMembers } from "@/lib/actions/members"
import {
  importNextcloudFile,
  linkNextcloud,
  listNextcloudFiles,
  nextcloudStatus,
  unlinkNextcloud,
} from "@/lib/actions/nextcloud"
import { whoami } from "@/lib/actions/users"

/** Every action, in the order MCP lists them. */
export const actions: Action[] = [
  whoami,
  listDocuments,
  getDocument,
  getDocumentPdf,
  uploadDocument,
  renameDocument,
  deleteDocument,
  listShares,
  shareDocument,
  unshareDocument,
  listAnnotations,
  addAnnotation,
  deleteAnnotation,
  resolveAnnotation,
  addComment,
  editComment,
  deleteComment,
  listMembers,
  createGuestLink,
  listGuestLinks,
  revokeGuestLink,
  guestLinkInfo,
  joinAsGuest,
  nextcloudStatus,
  linkNextcloud,
  unlinkNextcloud,
  listNextcloudFiles,
  importNextcloudFile,
]
