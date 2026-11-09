"use client"

import { HistoryIcon, UsersIcon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import * as React from "react"
import { toast } from "sonner"

import {
  inviteGuest,
  loadGuestLinks,
  loadMembers,
  loadShares,
  share,
  uninviteGuest,
  unshare,
} from "@/app/actions"
import { MemberCombobox } from "@/components/member-combobox"
import { formatWhen } from "@/components/reader/sticky-note"
import { UploadForm } from "@/components/upload-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ToolbarPanel,
  ToolbarPanelContent,
  ToolbarPanelTrigger,
} from "@/components/ui/toolbar"
import { cn } from "@/lib/utils"

type Version = {
  number: number
  fileName: string
  uploadedBy: string | null
  createdAt: string
}

const roles = [
  { value: "view", label: "僅檢視" },
  { value: "comment", label: "可註解" },
  { value: "edit", label: "可管理" },
] as const

type RoleValue = (typeof roles)[number]["value"]

// Versions and sharing, at the end of the reader's tool bar.
export function DocumentActions({
  documentId,
  version,
  versions,
  canEdit,
  isOwner,
}: {
  documentId: string
  version: number
  versions: Version[]
  canEdit: boolean
  isOwner: boolean
}) {
  const router = useRouter()
  const [dialog, setDialog] = React.useState<"upload" | "share" | null>(null)
  const close = (next: boolean) => !next && setDialog(null)

  return (
    <>
      <ToolbarPanel>
        <ToolbarPanelTrigger
          render={<Button variant="ghost" className="rounded-full" />}
        >
          <HistoryIcon />v{version}
        </ToolbarPanelTrigger>
        <ToolbarPanelContent>
          <ul className="flex flex-col">
            {[...versions].reverse().map((v) => (
              <li key={v.number}>
                <Link
                  href={`/d/${documentId}?v=${v.number}`}
                  className={cn(
                    "flex flex-col rounded-control p-3 hover:bg-muted",
                    v.number === version && "text-primary"
                  )}
                >
                  <span className="font-medium">
                    v{v.number}
                    <span className="ml-2 font-normal">{v.fileName}</span>
                  </span>
                  <span className="text-muted-foreground">
                    {v.uploadedBy ?? "已離開的成員"}，{formatWhen(v.createdAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {canEdit && (
            <Button
              variant="ghost"
              className="justify-start"
              onClick={() => setDialog("upload")}
            >
              上傳新版本
            </Button>
          )}
        </ToolbarPanelContent>
      </ToolbarPanel>
      {canEdit && (
        <Button
          variant="ghost"
          size="icon"
          aria-label="共用"
          className="rounded-full"
          onClick={() => setDialog("share")}
        >
          <UsersIcon />
        </Button>
      )}

      <Dialog open={dialog === "upload"} onOpenChange={close}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>上傳新版本</DialogTitle>
          </DialogHeader>
          <UploadForm
            documentId={documentId}
            onDone={({ version }) => {
              setDialog(null)
              router.push(`/d/${documentId}?v=${version}`)
            }}
          />
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === "share"} onOpenChange={close}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>共用</DialogTitle>
          </DialogHeader>
          {dialog === "share" && (
            <>
              <SharePanel documentId={documentId} isOwner={isOwner} />
              <GuestPanel documentId={documentId} />
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

type Share = { userId: string; name: string; email: string; role: RoleValue }
type Member = { id: string; name: string; email: string }

function SharePanel({
  documentId,
  isOwner,
}: {
  documentId: string
  isOwner: boolean
}) {
  const [shares, setShares] = React.useState<Share[] | null>(null)
  const [members, setMembers] = React.useState<Member[]>([])
  const [memberId, setMemberId] = React.useState<string | null>(null)
  const [role, setRole] = React.useState<RoleValue>("comment")

  const refresh = React.useCallback(async () => {
    const result = await loadShares({ id: documentId })
    if (result.error) toast.error(result.error)
    else setShares(result.data ?? [])
  }, [documentId])

  React.useEffect(() => {
    loadShares({ id: documentId }).then((result) => {
      if (result.error) toast.error(result.error)
      else setShares(result.data ?? [])
    })
    loadMembers().then((result) => setMembers(result.data ?? []))
  }, [documentId])

  const offered = roles.filter((r) => isOwner || r.value !== "edit")

  const add = async (id: string, as: RoleValue) => {
    const result = await share({ id: documentId, memberId: id, role: as })
    if (result.error) return toast.error(result.error)
    setMemberId(null)
    refresh()
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-2">
        <MemberCombobox
          members={members}
          value={memberId}
          onValueChange={setMemberId}
          placeholder="選成員"
          className="min-w-0 flex-1"
        />
        <RoleSelect value={role} onChange={setRole} options={offered} />
        <Button
          disabled={!memberId}
          onClick={() => memberId && add(memberId, role)}
        >
          加入
        </Button>
      </div>
      {shares && shares.length > 0 && (
        <ul className="flex flex-col">
          {shares.map((s) => (
            <li
              key={s.userId}
              className="flex items-center gap-2 border-b border-border py-2"
            >
              <span className="min-w-0 flex-1 truncate">
                {s.name}
                <span className="ml-2 text-muted-foreground">{s.email}</span>
              </span>
              <RoleSelect
                value={s.role}
                onChange={(next) => add(s.userId, next)}
                options={offered}
                disabled={s.role === "edit" && !isOwner}
              />
              <Button
                variant="ghost"
                disabled={s.role === "edit" && !isOwner}
                onClick={async () => {
                  const result = await unshare({
                    id: documentId,
                    userId: s.userId,
                  })
                  if (result.error) toast.error(result.error)
                  else refresh()
                }}
              >
                移除
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RoleSelect({
  value,
  onChange,
  options,
  disabled,
}: {
  value: RoleValue
  onChange: (role: RoleValue) => void
  options: readonly { value: RoleValue; label: string }[]
  disabled?: boolean
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => next && onChange(next as RoleValue)}
      disabled={disabled}
      items={roles.map((r) => ({ value: r.value, label: r.label }))}
    >
      <SelectTrigger className="w-28" aria-label="權限">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((r) => (
          <SelectItem key={r.value} value={r.value}>
            {r.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

type GuestLink = {
  id: string
  role: "view" | "comment"
  label: string
  expiresAt: string
  active: boolean
  guests: string[]
}

const guestRoles = roles.filter((r) => r.value !== "edit")
const guestHours = [
  { value: "1", label: "1 小時" },
  { value: "24", label: "1 天" },
  { value: "168", label: "7 天" },
]

// Guest links, for people without a lab account: make one (who it is for,
// what they may do, for how long), copy it once, revoke it any time.
function GuestPanel({ documentId }: { documentId: string }) {
  const [links, setLinks] = React.useState<GuestLink[]>([])
  const [label, setLabel] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [role, setRole] = React.useState<RoleValue>("comment")
  const [hours, setHours] = React.useState("24")
  const [made, setMade] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    const result = await loadGuestLinks({ id: documentId })
    if (result.error) toast.error(result.error)
    else setLinks((result.data ?? []).filter((link) => link.active))
  }, [documentId])

  React.useEffect(() => {
    loadGuestLinks({ id: documentId }).then((result) => {
      if (!result.error)
        setLinks((result.data ?? []).filter((link) => link.active))
    })
  }, [documentId])

  const make = async () => {
    const result = await inviteGuest({
      id: documentId,
      role,
      hours,
      label: label.trim() || undefined,
      email: email.trim() || undefined,
    })
    if (!result.data) return toast.error(result.error ?? "產生失敗")
    const { url, mailed, mailError } = result.data
    setMade(url)
    setLabel("")
    setEmail("")
    await navigator.clipboard?.writeText(url).catch(() => {})
    if (mailed) toast.success("已寄出邀請信，連結也已複製")
    else if (mailError) toast.error(`邀請信沒寄出：${mailError}。連結已複製`)
    else toast.success("已複製訪客連結")
    refresh()
  }

  return (
    <div className="flex flex-col gap-4 border-t border-border pt-6">
      <h3 className="font-semibold">訪客連結</h3>
      <div className="flex gap-2">
        <Input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="給誰"
          aria-label="給誰"
          maxLength={80}
          className="min-w-0 flex-1"
        />
        <RoleSelect value={role} onChange={setRole} options={guestRoles} />
        <Select
          value={hours}
          onValueChange={(next) => next && setHours(next)}
          items={guestHours}
        >
          <SelectTrigger className="w-24" aria-label="有效時間">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {guestHours.map((h) => (
              <SelectItem key={h.value} value={h.value}>
                {h.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex gap-2">
        <Input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="寄到信箱（選填）"
          aria-label="寄到信箱"
          className="min-w-0 flex-1"
        />
        <Button onClick={make}>{email.trim() ? "寄出" : "產生"}</Button>
      </div>
      {made && (
        <Input
          readOnly
          value={made}
          aria-label="訪客連結"
          onFocus={(event) => event.target.select()}
        />
      )}
      {links.length > 0 && (
        <ul className="flex flex-col">
          {links.map((link) => (
            <li
              key={link.id}
              className="flex items-center gap-2 border-b border-border py-2"
            >
              <span className="min-w-0 flex-1 truncate">
                {link.label || "訪客"}
                <span className="ml-2 text-muted-foreground">
                  {roles.find((r) => r.value === link.role)?.label}，到{" "}
                  {formatWhen(link.expiresAt)}
                  {link.guests.length > 0 && `，${link.guests.join("、")}`}
                </span>
              </span>
              <Button
                variant="ghost"
                onClick={async () => {
                  const result = await uninviteGuest({ linkId: link.id })
                  if (result.error) toast.error(result.error)
                  else refresh()
                }}
              >
                撤銷
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
