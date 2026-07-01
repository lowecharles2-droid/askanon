# AskAnon — Anonymous Classroom Questions MVP

AskAnon is a simple website where students can anonymously submit questions to a high school or college class board. Professors/teachers can create a class, share a student join code, and manage submitted questions from a private dashboard.

## Features

- Create a class board
- Student join code
- Anonymous question submission
- Optional question tags
- Upvotes
- Professor dashboard
- Mark questions answered
- Pin important questions
- Hide inappropriate/repeated questions
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
cd /Users/YOUR_NAME/Downloads/anon-class-questions
```

Start the site:

```bash
npm start
```

Then open this in Chrome:

```text
http://localhost:3000
```

You do **not** need to run `npm install` for this version.

## Reset demo data

Delete this file:

```text
data/app.json
```

Then restart the app.

## Notes

This is a local MVP. For a real school launch, you would eventually add authentication, stronger abuse protection, a hosted database, professor accounts, and school privacy review.


## Deploy as a public website

Use `DEPLOY.md` for the exact public-hosting steps.

This project is now Render-ready:

- It binds to `0.0.0.0`, which public hosts require.
- It reads the public host's `PORT` environment variable.
- It supports a configurable `DATA_DIR` for persistent storage.
- It includes `render.yaml` for Render deployment defaults.
