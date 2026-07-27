"use client";

import { useState, useTransition } from "react";
import { joinWorkspaceByDirectory, leaveWorkspace } from "./actions";
import { toast } from "@/components/toaster";
import { ConfirmDialog } from "@/components/confirm-dialog";

export interface WorkspaceCardData {
  id: string;
  name: string;
  kind: string;
  member_count: number;
}

interface WorkspaceCardProps {
  workspace: WorkspaceCardData;
  initialJoined: boolean;
}

export function WorkspaceCard({ workspace, initialJoined }: WorkspaceCardProps) {
  const [joined, setJoined] = useState(initialJoined);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleJoin = () => {
    startTransition(async () => {
      try {
        await joinWorkspaceByDirectory(workspace.id);
        setJoined(true);
        toast(`Joined "${workspace.name}"`);
      } catch (err) {
        toast(
          err instanceof Error
            ? `Failed to join "${workspace.name}". Please try again.`
            : `Failed to join "${workspace.name}". Please try again.`,
          "error"
        );
      }
    });
  };

  const handleLeave = () => {
    setLeaveConfirmOpen(false);
    startTransition(async () => {
      try {
        await leaveWorkspace(workspace.id);
        setJoined(false);
        toast(`Left "${workspace.name}"`);
      } catch (err) {
        toast(
          err instanceof Error ? err.message : `Failed to leave "${workspace.name}".`,
          "error"
        );
      }
    });
  };

  const kindLabel = workspace.kind === "household" ? "Household" : "Work";
  const kindClass =
    workspace.kind === "household"
      ? "bg-[var(--color-kind-household-surface)] text-[var(--color-kind-household-text)]"
      : "bg-[var(--color-kind-work-surface)] text-[var(--color-kind-work-text)]";

  return (
    <div
      className="rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 flex items-center justify-between gap-4 transition-shadow duration-150 hover:shadow-[var(--shadow-card)]"
    >
      <div className="flex flex-col gap-1 min-w-0">
        <span className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
          {workspace.name}
        </span>
        <div className="flex items-center gap-2">
          <span
            className={`text-2xs font-semibold px-2 py-0.5 rounded-full ${kindClass}`}
          >
            {kindLabel}
          </span>
          <span className="text-xs text-[var(--color-text-muted)]">
            {workspace.member_count} members
          </span>
        </div>
      </div>

      {joined ? (
        /*
          Membership state and the action to change it are now two separate things. The old control
          was a single button reading "Joined" that silently became "Leave" on mouseenter — a touch
          user got no such hint and simply left the workspace on first tap, and there was no
          confirmation despite this being a destructive action on shared data.
        */
        <div className="shrink-0 flex items-center gap-2">
          <span className="text-2xs font-semibold px-3 py-1 rounded-full bg-[var(--color-success-surface)] text-[var(--color-success-text)]">
            Joined
          </span>
          <button
            onClick={() => setLeaveConfirmOpen(true)}
            disabled={isPending}
            className="text-2xs font-semibold px-3 py-1 rounded-full transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none text-[var(--color-text-secondary)] hover:bg-[var(--color-danger-surface)] hover:text-[var(--color-danger-text)]"
          >
            {isPending ? "Leaving…" : "Leave"}
          </button>
        </div>
      ) : (
        <button
          onClick={handleJoin}
          disabled={isPending}
          className="shrink-0 text-2xs font-semibold px-3 py-1 rounded-full bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)] hover:bg-[var(--color-accent)] hover:text-[var(--color-text-on-accent)] disabled:opacity-50 disabled:pointer-events-none transition-opacity duration-100"
        >
          {isPending ? "Joining…" : "Join"}
        </button>
      )}

      <ConfirmDialog
        open={leaveConfirmOpen}
        id={`leave-confirm-${workspace.id}`}
        title={<>Leave &quot;{workspace.name}&quot;?</>}
        body="You will stop seeing tasks assigned to you in this workspace. You can rejoin from the directory."
        confirmLabel="Leave"
        confirmAriaLabel={`Confirm leaving "${workspace.name}"`}
        cancelAriaLabel="Cancel leaving workspace"
        onConfirm={handleLeave}
        onCancel={() => setLeaveConfirmOpen(false)}
      />
    </div>
  );
}
