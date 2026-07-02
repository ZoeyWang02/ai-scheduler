# AI Scheduler

AI Scheduler is a Spring Boot application for academic task planning. It imports coursework from Canvas, Coursera, and `.ics` calendars, shows tasks and course sessions on a calendar, analyzes study rhythm, and uses an LLM to suggest task breakdowns.

## Features

- User signup and signin with token-based API access.
- Canvas and Coursera JSON import.
- `.ics` course schedule import with weekly recurrence expansion.
- Task create, edit, delete, color tagging, and calendar display.
- Routine analysis based on task due times.
- AI chat and plan suggestions with user-scoped task and course context.

## Configuration

Copy the local environment template and fill in secrets:

```powershell
Copy-Item .env.example .env
```

Then edit `.env`. Keep real secrets only in `.env`; it is ignored by Git.

Important local values:

```text
DB_PASSWORD=your_database_password
LLM_API_KEY=your_llm_api_key
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-new-google-client-secret
GOOGLE_REDIRECT_URI=http://localhost:8081/api/auth/oauth/google/callback
```

## Run

```powershell
.\run-local.ps1
```

Then open `http://localhost:8081`.

## Database Migrations

Database schema changes are managed by Flyway in:

```text
src/main/resources/db/migration
```

The first migration is `V1__baseline_schema.sql`. Hibernate is configured with `ddl-auto=validate`, so it checks that the database matches the entities but does not modify tables automatically.

For an existing non-empty local database, `spring.flyway.baseline-on-migrate=true` lets Flyway record the current schema as the baseline on first startup.

## Test

```powershell
mvn test
```

The current test suite avoids connecting to a real PostgreSQL instance.
