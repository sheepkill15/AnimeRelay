# Anime Relay

Anime Relay is a Windows tray app that records completed anime episodes on MyAnimeList. It accepts playback from a generic Chrome/Edge extension, Plex, and an experimental local-player detector.

## What works in this MVP

- Generic HTML5 video tracking across changing streaming sites
- A hard exclusion for YouTube, including embedded and short-link domains
- Anikoto player-message tracking using its explicit MAL and episode metadata
- Cross-frame metadata merging for embedded video players
- Browser-extension pairing with a durable local PIN and token
- Live paired/offline state updates in the desktop dashboard
- Client-only Plex for Windows tracking from its local playback log
- Detection of VLC, mpv, MPC-HC, and PotPlayer window titles
- MyAnimeList OAuth, token refresh, anime search, and list updates
- A show-first activity timeline that folds browser, Plex, and local observations together
- A persistent library with English and Japanese titles, MAL artwork, episode totals, and progress
- A remembered title-mapping inbox for uncertain matches
- Duplicate event protection and a rule that never lowers MAL progress
- Optional Discord Rich Presence for the anime watched in the last five minutes
- Optional Windows sign-in startup that opens silently in the system tray
- Encrypted-at-rest MAL secrets and pairing credentials using Electron `safeStorage` when available

Local-player completion is deliberately not inferred from a window title. The app detects the episode but leaves it at 0% until a real player-progress adapter is added.

## Run from source

Requirements: Windows, Node.js 22+, and pnpm.

```powershell
pnpm install
pnpm dev
```

Build an installer with:

```powershell
pnpm dist
```

The installer is written to the `release` folder.

During installation, the **Background startup** page can enable **Start Anime Relay with Windows (minimized)**. The same setting can be changed later under **Connections → Windows startup**. Automatic launches use the `--hidden` mode, so only the tray icon appears.

## Connect MyAnimeList

1. Sign in to MyAnimeList and open its API client configuration page.
2. Register a client using this redirect URL:

   `http://127.0.0.1:3210/oauth/mal/callback`

3. In Anime Relay, open **Connections**, enter the client ID and client secret, save, then choose **Connect MyAnimeList**.
4. Approve access in the browser. The app stores the resulting tokens using Windows-backed encryption when Electron reports it available.

## Load the browser extension

1. In Chrome, visit `chrome://extensions`. In Edge, visit `edge://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**, click **Open extension folder** in Anime Relay, and select that folder.
4. Open the Anime Relay extension and enter the six-digit pairing code shown under **Connections** in the desktop app.

The extension examines pages only when an HTML5 video of at least four minutes is playing. It sends the desktop app the detected title, episode, URL, player duration, and playback position. It does not send general browser history.

The packaged app keeps the extension in a stable folder outside the installer-managed program files. Its ID, pairing PIN, and paired token therefore survive app updates. After updating Anime Relay, click **Reload** for Anime Relay on the browser's Extensions page (or restart the browser), then refresh any already-open streaming tabs. You do not need to remove and reinstall the extension.

## Connect Plex

Enable Plex under **Connections**. Anime Relay tails the local log produced by Plex for Windows and reads only episode metadata and playback progress. It does not contact the Plex server directly and does not need the server URL, an `X-Plex-Token`, Plex Pass, or any setup by the server owner.

## Show Discord activity

Discord support is optional and off by default.

1. Open Discord's Developer Portal and create an application for Anime Relay.
2. Copy its **Application ID** from **General Information**.
3. In Anime Relay, open **Connections**, enable **Discord activity**, paste the ID, and save.
4. Keep the Discord desktop client running.

Anime Relay then shows the current English or canonical title, episode, watch percentage, remaining time, and MAL artwork. The activity clears after two minutes without a playback-progress update. It does not ask for your Discord token or account password.

## Safety behavior

- An episode updates MAL only after the configured threshold, initially 85%.
- If MAL is already at the same or a later episode, Anime Relay does nothing.
- Matches below 82% confidence wait for confirmation.
- Once confirmed, the title mapping is remembered locally.
- Browser progress updates for the same episode are folded into one event.

## Known MVP boundaries

- DRM services or players that do not expose an HTML5 video element need a small site adapter.
- Some sites expose weak page titles. Confirming the first episode teaches Anime Relay the mapping for later episodes.
- Plex integration currently supports the installed Plex for Windows desktop client. Plex Web is handled by the browser extension when its HTML5 player is visible to the page.
- Local automatic completion needs player-specific integration such as mpv IPC or VLC's HTTP interface.
- Discord activity requires a user-created Discord Application ID and the desktop client; no Discord account authorization is performed by Anime Relay.
- The unpacked extension lives in a durable folder. Load it from that folder once; subsequent releases only need **Reload**, not reinstalling.
