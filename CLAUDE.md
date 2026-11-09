@AGENTS.md

# WinLab Viewer

viewer.winlab.tw: lab members read PDF, Word and PowerPoint documents together, mark them with a highlighter, a box or a pen, and talk in sticky notes on each mark. Built on the same skeleton as NYCU-WinLab/gallery and portal; keep them alike.

## Rules

- **Every read and write is an action** in `lib/actions/<area>.ts`, made with `defineAction` and listed in `lib/actions/registry.ts`. Pages call `runAction(action, actor, input)`; `lib/mcp/server.ts` builds the MCP tools from the same registry. Never write a separate MCP tool or a page-only query.
- **Only `lib/actions`, `lib/auth` and `lib/db` import `@/lib/db`.** `bun run actions:check` fails otherwise, and when an action is missing from the registry.
- **An action stays off MCP only with a reason** in `mcpExcludedBecause`.
- **Action fields**: `name` snake_case (the tool name), `title` in Chinese (what members call it), `description` in English for agents, `kind` query or mutation.
- **Permissions live in the action's `run`**, through `requireAccess` in `lib/actions/access.ts`: owner > edit > comment > view. A document the member may not see looks missing, never forbidden.
- **Schema**: edit `lib/db/*.ts`, run `bun run db:generate`, commit the SQL in `drizzle/`. Tables are snake_case plurals; the Better Auth tables keep its model names as export keys.
- **External services get one module each**: `lib/keycloak.ts`, `lib/nextcloud.ts`, `lib/convert.ts`, `lib/portal.ts` (invitation mail through portal.winlab.tw with a service key). Each reads its credentials from the environment, never touches the database, and only actions call it. The one exception is `/files`, which streams a PDF (or draws its first page as a cover with pdftoppm) from `lib/nextcloud.ts` after `get_document_pdf` checks access.
- **Files belong to Nextcloud, rows to Postgres.** A document is `<NEXTCLOUD_ROOT>/<id>/`: `v<n>.<ext>` as uploaded and `v<n>.pdf` as shown. Write the files before the version row, delete the row before the files. The account is shared with other apps: never touch anything outside `NEXTCLOUD_ROOT`.
- **The reader shows PDF only.** docx and pptx become PDF at upload through the convert service (`convert/`: Gotenberg with stand-in fonts in `convert/fonts.conf`). pdf.js draws pages in the browser; its worker, cMaps and fonts are copied to `public/pdfjs` by `scripts/copy-pdfjs.ts`.
- **Marks are stored in page fractions** (0 to 1 from the top left), so they hold at any zoom; a highlight also keeps its quote with some context, to find it again in a newer version.
- **A member's own Nextcloud** is a second, separate connection: OAuth 2 tokens per member in `nextcloud_tokens`, sealed with `lib/seal.ts`, used only by `lib/actions/nextcloud.ts` to list and import that member's files. Never use them to write. A file is bound to one document by its Nextcloud file id (`documents.nextcloud_file_id`); a member who can read that file in Nextcloud gets comment access to its document, and a changed ETag adds a version whoever opens it. The Nextcloud app in `nextcloud/` frames `/embed/nextcloud` in a Nextcloud page; `/embed` pages sign in and link in a popup, since Keycloak and Nextcloud refuse to be framed. Only the viewer and `https://nextcloud.winlab.tw` may frame the site (`frame-ancestors` in `next.config.ts`).
- **Members only.** Every page calls `requireActor`, every file goes through `/files`; nothing is public.
- **Every page updates live.** `runAction` announces each successful mutation (`lib/actions/changes.ts`, Postgres NOTIFY) and every open page refreshes through `/api/events`.
- **Guests come in through guest links** (`lib/actions/guests.ts`, `/g/<secret>`): a user row with `guest_link_id`, a session that ends with the link, and access only to that link's document as view or comment (`accessTo`). `runAction` refuses a guest every action without `guests: true`; mark one so only when a guest must run it.
- **Presence is not data.** Who has a document open and their cursors live in memory in `lib/presence.ts` (one server process), streamed by `/api/presence/<id>` after `get_document` checks access; nothing is stored, so it is not an action.
- **MCP lives at `/mcp`**; discovery is under `/.well-known/` at the site root.
- **Design** comes from ui.winlab.tw (`bunx shadcn@latest add @winlab/<item>`); its DESIGN.md is the rulebook and `bun run tokens:check` enforces the token part.
- **Observability**: actions run in a span (`action <name>`, with `via` web or mcp); send ids and counts, never member content.

## Verify

`bun run typecheck && bun run lint && bun run format:check && bun run tokens:check && bun run actions:check && bun run build`. Build and run on the sandbox, not the MacBook (`~/p/NYCU-WinLab/viewer/kit/README.md`).
