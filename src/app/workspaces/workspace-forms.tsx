"use client";

import { useState, useTransition } from "react";
import { createWorkspace } from "./actions";
import { toast } from "@/components/toaster";

export function WorkspaceForms() {
  const [createPending, startCreate] = useTransition();

  const [createName, setCreateName] = useState("");
  const [createKind, setCreateKind] = useState<"household" | "work">("household");
  const [createError, setCreateError] = useState<string | null>(null);
  const [newWorkspace, setNewWorkspace] = useState<{
    name: string;
    kind: string;
  } | null>(null);

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setNewWorkspace(null);
    startCreate(async () => {
      try {
        const ws = await createWorkspace(createName, createKind);
        setNewWorkspace(ws);
        setCreateName("");
        setCreateKind("household");
        toast(`Workspace "${ws.name}" created`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to create workspace";
        setCreateError(msg);
        toast(msg, "error");
      }
    });
  }

  const inputClass =
    "rounded-[8px] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-[9px] text-sm outline-none focus:border-[var(--color-accent)] focus:ring-[3px] focus:ring-[var(--color-accent)]/10 focus:bg-white w-full";
  const labelClass = "text-xs font-medium text-[var(--color-text-secondary)]";
  const btnClass =
    "w-fit rounded-[8px] bg-[var(--color-accent)] px-5 py-[10px] text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50 transition-colors";

  return (
    <div className="mt-8 flex flex-col gap-8">
      {/* Create workspace */}
      <section>
        <h3 className="text-base font-semibold text-[var(--color-text-primary)] mb-4">
          Create a workspace
        </h3>
        <form onSubmit={handleCreate} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ws-name" className={labelClass}>
              Name
            </label>
            <input
              id="ws-name"
              type="text"
              required
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              className={inputClass}
              placeholder="e.g. My household"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="ws-kind" className={labelClass}>
              Type
            </label>
            <select
              id="ws-kind"
              value={createKind}
              onChange={(e) => setCreateKind(e.target.value as "household" | "work")}
              className={inputClass}
            >
              <option value="household">Household</option>
              <option value="work">Work</option>
            </select>
          </div>

          {createError && (
            <p className="text-xs text-red-600">{createError}</p>
          )}

          {newWorkspace && (
            <div className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-accent-subtle)] px-4 py-3 text-sm">
              <p className="font-medium text-[var(--color-accent-text)]">
                Workspace &ldquo;{newWorkspace.name}&rdquo; created!
              </p>
            </div>
          )}

          <button type="submit" disabled={createPending} className={btnClass}>
            {createPending ? "Creating…" : "Create workspace"}
          </button>
        </form>
      </section>
    </div>
  );
}
