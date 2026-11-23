import type { Metadata } from "next";
import Link from "next/link";

import { UserActions } from "@/components/admin/user-actions";
import { AdminTitle, Card, Pill, dateTime, shortDate } from "@/components/admin/ui";
import { requireAdminPage } from "@/lib/platform/guard";
import { listUsers } from "@/lib/platform/users";

import {
  banAction,
  deleteUserAction,
  disable2faAction,
  impersonateAction,
  passwordAction,
  revokeAction,
  setAdminAction,
  unbanAction,
  verifyAction,
} from "./actions";

export const metadata: Metadata = { title: "Users" };

const PAGE = 30;

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const admin = await requireAdminPage();
  const query = await searchParams;
  const page = Math.max(1, Number(query.page) || 1);
  const { rows, total } = await listUsers(admin.db, {
    q: query.q,
    limit: PAGE,
    offset: (page - 1) * PAGE,
  });
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const link = (p: number) =>
    `/admin/users?${new URLSearchParams({ ...(query.q ? { q: query.q } : {}), page: String(p) })}`;
  const actions = {
    ban: banAction,
    unban: unbanAction,
    revoke: revokeAction,
    password: passwordAction,
    verify: verifyAction,
    disable2fa: disable2faAction,
    setAdmin: setAdminAction,
    remove: deleteUserAction,
    impersonate: impersonateAction,
  };

  return (
    <div className="grid gap-6">
      <AdminTitle
        title="Users"
        description={`${total} account${total === 1 ? "" : "s"}, admins included.`}
      />
      <form className="flex max-w-md gap-2" role="search">
        <input
          name="q"
          defaultValue={query.q ?? ""}
          placeholder="Search by email or name"
          aria-label="Search users"
          className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm"
        />
        <button className="h-10 rounded-lg border border-border px-3 text-sm font-medium hover:bg-surface-2">
          Search
        </button>
      </form>
      <ul className="grid gap-3">
        {rows.length === 0 ? (
          <li className="text-sm text-muted-foreground">No user found.</li>
        ) : (
          rows.map((u) => (
            <li key={u.id}>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {u.name}
                      {u.role === "admin" ? <Pill tone="info">Platform admin</Pill> : null}
                      {u.banned ? (
                        <Pill tone="danger">Banned{u.banReason ? `: ${u.banReason}` : ""}</Pill>
                      ) : null}
                      {!u.emailVerified ? <Pill tone="warning">Email not verified</Pill> : null}
                      {u.twoFactorEnabled ? <Pill tone="good">2FA</Pill> : null}
                    </p>
                    <p className="text-sm text-muted-foreground">{u.email}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Joined {shortDate(u.createdAt)} · Last seen {dateTime(u.lastSeenAt)}
                      {u.workspaces.length ? " · " : ""}
                      {u.workspaces.map((w, i) => (
                        <span key={w.id}>
                          {i ? ", " : ""}
                          <Link
                            href={`/admin/workspaces/${w.id}`}
                            className="text-brand-text hover:underline"
                          >
                            {w.name}
                          </Link>{" "}
                          ({w.role})
                        </span>
                      ))}
                    </p>
                  </div>
                </div>
                <div className="mt-3 border-t border-border pt-3">
                  <UserActions user={u} isSelf={u.id === admin.adminUserId} actions={actions} />
                </div>
              </Card>
            </li>
          ))
        )}
      </ul>
      {pages > 1 ? (
        <nav aria-label="Pages" className="flex items-center gap-3 text-sm">
          {page > 1 ? <Link href={link(page - 1)}>← Previous</Link> : null}
          <span className="text-muted-foreground">
            Page {page} of {pages}
          </span>
          {page < pages ? <Link href={link(page + 1)}>Next →</Link> : null}
        </nav>
      ) : null}
    </div>
  );
}
