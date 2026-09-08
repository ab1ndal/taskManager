# Product Specification

This application is a task manager that supports multiple workspaces.

Users must be able to access the system from anywhere.

Two workspace types must exist:

Household workspace
Used for household tasks


Work workspace
Used for work related tasks

A user can switch between workspaces or view all workspaces together. A user can assign the task to themselves or to another user in the workspace. Alternatively, the user can indicate that the task is shared.

## Task Types

Tasks may be:

Personal tasks
Shared tasks
Recurring tasks
Tasks with deadlines
Tasks without deadlines
Subtasks within tasks

## Visibility and Views

A user must only see tasks that are relevant to them.

Relevant means
A task is assigned to the current user.

Views within the selected workspace scope:

Relevant Tasks
All tasks assigned to the current user

Shared Tasks
Subset of Relevant Tasks that are assigned to more than one member

Tasks not assigned to the current user must not be shown.

## Board View

A kanban view of the same tasks the list view shows, at /board.

The board shows root tasks only, as cards carrying title, deadline and workspace. Subtasks,
descriptions and updates stay out of the card body. Pressing an open card opens the existing task
editor in a modal. The card menu offers edit, complete/reopen, delete and “Move to column…”.
The move dialog can reach columns outside the visible board and uses the same completion rules as
dragging, while preserving personal priority. Titles wrap so they remain readable on a phone.

In a single-workspace view, active columns offer “Add task” prefilled with that column and workspace.

Columns are defined per workspace and shared by that workspace's members. Any member may add,
rename, recolour or delete a column from Settings → Board, and the change applies to everyone in
that workspace. The all-workspaces board merges columns of the same name across workspaces.

Moving a task between columns moves it for every assignee. Vertical order within a column stays per
user — the same member_sort_key ordering the list view uses.

The seeded Completed column is the workspace's completed column. Settings can rename, recolor,
reorder or delete it; changing which column has this role is not currently available.
Dragging a task there completes it,
with the existing subtask rules; dragging it out reopens it. A completed task always appears in that
column, whichever column it was in before.

The completed column shows the last 7 days by default and expands on request.

Columns can be dragged into a different order from Settings → Board, including the completed column:
the board renders whatever order the columns are given.

Deleting a column asks where each of its tasks should go, one destination per task. Renaming a
column never moves a task.

Default columns for a new workspace: Not Started, In Progress, Blocked, Follow-up, Completed.

## Task Properties

Tasks contain:

title
description
due_at optional
completed_at
assigned users
parent task for subtasks

## Task Priority

Each user maintains their own consistent priority list.

Ordering is per user.

Shared tasks may have different priority for different users.

Tasks can be moved up or down the priority list.

Ordering must work:

within top level tasks
within subtasks of a parent

## Deadline Colors

Red
Task is overdue

Yellow
Task due within 24 hours

Green
Task has sufficient time remaining

Completed tasks appear neutral or grey colored. A task is completed when the entire task and all its subtasks are marked as complete.

Tasks without deadlines appear green.

## Updates and Speech to Text

Tasks support updates.

Updates are stored as text only with the date stamp.

Users can create updates by typing or by using speech to text dictation.

Speech to text happens during input and users can edit the text before saving.

Audio must never be stored.

## Recurring Tasks

Users can create recurring tasks.

Supported frequencies:

daily
weekly
monthly

Any interval of these is allowed, so "every 3 days" and "every 2 weeks" are both expressible.

A recurring task is a single permanent task that automatically reactivates at each occurrence.

Switching Repeats off pauses the schedule rather than deleting it: the task stops reactivating, but
its cadence is kept and switching Repeats back on resumes it unchanged. Deleting the task is what
ends a recurrence for good.

## Subtasks

Tasks may contain subtasks.

Subtasks behave like tasks and can be viewed within the parent task.

Subtasks can:

have deadlines
have assignees
have updates
be reordered

## Groceries

`/groceries` opens the shopping list by default; Pantry is the other view of the same household
workspace's items. View navigation retains the selected workspace. Grocery visibility is workspace
membership, not task assignment: every member can read, add, edit, archive, and permanently forget
any item. This is the deliberate exception to task assignment visibility.

Need adds an item to the shopping list without removing it from the pantry (low stock). Bought
returns it to the pantry and removes it from the list. Finished clears pantry details and either
keeps the item on the list or archives it. Archived names remain available for autocomplete.

Each purchase creates a separate batch with optional quantity and expiry, including repeat purchases
with the same date or no date. Pantry shows the earliest expiry and sums quantities only when every
batch is counted. The batch disclosure provides editing even for a single batch. Finishing a batch
leaves other purchases intact; finishing the product removes all its stock.

Bought opens purchase entry with optional quantity, a printed date, no expiry (default), or an
explicit category-based estimate. Save and add another batch handles multiple expiry dates in one
trip. The pantry menu offers Record purchase for subsequent trips. A counted item's decrement uses
the earliest expiry first; reaching zero adds it to the shopping list. Unknown totals have no stepper.

Product editing changes name/category in the pantry and name only in shopping. Shopping has no
category controls, tags, filters or category ordering; it sorts alphabetically. Pantry retains
category filtering above 15 items and expiry/name sorting. Expired batches appear in a cleanup
section with Still good and Gone; removing one never removes fresh stock. Estimates use a muted `~`
and expired stock uses amber, never task-deadline red.

Foreground polling refreshes shared data every 20 seconds. Failed reads show a retryable error
screen instead of a misleading empty list.
