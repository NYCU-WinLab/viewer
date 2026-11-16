import {
  addAnnotation,
  addComment,
  deleteAnnotation,
  deleteComment,
  editComment,
  listAnnotations,
  resolveAnnotation,
} from "@/lib/actions/annotations"
import { askClaude, explainText, summarizeNotes } from "@/lib/actions/claude"
import type { Action } from "@/lib/actions/define"
import {
  deleteDocument,
  getDocument,
  getDocumentPdf,
  listDocuments,
  listShares,
  listDocumentPeople,
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
import { getMemberAvatar, listMembers } from "@/lib/actions/members"
import {
  checkNextcloudVersion,
  importNextcloudFile,
  linkNextcloud,
  listNextcloudFiles,
  nextcloudStatus,
  syncNextcloudVersion,
  unlinkNextcloud,
} from "@/lib/actions/nextcloud"
import { translateText } from "@/lib/actions/translate"
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
  listDocumentPeople,
  shareDocument,
  unshareDocument,
  listAnnotations,
  addAnnotation,
  deleteAnnotation,
  resolveAnnotation,
  addComment,
  editComment,
  deleteComment,
  translateText,
  explainText,
  askClaude,
  summarizeNotes,
  listMembers,
  getMemberAvatar,
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
  checkNextcloudVersion,
  syncNextcloudVersion,
]
