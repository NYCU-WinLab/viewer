// llm.winlab.tw: the lab's model gateway (OpenAI compatible), asked to
// translate what a reader selects. LLM_API_KEY comes from the environment
// (a key made on llm.winlab.tw); without it the reader shows no translate
// button. LLM_URL and LLM_MODEL have defaults.

const base = () =>
  (process.env.LLM_URL ?? "https://llm.winlab.tw/v1").replace(/\/$/, "")
const model = () => process.env.LLM_MODEL ?? "qwen3.8-27b-fp8"

export const canTranslate = () => !!process.env.LLM_API_KEY

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

Answer with one JSON object and nothing else:
- "kind": "word" for a single word, "phrase" for an idiom, collocation or term of a few words, "sentence" for a clause, a sentence or more.
- "translation": the translation that fits this context.
- "partOfSpeech": for a word only, in Traditional Chinese (名詞, 動詞, 形容詞).
- "phonetic": for an English word only, in IPA between slashes.
- "note": one or two short sentences in Traditional Chinese. For a word: what it means here, and its other common senses. For a phrase: what it means and when it is used. For a sentence: what it does in its paragraph, or the background a reader needs.
- "examples": for a word or a phrase only, one or two objects with "source" (a short sentence in the language of the selected text) and "translation". For a sentence, an empty list.`

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined

/** Translates the selected text, read in its context. Throws when the
 * gateway refuses or answers something that is not the JSON asked for. */
export async function translate(input: {
  text: string
  context: string
}): Promise<Translation> {
  const key = process.env.LLM_API_KEY
  if (!key) throw new Error("翻譯還沒設定")
  const response = await fetch(`${base()}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: model(),
      temperature: 0.2,
      // Enough for a long selection; the gateway's default cuts it short.
      max_tokens: 4096,
      response_format: { type: "json_object" },
      chat_template_kwargs: { enable_thinking: false },
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: `Context:\n${input.context}\n\nSelected text:\n${input.text}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) throw new Error(`llm 回應 ${response.status}`)
  const body = (await response.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const content = body.choices?.[0]?.message?.content ?? ""
  // The object itself, whatever the model wrote around it.
  const json = content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1)
  const data = JSON.parse(json || "null") as Record<string, unknown> | null
  const translation = text(data?.translation)
  if (!data || !translation) throw new Error("llm 沒有回翻譯")
  const kind =
    data.kind === "word" || data.kind === "phrase" ? data.kind : "sentence"
  const examples = (Array.isArray(data.examples) ? data.examples : [])
    .map((example: Record<string, unknown> | null) => ({
      source: text(example?.source),
      translation: text(example?.translation),
    }))
    .filter(
      (example): example is { source: string; translation: string } =>
        !!example.source && !!example.translation
    )
    .slice(0, 2)
  return {
    kind,
    translation,
    partOfSpeech: kind === "word" ? text(data.partOfSpeech) : undefined,
    phonetic: kind === "word" ? text(data.phonetic) : undefined,
    note: text(data.note),
    examples: kind === "sentence" ? [] : examples,
  }
}
