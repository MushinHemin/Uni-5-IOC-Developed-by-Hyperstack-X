# Uni for macOS · Security

## Trust and isolation

- The local settings surface runs at `uni-shell://app/src/shell.html` with a CSP and four allowlisted static resources. Its preload exposes only connection and preference operations. The configured web client runs in a separate sandboxed WebContentsView with Node integration disabled, context isolation enabled, standard Web security, mixed content disabled, no webviews, and DevTools disabled.
- The user chooses the trusted Uni origin, including scheme and port. Production requires HTTPS with normal platform certificate validation. A loopback development connection requires explicit IPv4 `127.0.0.1` and a port. The view admits only the root Uni entry documents from the configured origin. Navigation redirects, frame navigation and native popup creation are filtered.
- The remote preload provides four bounded methods for a saved login, clearing it, the unread badge and typed notifications. Main validates the active view, top frame, exact origin and payload on every message. External links use a separate isolated-preload path that requires a real DOM click in the visible app view and an HTTP(S) URL without credentials. Arbitrary `window.open` is denied.
- Both Electron permission handlers enforce the active remote view and main frame. Audio input requires a recent trusted click on an existing call or voice-message action and macOS microphone consent. The speaker chooser has its own trusted gesture. Camera, display capture and other permissions default to denied. Changing servers destroys the old view and its audio gesture state.
- Each origin has a different persistent Chromium partition. Switching origins clears the old encrypted login. Cookies and cache remain confined to their original partition. The RC1 server’s API tokens are socket-bound. The optional remembered login encrypts the submitted credential using Electron safeStorage, then requests a new server session after restart or transport recovery. Logout or a refused automatic login forgets the saved credential.
- Native notifications consume the server’s unified notification event, which already applies Uni preferences, plus Uni Call’s incoming state. A bounded deduplication set uses the server IDs and notification update timestamps. The app hides titles, senders and body text by default. Notification clicks are mapped to fixed app operations, never to an arbitrary URL.
- The signed ASAR contains the desktop sources and brand SVG. Packaged fuses disable RunAsNode, NODE_OPTIONS and Node CLI inspection, require the application ASAR and validate its integrity. No test harness or fixture data enters the bundle.

## Residual risk and rollout

The configured server supplies the executable Web UI. An administrator should select a Uni server they trust and keep that deployment patched. The Electron isolation reduces OS exposure if a page is compromised. Code executing in that origin retains access to the Uni web session. Sensitive browser data remains scoped under Uni’s local application profile. Use the settings entry to clear remembered credentials, especially on shared Macs.

Local Ad-hoc signing supports this build verification. Developer ID signing and notarization require an authorized identity. Keep live credentials, server data and desktop profiles out of source and release assets.

References

[Electron 45.5.0 security guide](https://github.com/electron/electron/blob/v45.5.0/docs/tutorial/security.md) · [Session permission handlers](https://www.electronjs.org/docs/latest/api/session#setpermissioncheckhandlerhandler) · [safeStorage on macOS](https://www.electronjs.org/docs/latest/api/safe-storage) · [Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses) · [electron-builder DMG options](https://www.electron.build/dmg.html)
