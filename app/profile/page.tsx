import { FieldList, FieldRow } from "@/components/field-list"
import { ViewerShell } from "@/components/viewer-shell"
import { PageHeader } from "@/components/page-header"
import { runAction } from "@/lib/actions/define"
import { whoami } from "@/lib/actions/users"
import { requireActor } from "@/lib/auth/session"

import { SignOutButton } from "./sign-out-button"

export const dynamic = "force-dynamic"

export default async function ProfilePage() {
  const actor = await requireActor("/profile")
  const member = await runAction(whoami, actor, {})
  return (
    <ViewerShell page={{ label: member.name, href: "/profile", tip: "" }}>
      <div className="flex flex-col gap-12">
        <PageHeader title={member.name} actions={<SignOutButton />} />
        <FieldList>
          <FieldRow label="帳號">{member.username ?? "未填"}</FieldRow>
          <FieldRow label="信箱">{member.email}</FieldRow>
        </FieldList>
      </div>
    </ViewerShell>
  )
}
