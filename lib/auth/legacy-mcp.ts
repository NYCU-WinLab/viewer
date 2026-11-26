import { requireMcpAuth } from "@better-auth/mcp"

import { auth, mcpResource } from "@/lib/auth"
import { isLabMember } from "@/lib/auth/member"
import { mcpHandler } from "@/lib/mcp/server"

// Tokens the viewer issued itself, before Keycloak took over. Members who
// connected then keep working until their client signs in again, which now
// goes to Keycloak. Remove once no refresh token from the viewer is left.

const jwksUrl = `http://127.0.0.1:${process.env.PORT ?? 3000}/api/auth/jwks`

const refuse = (status: number, message: string) =>
  Response.json(
    { jsonrpc: "2.0", error: { code: -32000, message }, id: null },
    { status }
  )

export const legacyMcp = requireMcpAuth(
  auth,
  async (request, claims) => {
    const clientId = String(claims.azp ?? claims.client_id ?? "")
    if (!claims.sub || claims.sub === clientId)
      return refuse(403, "not a member token")
    try {
      if (!(await isLabMember(claims.sub)))
        return refuse(403, "no longer a lab member")
    } catch {
      return refuse(503, "cannot reach Keycloak to check membership")
    }
    return mcpHandler.fetch(request, {
      authInfo: {
        token: "",
        clientId,
        scopes: String(claims.scope ?? "")
          .split(" ")
          .filter(Boolean),
        expiresAt: claims.exp,
        extra: { userId: claims.sub },
      },
    })
  },
  { resource: mcpResource, jwksUrl }
)
