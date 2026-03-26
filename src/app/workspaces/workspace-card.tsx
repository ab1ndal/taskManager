"use client";

import { useState, useTransition } from "react";
import { joinWorkspaceByDirectory } from "./actions";
import { toast } from "@/components/toaster";

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

  const kindLabel = workspace.kind === "household" ? "Household" : "Work";
  const kindClass =
    workspace.kind === "household"
      ? "bg-indigo-100 text-indigo-700"
      : "bg-sky-100 text-sky-700";

  return (
    <div
      className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 flex items-center justify-between gap-4 transition-shadow duration-150 hover:shadow-[var(--shadow-card)]"
      style={{ animationFillMode: "both" }}
    >
      <div className="flex flex-col gap-1 min-w-0">
        <span className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
          {workspace.name}
        </span>
        <div className="flex items-center gap-2">
          <span
            className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${kindClass}`}
          >
            {kindLabel}
          </span>
          <span className="text-[11px] text-[var(--color-text-muted)]">
            {workspace.member_count} members
          </span>
        </div>
      </div>

      {joined ? (
        <span className="shrink-0 text-[11px] font-semibold px-3 py-1 rounded-full bg-green-100 text-green-700">
          Joined
        </span>
      ) : (
        <button
          onClick={handleJoin}
          disabled={isPending}
          className="shrink-0 text-[11px] font-semibold px-3 py-1 rounded-full bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)] hover:bg-[var(--color-accent)] hover:text-white disabled:opacity-50 disabled:pointer-events-none transition-opacity duration-100"
        >
          {isPending ? "Joining..." : "Join"}
        </button>
      )}
    </div>
  );
}
