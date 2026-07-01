# Deploy AskAnon as a real public website

This version is ready to deploy to Render as a Node web service.

## Fastest demo deploy: Render

1. Create a free GitHub account if you do not already have one.
2. Create a new GitHub repository, for example `askanon`.
3. Upload every file in this folder to that repository.
4. Go to Render and create a new **Web Service**.
5. Connect your GitHub repo.
6. Use these settings:
   - Runtime: Node
   - Build command: leave blank, or use `echo no build needed`
   - Start command: `npm start`
   - Node version: `22`
7. Click deploy.
8. Render gives you a public URL like `https://askanon-xxxx.onrender.com`.

## Important data warning

The MVP stores questions in `data/app.json`.

On a free Render web service, local files are not guaranteed to persist forever. This is okay for a LaunchX demo or testing, but not ideal for real school use.

For a real launch, use one of these:

- Render paid web service + persistent disk
- Supabase/Postgres database
- Firebase/Firestore database

## Optional persistent disk setup on Render

If you use a paid Render service, add a persistent disk mounted to:

```text
/opt/render/project/src/data
```

Keep the `DATA_DIR` environment variable as:

```text
/opt/render/project/src/data
```

Then questions/classes will survive restarts and redeploys.

## Local testing

```bash
npm start
```

Then open:

```text
http://localhost:3000
```
