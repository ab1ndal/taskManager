# Development Workflow

This project should be built in small vertical slices.

Each slice must include:

database changes
API routes
UI components
tests

## Implementation Order

1. Supabase schema and migrations
2. Row Level Security policies
3. API routes
4. UI components
5. Recurring scheduler
6. Task updates with speech to text dictation

## Context Management

To reduce token cost:

Never read the entire repository.

Search first before opening files.

Only open files relevant to the current task.

Avoid opening:

node_modules
lockfiles
build outputs

## Editing Strategy

Prefer small edits instead of rewriting files.

Use patch style edits.

## Testing

After each feature:

run typecheck
run tests
verify API routes

## Database Changes

All schema changes must use migration files.

Example path:

supabase/migrations/001_initial_schema.sql
