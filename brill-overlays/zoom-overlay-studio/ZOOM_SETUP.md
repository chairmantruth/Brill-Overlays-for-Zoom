# Brill Overlays: Zoom Marketplace setup sheet

Follow these steps to publish **Brill Overlays** on your own Zoom account. It takes about 10–15 minutes.
Wherever you see `YOUR-URL`, use your app's public HTTPS address without a trailing slash, for example `https://brill-overlays.onrender.com`.

---

## Step 0: Put the app online over HTTPS (Zoom requires this)

Pick **one** option:

**A. Render (free, permanent URL, recommended)**
1. Push the `zoom-overlay-studio` folder to a GitHub repo.
2. Go to https://dashboard.render.com → **New → Blueprint** and pick the repo. Render reads `render.yaml` automatically.
3. When the deploy finishes, copy the URL (`https://brill-overlays-xxxx.onrender.com`). That's your `YOUR-URL`.

**B. ngrok (quick test from your own computer)**
```bash
cd zoom-overlay-studio
node server.js
ngrok http 3000          # use the https://….ngrok-free.app URL as YOUR-URL
```
The URL changes every time ngrok restarts unless you have a reserved domain. Each time it changes, update the Zoom settings below.

Check: open `YOUR-URL` in your browser. You should see the Brill Overlays editor.

---

## Step 1: Create the app

1. Go to **https://marketplace.zoom.us** and sign in with your Zoom account.
2. In the top-right, choose **Develop → Build App**.
3. Choose **General App** and click **Create**.
4. Click the pencil next to the auto-generated name and rename it to **Brill Overlays**.
5. **Select how the app is managed**: choose **User-managed**.

## Step 2: Basic Information

| Field | Value |
|---|---|
| App name | `Brill Overlays` |
| OAuth Redirect URL | `YOUR-URL/auth` |
| OAuth Allow List | `YOUR-URL` |

Copy the **Client ID** and **Client Secret** shown on this page. You'll need them in Step 6.

## Step 3: Features → Surface

1. Under **Select where to use your app**, tick **Meetings**.
2. Turn on **Zoom App**.
3. Fill in:

| Field | Value |
|---|---|
| Home URL | `YOUR-URL` |
| Domain Allow List | `YOUR-URL` host (e.g. `brill-overlays-xxxx.onrender.com`) **and** `appssdk.zoom.us` |

4. Under **In-client App Features**, open **Zoom App SDK → Add APIs** and add all of these:

```
runRenderingContext
closeRenderingContext
drawParticipant
clearParticipant
drawImage
clearImage
drawWebView
clearWebView
postMessage
onMessage
getRunningContext
getUserContext
getVideoState
onMyMediaChange
onRenderedAppOpened
```

5. If you see a **Layers API / Immersive / Camera Mode** toggle, turn it on.

## Step 4: Scopes

Add the scope Zoom suggests for Zoom Apps (usually `zoomapp:inmeeting`). No other scopes are needed.

## Step 5: Install it on your account

1. In the left menu, open **Local Test** (sometimes labelled **Test your app**).
2. Click **Add App Now**, then **Allow**.
3. Zoom redirects to `YOUR-URL/auth`. The app is now installed on your account.

## Step 6 (optional): Jump straight back into Zoom after install

Set these environment variables on your host (Render → **Environment**, or a `.env` file locally):

```
ZM_CLIENT_ID=<Client ID from Step 2>
ZM_CLIENT_SECRET=<Client Secret from Step 2>
ZM_REDIRECT_URL=YOUR-URL/auth
```

## Step 7: Use it

1. Open the Zoom desktop client (**version 5.13.1 or newer**) and start or join a meeting.
2. **Turn your camera on.**
3. Click **Apps** in the meeting toolbar, then **Brill Overlays**.
4. Design your name tag and images, then click **Go live in Zoom**. Everyone now sees the overlays on your video.

---

### Troubleshooting
- **The app doesn't load in Zoom:** check that the Home URL and Domain Allow List match `YOUR-URL` exactly and that it's HTTPS.
- **Go live does nothing:** check that the camera is on and that every API in Step 3 is added. After adding APIs, remove the app and reinstall it (Step 5).
- **The text looks backwards to you:** that's Zoom's self-view mirror. Other people see it the right way round.
