import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, Check, Loader2, RefreshCw, Shield, ShieldCheck, UserRound, UserRoundX } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";

type ManagedUser = {
  id: number;
  email: string;
  displayName: string;
  role: "admin" | "user";
  isActive: boolean;
  teamId: number | null;
};

type UserAction = "promote" | "demote" | "deactivate" | "reactivate";

const usersKey = ["/api/admin/users"];
const authKey = ["/api/auth/me"];

export default function UserManagement() {
  const { user: currentUser } = useAuth();
  const {
    data: users,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery<ManagedUser[]>({ queryKey: usersKey });

  const activeAdminCount = useMemo(
    () => users?.filter((managedUser) => managedUser.isActive && managedUser.role === "admin").length ?? 0,
    [users],
  );

  const actionMutation = useMutation({
    mutationFn: async ({ id, action }: { id: number; action: UserAction }) => {
      const response = await apiRequest("PATCH", `/api/admin/users/${id}`, { action });
      return (await response.json()) as ManagedUser;
    },
    onSuccess: async (_updatedUser, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: usersKey }),
        queryClient.invalidateQueries({ queryKey: ["/api/users"] }),
        queryClient.invalidateQueries({
          predicate: (query) => {
            const key = query.queryKey[0];
            return typeof key === "string" && (key.startsWith("/api/admin/") || key.startsWith("/api/auth/"));
          },
        }),
      ]);
      if (variables.id === currentUser?.id) {
        queryClient.removeQueries({
          predicate: (query) => query.queryKey[0] !== authKey[0],
        });
        await queryClient.invalidateQueries({ queryKey: authKey });
        await queryClient.refetchQueries({ queryKey: authKey, type: "active" });
      }
    },
  });

  function runAction(managedUser: ManagedUser, action: UserAction) {
    if (action === "deactivate") {
      const consequence = managedUser.id === currentUser?.id
        ? "You will be signed out and lose access to the workspace."
        : `${managedUser.displayName} will lose access to the workspace until reactivated.`;
      if (!window.confirm(`Deactivate ${managedUser.displayName}? ${consequence}`)) return;
    }
    if (action === "demote") {
      const consequence = managedUser.id === currentUser?.id
        ? "Your admin access will be removed and this page may no longer be available."
        : `${managedUser.displayName} will lose admin access.`;
      if (!window.confirm(`Demote ${managedUser.displayName} to user? ${consequence}`)) return;
    }
    actionMutation.mutate({ id: managedUser.id, action });
  }

  return (
    <section className="border rounded-lg bg-card overflow-hidden" aria-labelledby="user-management-title">
      <div className="px-5 py-4 border-b bg-muted/20 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-md bg-primary/10 p-2 text-primary">
            <Shield className="w-4 h-4" aria-hidden="true" />
          </div>
          <div>
            <h2 id="user-management-title" className="font-semibold">User management</h2>
            <p className="text-sm text-muted-foreground mt-0.5">Manage workspace access and administrator privileges.</p>
          </div>
        </div>
        <span className="text-xs font-medium text-muted-foreground">
          {users ? `${users.length} ${users.length === 1 ? "member" : "members"}` : "Workspace members"}
        </span>
      </div>

      {actionMutation.isError && (
        <div role="alert" className="mx-5 mt-4 flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{actionMutation.error instanceof Error ? actionMutation.error.message : "The user update failed. Please try again."}</span>
        </div>
      )}

      {isLoading ? (
        <div className="p-5 space-y-3" aria-label="Loading users" role="status">
          <div className="h-14 rounded-md bg-muted/60 animate-pulse" />
          <div className="h-14 rounded-md bg-muted/60 animate-pulse" />
          <div className="sr-only">Loading workspace members</div>
        </div>
      ) : isError ? (
        <div className="p-6 text-center">
          <AlertCircle className="w-6 h-6 mx-auto mb-2 text-destructive" aria-hidden="true" />
          <p className="text-sm font-medium">Could not load workspace members</p>
          <p className="mt-1 text-sm text-muted-foreground">{error instanceof Error ? error.message : "Please try again."}</p>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="mt-4 inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} aria-hidden="true" />
            Retry
          </button>
        </div>
      ) : users?.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <UserRound className="w-7 h-7 mx-auto mb-2 text-muted-foreground/60" aria-hidden="true" />
          <p className="text-sm font-medium">No members to manage</p>
          <p className="text-sm text-muted-foreground mt-1">Workspace users will appear here.</p>
        </div>
      ) : (
        <div className="divide-y">
          {users?.map((managedUser) => {
            const isSelf = managedUser.id === currentUser?.id;
            const lastActiveAdmin = managedUser.isActive && managedUser.role === "admin" && activeAdminCount <= 1;
            const rowBusy = actionMutation.isPending && actionMutation.variables?.id === managedUser.id;
            return (
              <article
                key={managedUser.id}
                data-testid={`user-row-${managedUser.id}`}
                className="px-5 py-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${managedUser.isActive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                    <span className="text-sm font-semibold" aria-hidden="true">
                      {(managedUser.displayName || managedUser.email).slice(0, 1).toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">
                      {managedUser.displayName}
                      {isSelf && <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span>}
                    </p>
                    <p className="text-sm text-muted-foreground truncate">{managedUser.email}</p>
                  </div>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between lg:justify-end">
                  <div className="flex items-center gap-2">
                    {managedUser.role === "admin" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                        <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" /> Admin
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                        <UserRound className="w-3.5 h-3.5" aria-hidden="true" /> User
                      </span>
                    )}
                    <span className={`inline-flex items-center gap-1 text-xs font-medium ${managedUser.isActive ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${managedUser.isActive ? "bg-emerald-600 dark:bg-emerald-400" : "bg-muted-foreground/50"}`} />
                      {managedUser.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
                    {managedUser.role === "user" ? (
                      <button
                        type="button"
                        data-testid={`button-promote-user-${managedUser.id}`}
                        aria-label={`Promote ${managedUser.displayName} to admin`}
                        onClick={() => runAction(managedUser, "promote")}
                        disabled={!managedUser.isActive || actionMutation.isPending}
                        className="inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50"
                      >
                        {rowBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />}
                        Promote
                      </button>
                    ) : (
                      <button
                        type="button"
                        data-testid={`button-demote-user-${managedUser.id}`}
                        aria-label={`Demote ${managedUser.displayName} to user`}
                        title={lastActiveAdmin ? "At least one active administrator must remain." : undefined}
                        aria-describedby={lastActiveAdmin ? `last-admin-${managedUser.id}` : undefined}
                        onClick={() => runAction(managedUser, "demote")}
                        disabled={lastActiveAdmin || actionMutation.isPending}
                        className="inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50"
                      >
                        {rowBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <UserRoundX className="w-3.5 h-3.5" aria-hidden="true" />}
                        Demote
                      </button>
                    )}
                    {managedUser.isActive ? (
                      <button
                        type="button"
                        data-testid={`button-deactivate-user-${managedUser.id}`}
                        aria-label={`Deactivate ${managedUser.displayName}`}
                        title={lastActiveAdmin ? "At least one active administrator must remain." : undefined}
                        aria-describedby={lastActiveAdmin ? `last-admin-${managedUser.id}` : undefined}
                        onClick={() => runAction(managedUser, "deactivate")}
                        disabled={lastActiveAdmin || actionMutation.isPending}
                        className="inline-flex items-center justify-center gap-1.5 rounded-md border border-destructive/30 px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/5 disabled:opacity-50"
                      >
                        {rowBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <UserRoundX className="w-3.5 h-3.5" aria-hidden="true" />}
                        Deactivate
                      </button>
                    ) : (
                      <button
                        type="button"
                        data-testid={`button-reactivate-user-${managedUser.id}`}
                        aria-label={`Reactivate ${managedUser.displayName}`}
                        onClick={() => runAction(managedUser, "reactivate")}
                        disabled={actionMutation.isPending}
                        className="inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50"
                      >
                        {rowBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" aria-hidden="true" />}
                        Reactivate
                      </button>
                    )}
                  </div>
                </div>
                {lastActiveAdmin && (
                  <span id={`last-admin-${managedUser.id}`} className="sr-only">
                    At least one active administrator must remain, so this action is unavailable.
                  </span>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}