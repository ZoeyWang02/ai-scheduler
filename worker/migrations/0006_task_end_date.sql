-- An event has a start (due_date) and an end; a task is a deadline and has no end. NULL end_date = a task.
ALTER TABLE tasks ADD COLUMN end_date TEXT;
