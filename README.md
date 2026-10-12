# Brill Overlays for Zoom

A Zoom App that puts **name tags** and **images** on top of your own video while you're in a Zoom call.
Everyone in the meeting sees the overlays on your video tile. It uses Zoom's official **Layers API → Camera Mode**.

## Features

- **Name tag overlays**
  - Name + optional subtitle (role, company, pronouns), UPPERCASE and italic options
  - **13 shapes for the box around the name:** rectangle, rounded, pill, lower third (with accent stripe), slanted, arrow, hexagon, ribbon, tab, speech bubble, ellipse, underline, text only
  - **Bounding box:** set X / Y / W / H yourself, or drag and resize it on the preview. Text auto-fits inside the box (you can turn this off and set font sizes by hand), and text is never drawn outside it
  - Fill colour, gradient, opacity, border, accent colour, drop shadow, text shadow, corner radius, inner padding, fonts, weight, alignment, letter spacing
  - 8 one-click styles (Broadcast, Clean pill, Neon, Gradient, Minimal, Ribbon, Glass, News)
- **Image overlays**: add images with the file picker, by drag and drop, or by pasting (Ctrl/Cmd+V). PNG transparency is kept.
  - Opacity, rectangle / rounded / circle mask, stretch / contain / cover, border, shadow, lock aspect ratio, replace image
- **Positioning**: a 9-point snap grid with an adjustable safe margin, size presets (lower third, compact, full-width banner, top corner), drag, resize from 8 handles, rotate, snapping to edges, centre lines and other overlays, and arrow-key nudging
- Multiple overlays with layer order, show/hide for each one, duplicate, and a **Hide all** panic button (`H`)
- Your work is saved automatically in IndexedDB. You can export or import a scene as JSON (images included).
- **Browser preview mode**: design your overlays in a normal browser, with a webcam preview, before you join the meeting.
- **Clean output** fallback (no Zoom app needed): a full-window view on webcam, green or black. Capture it with OBS and send it to Zoom through OBS Virtual Camera.

## Quick start (local design mode)

```bash
node server.js          # Node 18+, no npm install needed
# open http://localhost:3000
```

## Install it as a Zoom App

1. **Expose the server over HTTPS.** Zoom only loads HTTPS URLs:
   ```bash
   node server.js
   ngrok http 3000        # copy the https://xxxx.ngrok.app URL
   ```
2. Go to **https://marketplace.zoom.us → Develop → Build App** and create a **General App** (user-managed).
3. **Basic Information → OAuth**: set the redirect URL to `https://xxxx.ngrok.app/auth`.
4. **Features → Surface**: choose **Meetings**, then enable **Zoom App**.
   - **Home URL**: `https://xxxx.ngrok.app`
   - **Domain allow list**: `xxxx.ngrok.app` and `appssdk.zoom.us`
5. **Zoom App SDK → Add APIs**: add every one of these:
   `runRenderingContext, closeRenderingContext, drawParticipant, clearParticipant, drawImage, clearImage, drawWebView, clearWebView, postMessage, onMessage, getRunningContext, getUserContext, getVideoState, onMyMediaChange, onRenderedAppOpened`
6. Optional: copy `.env.example` to `.env` and fill in the Client ID, Client Secret and redirect URL. After you install, `/auth` sends you straight into the Zoom client.
7. **Local Test → Add App** → Authorize.
8. Join a meeting, **turn your camera on**, open **Apps → Brill Overlays**, then click **Go live in Zoom**.

After you go live, every edit (typing, dragging, changing styles) updates your video within about 0.1 seconds. Only the overlay you changed is re-sent.

## How it works

```
Sidebar app (runningContext = inMeeting)                Zoom camera pipeline
 ├─ zoomSdk.runRenderingContext({view:'camera'})  ──►   starts an off-screen copy of the app (inCamera)
 ├─ waits for onRenderedAppOpened / "camera-ready"  ◄── the inCamera copy stays transparent and posts "camera-ready"
 ├─ drawParticipant(self, zIndex 1)                     your camera video
 └─ drawImage(per overlay, zIndex 2+)                   each overlay is rendered to a tightly cropped canvas
```

- Everything is laid out in a 1280×720 design space, which matches Zoom's default camera render target. Overlays are scaled automatically if Zoom reports a different size.
- Each overlay is cached by a content hash. When something changes, the new image is drawn *before* the old one is cleared, so it doesn't flicker.

## Tips and troubleshooting

- **The text looks backwards to me.** Zoom mirrors your *self-view* only, so other participants see it the right way round. If participants also see it reversed, turn on *Output & scene → Flip overlays horizontally in Zoom*.
- **Nothing shows up.** Your camera must be on before you click Go live. Check that all the SDK APIs above are added in the Marketplace. If you just added APIs, reinstall the app.
- **Camera turned off and on again**: the app re-applies your overlays automatically.
- Very large images are reduced to 1600 px on the longest side when you import them, so updates stay fast.
- Keyboard: arrows nudge the selected overlay (Shift = 10 px), `Del` deletes it, `Ctrl/Cmd+D` duplicates it, `H` hides or shows all overlays, `Esc` deselects. While resizing, hold `Shift` to toggle the aspect lock and `Alt` to resize from the centre. While rotating, hold `Shift` to snap to 15°.

## Files

```
server.js            zero-dependency HTTPS-ready server (OWASP headers + OAuth /auth)
public/index.html    UI
public/css/app.css   styles (responsive: works in the narrow Zoom sidebar)
public/js/renderer.js  shape and text drawing engine, shared by the preview and the Zoom output
public/js/zoom.js    Zoom Apps SDK / Layers API camera-mode bridge
public/js/app.js     editor: layers, inspector, drag/resize/rotate, persistence
```
