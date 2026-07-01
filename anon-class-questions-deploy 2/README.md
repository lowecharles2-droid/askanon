# AskAnon — Anonymous Classroom Questions

AskAnon is a lightweight live question board for high school and college classes. Professors/teachers create a class, share a student join code, and manage anonymous student questions from a private dashboard.

## Features

- Create a class board with a private professor dashboard link
- Student join code and public student link
- Anonymous question submission with optional topic tags
- Live auto-refresh on student and professor pages
- Upvotes so the best questions rise to the top
- Search, filter, and sort questions
- Professor tools: mark answered/open, pin, hide, and unhide
- Public professor answer/note shown under a question
- Pause/resume new question submissions
- Export professor dashboard questions to CSV
- Local saved data in `data/app.json`

## Why this version is easy to run

This version uses only built-in Node.js features. No Express, SQLite, Xcode command line tools, or native packages are required.

## Requirements

- Node.js installed

Check that Node works:

```bash
node -v
```

## Run locally

Open Terminal and go into the folder:

```bash
cd /Users/YOUR_NAME/Downloads/anon-class-questions-deploy
```

Start the site:

```bash
npm start
```

Then open this in Chrome:

```text
http://localhost:3000
```

You do **not** need to run `npm install` locally for this version.

## Reset demo data

Delete this file:

```text
data/app.json
```

Then restart the app.

## Deploy as a public website

Use `DEPLOY.md` for the exact public-hosting steps.

This project is Render-ready:

- It binds to `0.0.0.0`, which public hosts require.
- It reads the public host's `PORT` environment variable.
- It supports a configurable `DATA_DIR` for persistent storage.
- It includes `render.yaml` for Render deployment defaults.

## Notes for real school use

This is still an MVP. For a real school launch, add professor accounts, stronger moderation/abuse controls, school privacy review, and a hosted database such as Postgres, Supabase, or Firebase.
