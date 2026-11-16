// The Claude API, asked about what a reader is reading: translate or
// explain a selection or a figure, reply in a sticky note, sum up the
// notes. ANTHROPIC_API_KEY comes from the environment (a key of the lab's
// Claude Console organization); without it the reader shows none of this.
// TRANSLATE_MODEL picks another model.
import Anthropic from "@anthropic-ai/sdk"
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod"
import { z } from "zod"

const model = () => process.env.TRANSLATE_MODEL ?? "claude-opus-5-5"

export const claudeReady = () => !!process.env.ANTHROPIC_API_KEY

let client: Anthropic | undefined

/** Answers already given, newest last, so the same question answers at
 * once (one server process; a deploy starts it empty). */
const cache = new Map<string, unknown>()
const cacheSize = 2000

/** A JPEG the reader cut from a page, base64 without the data: prefix. */
type Image = string

/** Asks once for an answer of the given shape. Fast mode halves the wait
 * and has its own rate limit: past it, the standard speed answers. */
async function ask<Shape extends z.ZodType>(
  shape: Shape,
  system: string,
  text: string,
  image?: Image
): Promise<z.infer<Shape>> {
  if (!claudeReady()) throw new Error("Claude 還沒設定")
  const key = `${model()}\n${system}\n${text}\n${image ?? ""}`
  if (cache.has(key)) return cache.get(key) as z.infer<Shape>
  client ??= new Anthropic()
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    { type: "text", text },
  ]
  if (image)
    content.unshift({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: image },
    })
  const send = (speed?: "fast") =>
    client!.beta.messages.parse(
      {
        model: model(),
        max_tokens: 16000,
        // A short answer a reader waits for: the lowest effort.
        output_config: { effort: "low", format: zodOutputFormat(shape) },
        speed,
        // A decline is retried on the model the API picks for it.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system,
        messages: [{ role: "user", content }],
      },
      { timeout: 60_000 }
    )
  const response = await send("fast").catch((error) => {
    if (error instanceof Anthropic.RateLimitError) return send()
    throw error
  })
  const data = response.parsed_output
  if (response.stop_reason === "refusal" || !data)
    throw new Error(`no answer (stop_reason ${response.stop_reason})`)
  if (cache.size >= cacheSize) cache.delete(cache.keys().next().value!)
  cache.set(key, data)
  return data
}

const reader =
  "You help a graduate student in Taiwan read a document, often a research paper or lecture slides."

// Translate

const translation = z.object({
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

const translator = `${reader} Translate the selected text into Traditional Chinese as used in Taiwan; when the selected text is already Chinese, translate it into English instead. Read the context to choose the sense that fits, and translate only the selected text.

Fill the fields this way:
- kind: "word" for a single word, "phrase" for an idiom, collocation or term of a few words, "sentence" for a clause, a sentence or more.
- translation: the translation that fits this context.
- partOfSpeech: for a word only, in Traditional Chinese (名詞, 動詞, 形容詞); otherwise null.
- phonetic: for an English word only, in IPA between slashes; otherwise null.
- note: one or two short sentences in Traditional Chinese. For a word: what it means here, and its other common senses. For a phrase: what it means and when it is used. For a sentence: what it does in its paragraph, or the background a reader needs.
- examples: for a word or a phrase only, one or two short sentences in the language of the selected text, each with its translation. For a sentence, an empty list.`

/** Translates the selected text, read in its context. Throws when the API
 * refuses or its answer does not fit the fields asked for. */
export async function translate(input: {
  text: string
  context: string
}): Promise<Translation> {
  const data = await ask(
    translation,
    translator,
    `Context:\n${input.context}\n\nSelected text:\n${input.text}`
  )
  if (!data.translation.trim()) throw new Error("empty translation")
  const word = data.kind === "word"
  return {
    kind: data.kind,
    translation: data.translation.trim(),
    partOfSpeech: (word && data.partOfSpeech?.trim()) || undefined,
    phonetic: (word && data.phonetic?.trim()) || undefined,
    note: data.note?.trim() || undefined,
    examples: data.kind === "sentence" ? [] : data.examples.slice(0, 2),
  }
}

// Explain

const explanation = z.object({ explanation: z.string() })

const explainer = `${reader} Explain what they point at, in Traditional Chinese as used in Taiwan, keeping technical terms in their original language.

When it is selected text: say what it means in this document, then what a reader needs to follow it (the idea behind a term, each symbol of a formula, the step an argument takes). When it is an image cut from a page (a figure, a table, a formula, a diagram): say what it shows, how to read it (axes, legend, columns, arrows), and what the reader should take from it.

Write 2 to 4 short sentences, at most 150 Chinese characters, plain text without markdown. Use the context only to understand; do not summarize it. When the image or text is unreadable, say so in one sentence.`

/** Explains selected text or a cut of a page, read in its context. */
export async function explain(input: {
  text: string
  context: string
  image?: Image
}): Promise<string> {
  const data = await ask(
    explanation,
    explainer,
    input.image
      ? `Context (the page's text):\n${input.context}\n\nExplain the image.`
      : `Context:\n${input.context}\n\nSelected text:\n${input.text}`,
    input.image
  )
  const text = data.explanation.trim()
  if (!text) throw new Error("empty explanation")
  return text
}

// Reply in a sticky note

const reply = z.object({ reply: z.string() })

const replier = `${reader} You are Claude, a member of the discussion in a sticky note on one mark in the document. Someone mentioned @Claude: answer the latest message that asks you something, using the marked text or image, its context and the earlier notes.

Write in the language of that message (Traditional Chinese as used in Taiwan when it is Chinese). The note is a small square of paper: at most 80 Chinese characters or 50 English words, plain text without markdown, no greeting and no signature. When you are not sure, say what you would check.`

/** Claude's reply to a sticky note thread that mentions it. */
export async function replyInNote(input: {
  document: string
  page: number
  quote?: string
  context: string
  thread: { author: string; body: string }[]
  image?: Image
}): Promise<string> {
  const notes = input.thread
    .map((note) => `${note.author}: ${note.body}`)
    .join("\n\n")
  const data = await ask(
    reply,
    replier,
    [
      `Document: ${input.document}, page ${input.page}`,
      input.quote ? `Marked text:\n${input.quote}` : "Marked: the image",
      `Context (the page's text):\n${input.context}`,
      `Notes, oldest first:\n${notes}`,
    ].join("\n\n"),
    input.image
  )
  const text = data.reply.trim()
  if (!text) throw new Error("empty reply")
  return text.slice(0, 2000)
}

// Sum up the sticky notes

const summary = z.object({
  summary: z.string(),
  open: z.array(z.object({ mark: z.number().int(), question: z.string() })),
})

const summarizer = `${reader} Members left sticky notes on marks in the document; each mark is numbered. Sum up the discussion for someone who missed it, in Traditional Chinese as used in Taiwan, keeping technical terms in their original language.

Fill the fields this way:
- summary: 2 to 4 short sentences, plain text: what the notes are about and what they agreed on, without the mark numbers.
- open: the questions or disagreements still waiting for an answer, on marks that are not resolved, at most 8, most important first. Each names its mark's number and says the question in one short sentence.`

export type Summary = {
  summary: string
  open: { mark: number; question: string }[]
}

/** Sums up every sticky note of a document. */
export async function summarize(input: {
  document: string
  marks: {
    page: number
    resolved: boolean
    quote?: string
    thread: { author: string; body: string }[]
  }[]
}): Promise<Summary> {
  const marks = input.marks
    .map((mark, index) =>
      [
        `#${index + 1}, page ${mark.page}${mark.resolved ? ", resolved" : ""}`,
        mark.quote ? `Marked text: ${mark.quote}` : "Marked: a drawing",
        ...mark.thread.map((note) => `${note.author}: ${note.body}`),
      ].join("\n")
    )
    .join("\n\n")
  const data = await ask(
    summary,
    summarizer,
    `Document: ${input.document}\n\n${marks}`
  )
  return {
    summary: data.summary.trim(),
    open: data.open
      .filter((item) => item.mark >= 1 && item.mark <= input.marks.length)
      .slice(0, 8),
  }
}
