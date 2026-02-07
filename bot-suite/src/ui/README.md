# Bot Suite UI

This folder contains the Bot Suite plugin UI pages registered by `bot-suite` (see `plugins/chatbots/bot-suite/ui/index.tsx`).

## Permissions Console

Entry: `plugins/chatbots/bot-suite/ui/features/permissions/page.tsx`

### Roles (权限组)

- A “权限组” is a `Role` in the permissions system.
- Roles are displayed **sorted by `rank` descending**, then `roleId` ascending (see `plugins/chatbots/bot-suite/ui/features/permissions/hooks.ts`).
- `rank` defines precedence (higher rank wins first) when multiple roles contribute grants to a user.
- The Roles list supports quick filtering (search by name/id/rank/parent).

Actions:

- Create role: left panel “Create new role”.
- Rename / change parent / rank: right panel “Role grants” → edit fields → `Save`.
- Delete role: right panel “Role grants” → `Delete`.
  - Deleting a role will also remove:
    - all grants assigned to this role
    - all user-role assignments to this role
  - Child roles are re-parented to the deleted role’s parent.
  - The `DEFAULT` role is protected and cannot be deleted.

### User role assignments

The “Users” tab provides a batch-oriented editor for:

- user-role assignments (which roles the user belongs to)
- user-specific grant overrides

Role assignment UX:

- Roles are shown **sorted by assignment status first** (assigned roles first), then by `rank` descending.
- Each role badge shows `r<rank>` to make precedence obvious while editing.
- Role badges are keyboard-operable (Enter/Space toggles assignment) and include `aria-label`s for screen readers.
- If the user has **no explicit roles**, the backend applies the `DEFAULT` role implicitly. The UI shows a note for this case.
- A “Clear roles” action is provided to stage removal of all explicit roles (DEFAULT still applies implicitly).

### Pending (batch) mode

Most edits are staged locally and only persisted on `Commit`:

- Grants: pending add/modify/remove are highlighted in the table.
- Roles: pending assign/unassign are marked on the role badges.

`Discard` clears all local pending changes.

## RPC contract notes

The permissions console uses the `bot-suite` RPC extension (implemented in `plugins/chatbots/bot-suite/src/core/rpc/chatbots-rpc.ts`).

- User search RPC is `searchUsersByName(query, limit?)`.
- Role deletion RPC is `deleteRole(roleId)`.
