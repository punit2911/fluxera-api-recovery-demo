# Deployment

The app is one Node process with no build step and no dependencies. Any host that runs `node server.js` and sets `PORT` will do.

## Render (free)

1. Push the project to a GitHub repository.
2. In Render choose New, Web Service, and select the repository.
3. Runtime Node, build command `npm install`, start command `node server.js`. The included `render.yaml` sets the same values and a generated webhook secret.
4. Deploy. The health check path is `/healthz`.

Free instances sleep after idle time. Open the URL a minute before presenting, and press Reset before each run.

## Docker

```
docker build -t fluxera-recovery-demo .
docker run -p 8080:8080 -e RECOVERY_WEBHOOK_SECRET=change-me fluxera-recovery-demo
```

## Configuration

See `.env.example`. `RECOVERY_WEBHOOK_URL` can point the control plane at a different integration endpoint; by default it calls the demo's own `/integration/recovery-webhook` on the process's own origin.

## Before you present

- `npm run smoke` should print three `ok` lines.
- Press Reset so the page starts empty.
- The server holds state in memory, so a restart is also a full reset.
- Server-sent events need a host that does not buffer responses. If they are blocked the page falls back to polling every few seconds.

## Video

The page embeds `public/media/walkthrough.mp4`. To replace it, drop a new file with the same name, or set `VIDEO_URL` to a hosted file or an embed URL. `npm run record` regenerates the captioned recording from the running app (needs Playwright installed).
