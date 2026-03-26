"use client";

import { useState, useTransition } from "react";
import { createWorkspace } from "./actions";
import { toast } from "@/components/toaster";
import { WorkspaceCard, type WorkspaceCardData } from "./workspace-card";

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
        const msg =
          err instanceof Error ? err.message : "Failed to create workspace. Please try again.";
        setFormError(msg);
        toast("Failed to create workspace. Please try again.", "error");
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
          className="text-sm font-semibold px-4 py-2 rounded-[8px] bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors duration-150"
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
          {workspaces.map((ws, i) => (
            <div
              key={ws.id}
              style={{ animationDelay: `${i * 30}ms` }}
            >
              <WorkspaceCard
                workspace={ws}
                initialJoined={joinedIds.has(ws.id)}
              />
            </div>
          ))}
        </div>
      )}

      {/* Create Workspace Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModalOpen(false);
          }}
        >
          <div
            className="w-full max-w-sm mx-4 rounded-[12px] bg-[var(--color-surface)] border border-[var(--color-border)] shadow-[var(--shadow-login)] p-6"
            style={{
              animation: "modal-in 150ms ease-out both",
            }}
          >
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-4">
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
                  className="w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent"
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

              {formError && (
                <p className="text-xs text-[var(--color-deadline-red)]">{formError}</p>
              )}

              <div className="flex gap-2 justify-end pt-1">
                <button
                  type="button"
                  onClick={() => { setModalOpen(false); setFormError(null); }}
                  className="text-sm font-semibold px-4 py-2 rounded-[8px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors duration-150"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending || !name.trim()}
                  className="text-sm font-semibold px-4 py-2 rounded-[8px] bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50 disabled:pointer-events-none transition-colors duration-150"
                >
                  {isPending ? "Creating..." : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
