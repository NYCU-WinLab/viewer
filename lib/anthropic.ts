// The Claude API, asked to translate what a reader selects.
// ANTHROPIC_API_KEY comes from the environment (a key of the lab's Claude
// Console organization); without it the reader shows no translate button.
// TRANSLATE_MODEL picks another model.
import Anthropic from "@anthropic-ai/sdk"
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod"
import { z } from "zod"

const model = () => process.env.TRANSLATE_MODEL ?? "claude-opus-5-5"

export const canTranslate = () => !!process.env.ANTHROPIC_API_KEY

const answer = z.object({
  kind: z.enum(["word", "phrase", "sentence"]),
  translation: z.string(),
  partOfSpeech: z.string().nullable(),
  phonetic: z.string().nullable(),
  note: z.string().nullable(),
  examples: z.array(z.object({ source: z.string(), translation: z.string() })),
})

export type Translation = {
  /** What was selected, which decides what else comes with it. */
  kind: "word" | "phrase" | "sentence"
  translation: string
  /** A word's part of speech and pronunciation. */
  partOfSpeech?: string
  phonetic?: string
  /** A word's other senses, how a phrase is used, or what a sentence does
   * in its paragraph. */
  note?: string
  examples: { source: string; translation: string }[]
}

const system = `You help a graduate student in Taiwan read a document. Translate the selected text into Traditional Chinese as used in Taiwan; when the selected text is already Chinese, translate it into English instead. Read the context to choose the sense that fits, and translate only the selected text.

Fill the fields this way:
- kind: "word" for a single word, "phrase" for an idiom, collocation or term of a few words, "sentence" for a clause, a sentence or more.
- translation: the translation that fits this context.
- partOfSpeech: for a word only, in Traditional Chinese (名詞, 動詞, 形容詞); otherwise null.
- phonetic: for an English word only, in IPA between slashes; otherwise null.
- note: one or two short sentences in Traditional Chinese. For a word: what it means here, and its other common senses. For a phrase: what it means and when it is used. For a sentence: what it does in its paragraph, or the background a reader needs.
- examples: for a word or a phrase only, one or two short sentences in the language of the selected text, each with its translation. For a sentence, an empty list.`

let client: Anthropic | undefined

/** Translations already made, newest last, so the same selection answers
 * at once (one server process; a deploy starts it empty). */
const cache = new Map<string, Translation>()
const cacheSize = 2000

/** Translates the selected text, read in its context. Throws when the API
 * refuses or its answer does not fit the fields asked for. */
export async function translate(input: {
  text: string
  context: string
}): Promise<Translation> {
  if (!canTranslate()) throw new Error("翻譯還沒設定")
  const key = `${model()}\n${input.text}\n${input.context}`
  const cached = cache.get(key)
  if (cached) return cached
  client ??= new Anthropic()
  const ask = (speed?: "fast") =>
    client!.beta.messages.parse(
      {
        model: model(),
        max_tokens: 16000,
        // A short answer a reader waits for: the lowest effort.
        output_config: { effort: "low", format: zodOutputFormat(answer) },
        speed,
        // A decline is retried on the model the API picks for it.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system,
        messages: [
          {
            role: "user",
            content: `Context:\n${input.context}\n\nSelected text:\n${input.text}`,
          },
        ],
      },
      { timeout: 60_000 }
    )
  // Fast mode halves the wait and has its own rate limit: past it, the
  // standard speed answers.
  const response = await ask("fast").catch((error) => {
    if (error instanceof Anthropic.RateLimitError) return ask()
    throw error
  })
  const data = response.parsed_output
  if (response.stop_reason === "refusal" || !data?.translation.trim())
    throw new Error(`no translation (stop_reason ${response.stop_reason})`)
  const word = data.kind === "word"
  const result: Translation = {
    kind: data.kind,
    translation: data.translation.trim(),
    partOfSpeech: (word && data.partOfSpeech?.trim()) || undefined,
    phonetic: (word && data.phonetic?.trim()) || undefined,
    note: data.note?.trim() || undefined,
    examples: data.kind === "sentence" ? [] : data.examples.slice(0, 2),
  }
  if (cache.size >= cacheSize) cache.delete(cache.keys().next().value!)
  cache.set(key, result)
  return result
}
