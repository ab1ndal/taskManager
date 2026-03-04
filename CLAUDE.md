# Claude Code Instructions

This repository builds a task manager accessible anywhere using:

Next.js 16
TypeScript
Tailwind
Supabase
Vercel

The system supports two workspace types by default:

Household
Work

## Required Reading

Before implementing features:

Read docs/product.md for product requirements.

Read docs/db.md when working with database schema, RLS, or queries.

Read docs/workflow.md for development workflow rules.

## Context Management Rules

1. Never scan the entire repository unless explicitly requested.
2. Use search before opening files.
3. Only open files necessary for the task.
4. Implement one feature slice at a time.
5. Prefer small diffs instead of rewriting entire files.
6. Do not open lockfiles, node_modules, or build outputs.

## Development Order

Always follow this order when implementing features:

1. Database schema and migrations
2. Row Level Security policies
3. API routes
4. UI components
5. Tests
6. Polishing

## Core Product Rules

Visibility
Users only see tasks that are assigned to them via task_assignments.

Priority
Priority ordering is per user using task_assignments.member_sort_key.
Shared tasks may have different priority for different users.

Updates
Updates are text only. Speech to text is allowed at input time.
Audio must never be stored.

Subtasks
Subtasks are tasks with parent_task_id.

Recurring
Recurring rules generate new task instances.
