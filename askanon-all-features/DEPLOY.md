# Deploy AskAnon

## Existing Render service

If you already deployed AskAnon:

1. Replace the old GitHub files with this folder’s files.
2. Commit/upload the changes.
3. In Render, open your service.
4. Confirm settings:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Node Version: `22`
   - Root Directory: blank if `package.json` is at the repo top level, or the folder name if `package.json` is inside a folder.
5. Click **Manual Deploy → Clear build cache & deploy**.

## New Render service

1. Create a GitHub repo.
2. Upload these files.
3. Create a new Render **Web Service**.
4. Connect the GitHub repo.
5. Use:

```text
Build Command: npm install
Start Command: npm start
Node Version: 22
```

6. Deploy.

## If Render says `package.json` is missing

Your Root Directory is wrong.

If GitHub shows:

```text
package.json
server.js
public/
```

then Root Directory should be blank.

If GitHub shows:

```text
askanon-all-features/
  package.json
  server.js
  public/
```

then Root Directory should be:

```text
askanon-all-features
```
