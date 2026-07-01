# AskAnon — Anonymous Class Questions

AskAnon is a full MVP for anonymous classroom questions for high school and college classes. Professors create a board, students join with a code/QR link, and questions update live.

## Included features

1. Professor presentation mode
2. Question categories
3. “I’m confused too” same-question voting
4. Professor answer history
5. Status labels: New, Needs answer, Answered, Skipped, Saved for later
6. Duplicate-question detection
7. Classroom-safe moderation with blocked words and spam checks
8. Custom professor pause message
9. Class session mode
10. QR-code join page/link
11. Student reaction buttons after professor answers: Got it, Still confused, Need example
12. Local smart confusion summary for professors
13. Exportable lecture report and CSV
14. Student exit tickets
15. Professor login with class code and password

## Why this version is easy to run

This version uses only built-in Node.js modules. There are no native packages, no SQLite compilation, and no Xcode command line tools required.

## Run locally

```bash
cd askanon-all-features
npm start
```

Then open:

```text
http://localhost:3000
```

## Deploy on Render

Use these settings:

```text
Root Directory: blank if package.json is at the repo top level
Build Command: npm install
Start Command: npm start
Node Version: 22
```

If your GitHub repo has a folder like `askanon-all-features/` and the files are inside that folder, set:

```text
Root Directory: askanon-all-features
```

## Important data note

The app stores data in `data/app.json`. This is fine for a demo or class prototype. On free Render, local files may reset when the service restarts/redeploys. For a real launch, move the data layer to Supabase, Firebase, Postgres, or Render persistent disks.

## Suggested workflow

1. Professor creates a class board.
2. Professor shares the student URL or QR code.
3. Students submit anonymous questions.
4. Students vote “I’m confused too” on existing questions instead of duplicating.
5. Professor answers live or opens presentation mode.
6. Students react to answers.
7. Students submit exit tickets.
8. Professor exports a CSV or report after class.

## Safety note

The app is anonymous to classmates and the professor dashboard does not show student names. It is not designed for secret crisis reporting or school safety emergencies. Schools should still use official reporting/safety systems for urgent issues.
