import { z } from "zod"

import { requireAccess } from "@/lib/actions/access"
import { defineAction } from "@/lib/actions/define"
import { translate } from "@/lib/llm"

// Lowercase, matching how ids are stored and named in Nextcloud.
const uuid = z.uuid().transform((value) => value.toLowerCase())

export const translateText = defineAction({
  name: "translate_text",
  title: "翻譯",
  description:
    "Translates text selected in a document into Traditional Chinese (or into English when it is Chinese), read in the text around it: the translation, and for a word its part of speech, pronunciation, senses and examples, for a phrase its use and examples, for a sentence its role in the paragraph.",
  kind: "query",
  guests: true,
  mcpExcludedBecause:
    "An agent reads and translates by itself; this only asks a model on behalf of a person reading the page.",
  input: z.object({
    id: uuid,
    text: z.string().trim().min(1).max(2000, "選的文字太長，翻不了"),
    context: z.string().max(4000),
  }),
  run: async (actor, { id, text, context }) => {
    await requireAccess(actor, id, "view")
    try {
      return await translate({ text, context })
    } catch (error) {
      // The cause goes to the log; the reader only needs to know it failed.
      console.error("translate_text", error)
      throw new Error("翻譯失敗")
    }
  },
})
