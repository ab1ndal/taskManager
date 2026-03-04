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
biweekly
monthly

Recurring rules automatically generate task instances.

## Subtasks

Tasks may contain subtasks.

Subtasks behave like tasks and can be viewed within the parent task.

Subtasks can:

have deadlines
have assignees
have updates
be reordered
