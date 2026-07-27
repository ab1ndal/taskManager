"use client";

import { useState, useTransition } from "react";
import { createWorkspace } from "./actions";
import { toast } from "@/components/toaster";
import { WorkspaceCard, type WorkspaceCardData } from "./workspace-card";
import { Dialog } from "@/components/dialog";

interface WorkspacesClientProps {
  workspaces: WorkspaceCardData[];
  joinedIds: Set<string>;
}

export function WorkspacesClient({ workspaces, joinedIds }: WorkspacesClientProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"household" | "work">("household");
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    startTransition(async () => {
      try {
        const ws = await createWorkspace(name, kind);
        toast(`Workspace "${ws.name}" created`);
        setModalOpen(false);
        setName("");
        setKind("household");
      } catch (err) {
        // Inline only. This fires while the dialog is open, and a toast behind an open dialog is
        // inert — the same reason the task modals report inline. Reporting both also told the user
        // about one failure twice, in two different wordings.
        setFormError(
          err instanceof Error ? err.message : "Failed to create workspace. Please try again."
        );
      }
    });
  };

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold tracking-tight text-[var(--color-text-primary)]">
          All Workspaces
        </h2>
        <button
          onClick={() => setModalOpen(true)}
          className="text-sm font-semibold px-4 py-2 rounded-sm bg-[var(--color-accent)] text-[var(--color-text-on-accent)] hover:bg-[var(--color-accent-hover)] transition-colors duration-150"
        >
          Create Workspace
        </button>
      </div>

      {/* Directory list */}
      {workspaces.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">
            No workspaces yet
          </p>
          <p className="text-sm text-[var(--color-text-secondary)]">Create the first one!</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* The wrapper div existed only to carry a staggered animationDelay for an animation that
              was never declared. */}
          {workspaces.map((ws) => (
            <WorkspaceCard key={ws.id} workspace={ws} initialJoined={joinedIds.has(ws.id)} />
          ))}
        </div>
      )}

      {/*
        Was a hand-rolled `fixed inset-0` overlay with a click-outside handler: no role="dialog",
        no aria-modal, no focus trap, no Escape, no focus restore — none of the guarantees Phase 04
        built into the shared Dialog, which is backed by a native <dialog>.showModal().
      */}
      {modalOpen && (
        <Dialog
          open={modalOpen}
          onClose={() => {
            setModalOpen(false);
            setFormError(null);
          }}
          initialFocusSelector="#ws-name"
          ariaLabelledBy="create-workspace-title"
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-login)] p-6 w-full max-w-sm max-h-[90dvh] overflow-y-auto backdrop:bg-[var(--color-scrim)]"
        >
          <h3
            id="create-workspace-title"
            className="text-base font-semibold text-[var(--color-text-primary)] mb-4"
          >
            Create Workspace
          </h3>
            <form onSubmit={handleCreate} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="ws-name"
                  className="text-xs font-semibold text-[var(--color-text-secondary)]"
                >
                  Name
                </label>
                <input
                  id="ws-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Home, Acme Corp"
                  required
                  className="w-full rounded-sm border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-[var(--color-text-secondary)]">
                  Kind
                </span>
                <div className="flex gap-3">
                  {(["household", "work"] as const).map((k) => (
                    <label
                      key={k}
                      className="flex items-center gap-2 text-sm text-[var(--color-text-primary)] cursor-pointer"
                    >
                      <input
                        type="radio"
                        name="kind"
                        value={k}
                        checked={kind === k}
                        onChange={() => setKind(k)}
                        className="accent-[var(--color-accent)]"
                      />
                      {k === "household" ? "Household" : "Work"}
                    </label>
                  ))}
                </div>
              </div>

              {/* --color-deadline-red was deleted with the old palette; this was resolving to
                  nothing and rendering the error in the inherited text colour. */}
              {formError && (
                <p
                  role="alert"
                  className="rounded-sm bg-[var(--color-danger-surface)] px-3 py-2 text-sm text-[var(--color-danger-text)]"
                >
                  {formError}
                </p>
              )}

              <div className="flex gap-2 justify-end pt-1">
                <button
                  type="button"
                  onClick={() => { setModalOpen(false); setFormError(null); }}
                  className="text-sm font-semibold px-4 py-2 rounded-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors duration-150"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending || !name.trim()}
                  className="text-sm font-semibold px-4 py-2 rounded-sm bg-[var(--color-accent)] text-[var(--color-text-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50 disabled:pointer-events-none transition-colors duration-150"
                >
                  {isPending ? "Creating…" : "Create"}
                </button>
              </div>
            </form>
        </Dialog>
      )}
    </>
  );
}
