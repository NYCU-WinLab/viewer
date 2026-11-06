"use server"

import type { z } from "zod"

import {
  addAnnotation,
  addComment,
  deleteAnnotation,
  deleteComment,
  editComment,
  resolveAnnotation,
} from "@/lib/actions/annotations"
import { type Action, errorMessage, runAction } from "@/lib/actions/define"
import {
  deleteDocument,
  listShares,
  renameDocument,
  shareDocument,
  unshareDocument,
} from "@/lib/actions/documents"
import { listMembers } from "@/lib/actions/members"
import { requireActor } from "@/lib/auth/session"

// Every page's writes, one wrapper each. A failure comes back as { error }
// for a toast; success returns the action's result. Open pages refresh
// through LiveRefresh, so nothing here revalidates.
async function call<Input extends z.ZodObject, Output>(
  action: Action<Input, Output>,
  input: unknown
): Promise<
  { data: Output; error?: undefined } | { error: string; data?: undefined }
> {
  const actor = await requireActor()
  try {
    return { data: await runAction(action, actor, input) }
  } catch (error) {
    return { error: errorMessage(error) }
  }
}

export const rename = async (input: unknown) => call(renameDocument, input)
export const remove = async (input: unknown) => call(deleteDocument, input)
export const loadShares = async (input: unknown) => call(listShares, input)
export const share = async (input: unknown) => call(shareDocument, input)
export const unshare = async (input: unknown) => call(unshareDocument, input)
export const loadMembers = async () => call(listMembers, {})

export const mark = async (input: unknown) => call(addAnnotation, input)
export const unmark = async (input: unknown) => call(deleteAnnotation, input)
export const resolve = async (input: unknown) => call(resolveAnnotation, input)
export const comment = async (input: unknown) => call(addComment, input)
export const reword = async (input: unknown) => call(editComment, input)
export const uncomment = async (input: unknown) => call(deleteComment, input)
