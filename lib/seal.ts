import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto"

// Seals a secret kept in the database (a member's Nextcloud tokens) with
// AES-256-GCM, under a key derived from BETTER_AUTH_SECRET, so a copy of
// the database alone does not give the tokens away. Sealed text is
// "v1.<iv>.<tag>.<ciphertext>", base64url.

function key() {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set")
  return Buffer.from(
    hkdfSync("sha256", secret, "viewer", "nextcloud tokens", 32)
  )
}

export function seal(plain: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key(), iv)
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  return ["v1", iv, cipher.getAuthTag(), body]
    .map((part) =>
      typeof part === "string" ? part : part.toString("base64url")
    )
    .join(".")
}

export function unseal(sealed: string) {
  const [version, iv, tag, body] = sealed.split(".")
  if (version !== "v1" || !iv || !tag || !body)
    throw new Error("Bad sealed value")
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(iv, "base64url")
  )
  decipher.setAuthTag(Buffer.from(tag, "base64url"))
  return Buffer.concat([
    decipher.update(Buffer.from(body, "base64url")),
    decipher.final(),
  ]).toString("utf8")
}
