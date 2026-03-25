"use client";

import { useState, useTransition } from "react";
import { createWorkspace, joinWorkspaceByPin } from "./actions";
import { toast } from "@/components/toaster";

function formatPin(pin: string): string {
  return pin.slice(0, 3) + " " + pin.slice(3);
}

export function WorkspaceForms() {
  const [createPending, startCreate] = useTransition();
  const [joinPending, startJoin] = useTransition();

  const [createName, setCreateName] = useState("");
  const [createKind, setCreateKind] = useState("household");
  const [createError, setCreateError] = useState<string | null>(null);
  const [newWorkspace, setNewWorkspace] = useState<{
    name: string;
    kind: string;
    join_pin: string;
  } | null>(null);

  const [joinPin, setJoinPin] = useState("");
  const [joinDisplayName, setJoinDisplayName] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);

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

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    setJoinError(null);
    startJoin(async () => {
      try {
        const { workspaceName } = await joinWorkspaceByPin(joinPin, joinDisplayName);
        toast(`Joined "${workspaceName}"`);
        setJoinPin("");
        setJoinDisplayName("");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to join workspace";
        setJoinError(msg);
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
              onChange={(e) => setCreateKind(e.target.value)}
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
              <p className="mt-1 text-[var(--color-text-secondary)]">
                Share this pin to invite others:{" "}
                <span className="font-mono font-semibold tracking-wider text-[var(--color-text-primary)]">
                  {formatPin(newWorkspace.join_pin)}
                </span>
              </p>
            </div>
          )}

          <button type="submit" disabled={createPending} className={btnClass}>
            {createPending ? "Creating…" : "Create workspace"}
          </button>
        </form>
      </section>

      {/* Join workspace */}
      <section>
        <h3 className="text-base font-semibold text-[var(--color-text-primary)] mb-4">
          Join a workspace
        </h3>
        <form onSubmit={handleJoin} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="join-pin" className={labelClass}>
              6-digit pin
            </label>
            <input
              id="join-pin"
              type="text"
              inputMode="numeric"
              required
              maxLength={6}
              pattern="[0-9]{6}"
              value={joinPin}
              onChange={(e) => setJoinPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className={inputClass}
              placeholder="123456"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="join-display-name" className={labelClass}>
              Your display name
            </label>
            <input
              id="join-display-name"
              type="text"
              required
              value={joinDisplayName}
              onChange={(e) => setJoinDisplayName(e.target.value)}
              className={inputClass}
              placeholder="e.g. Alice"
            />
          </div>

          {joinError && (
            <p className="text-xs text-red-600">{joinError}</p>
          )}

          <button type="submit" disabled={joinPending} className={btnClass}>
            {joinPending ? "Joining…" : "Join workspace"}
          </button>
        </form>
      </section>
    </div>
  );
}
