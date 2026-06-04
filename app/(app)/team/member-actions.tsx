"use client";

import { useRef } from "react";
import { Trash2 } from "lucide-react";
import {
  updateMemberRoleAction,
  removeMemberAction,
  revokeInvitationAction,
} from "@/lib/tenant/actions";
import { Select } from "@/components/ui/field";
import type { MembershipRole } from "@/lib/types/db";

/**
 * Inline role select + remove for a member. OWNER rows are read-only and the
 * current user cannot edit their own membership here.
 */
export function MemberActions({
  membershipId,
  role,
  editable,
}: {
  membershipId: string;
  role: MembershipRole;
  editable: boolean;
}) {
  const roleFormRef = useRef<HTMLFormElement>(null);

  if (!editable) return null;

  return (
    <div className="flex items-center gap-2">
      <form ref={roleFormRef} action={updateMemberRoleAction}>
        <input type="hidden" name="membership_id" value={membershipId} />
        <Select
          name="role"
          defaultValue={role}
          onChange={() => roleFormRef.current?.requestSubmit()}
          className="h-9 w-36 text-sm"
        >
          <option value="MOP">Менеджер</option>
          <option value="ROP">РОП</option>
        </Select>
      </form>
      <form action={removeMemberAction}>
        <input type="hidden" name="membership_id" value={membershipId} />
        <button
          type="submit"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-line-strong text-content-faint transition-colors hover:border-signal-bad/40 hover:text-signal-bad"
          aria-label="Удалить из команды"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}

export function RevokeInviteButton({
  invitationId,
}: {
  invitationId: string;
}) {
  return (
    <form action={revokeInvitationAction}>
      <input type="hidden" name="invitation_id" value={invitationId} />
      <button
        type="submit"
        className="text-sm font-medium text-content-faint transition-colors hover:text-signal-bad"
      >
        Отозвать
      </button>
    </form>
  );
}
