// "Open in Viewer" in the Files menu of a PDF, Word or PowerPoint file. It
// opens the app's page (/apps/winlab_viewer/open), which frames
// viewer.winlab.tw: the viewer reads the file from the member's own
// Nextcloud (linked once through OAuth) and shows it, with a new version
// when the file changed.
import { FileType, registerFileAction } from "@nextcloud/files"
import { generateUrl } from "@nextcloud/router"

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
    window.location.assign(
      generateUrl("/apps/winlab_viewer/open?path={path}", {
        path: nodes[0].path,
      })
    )
    return null
  },
})
