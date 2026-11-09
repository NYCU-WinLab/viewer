// "Open in Viewer" in the Files menu of a PDF, Word or PowerPoint file. It
// opens viewer.winlab.tw/import/nextcloud with the file's path; the viewer
// imports the file from the member's own Nextcloud (linked once through
// OAuth) and opens the document.
import { FileType, registerFileAction } from "@nextcloud/files"

const VIEWER = "https://viewer.winlab.tw"
const KINDS = /\.(pdf|docx|pptx)$/i
const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3m-2 16H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2z"/></svg>'

registerFileAction({
  id: "winlab-viewer-open",
  displayName: () => "在 Viewer 打開",
  iconSvgInline: () => ICON,
  order: 30,
  enabled: ({ nodes }) =>
    nodes.length === 1 &&
    nodes[0].type === FileType.File &&
    KINDS.test(nodes[0].basename),
  exec: async ({ nodes }) => {
    const url = `${VIEWER}/import/nextcloud?${new URLSearchParams({ path: nodes[0].path })}`
    window.open(url, "_blank", "noopener")
    return null
  },
})
