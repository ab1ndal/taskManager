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
