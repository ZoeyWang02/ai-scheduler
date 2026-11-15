/* Typed access to the D1 tables. Rows keep the snake_case column names. */

export interface UserRow {
  id: number;
  email: string;
  username: string | null;
  password_hash: string | null;
  auth_token: string | null;
  name: string | null;
  canvas_token: string | null;
  created_at: string | null;
  timezone: string;
  utc_offset: string | null;
  preferences: string | null; // JSON text
}

export interface TaskRow {
  id: number;
  title: string | null;
  description: string | null;
  due_date: string | null;
  completed: number; // 0 | 1
  completed_at: string | null;
  ai_metadata: string | null;
  preceded_by_id: number | null;
  user_id: number;
  color: string | null;
  import_key: string | null;
}

export interface CourseRow {
  id: number;
  title: string | null;
  start_time: string;
  end_time: string;
  location: string | null;
  user_id: number;
}

export const userByToken = (db: D1Database, token: string) =>
  db.prepare("SELECT * FROM users WHERE auth_token = ?").bind(token).first<UserRow>();

export const userById = (db: D1Database, id: number) =>
  db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();

export const userByEmail = (db: D1Database, email: string) =>
  db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<UserRow>();

export const userByUsername = (db: D1Database, username: string) =>
  db.prepare("SELECT * FROM users WHERE username = ?").bind(username).first<UserRow>();

export const tasksForUser = async (db: D1Database, userId: number) =>
  (await db.prepare("SELECT * FROM tasks WHERE user_id = ? ORDER BY id").bind(userId).all<TaskRow>()).results;

export const taskById = (db: D1Database, id: number) =>
  db.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first<TaskRow>();

export const coursesForUser = async (db: D1Database, userId: number) =>
  (await db.prepare("SELECT * FROM course_events WHERE user_id = ? ORDER BY start_time, id").bind(userId).all<CourseRow>()).results;

export const courseById = (db: D1Database, id: number) =>
  db.prepare("SELECT * FROM course_events WHERE id = ?").bind(id).first<CourseRow>();

export function parsePreferences(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
