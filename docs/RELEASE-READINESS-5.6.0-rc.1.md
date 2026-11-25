# Uni 5.6 Napa Valley Release Candidate 1 · Engineering Acceptance

- **Version** `5.6.0-rc.1`
- **Candidate branch** `release/5.6-napa-valley-rc1`
- **Publication status** Blocked by Privacy Gate (U11)

## Candidate scope

- The baseline was `design/napa-valley-optical-prototype @ b8c177c255a8d955419d12e9994dd2c60b91d31d`. Existing work was carried onto the candidate branch with the saved redesign stash intact.
- The package, lockfile root, page title, Web App Manifest, and admin maintenance display identify the candidate. The Sonoma generation label and the PWA short name `Uni` are preserved. The dependency tree and Node engine requirements match the baseline.
- Liquid Crystal uses WebGL to sample the Sonoma wallpaper on the home cards. Uni Call Island uses CSS backdrop transmission and edge treatments. Napa Fidelity covers home material hierarchy, notification transitions and focus, and compact layouts. See the [changelog](CHANGELOG-5.6.0-rc.1.md) and [release notes](RELEASE-NOTES-5.6.0-rc.1.md).

## Regression results

| Check | Result | Coverage |
|---|---:|---|
| `npm test` | 50/50 passed | Registration, login, permissions, private chat, forum, data integrity, notification state, and Uni Call signaling and lifecycle |
| `node test/browser/uni-call.cjs` | 14/14 passed | Two authenticated browser peers, bidirectional Opus transmission using synthetic microphones, device and mute controls, ICE recovery, responsive Island motion, navigation continuity, media release and saved call records |
| `node test/browser/napa-fidelity.cjs` with the isolated Napa preview and comparison snapshot | 15/15 passed | Light and dark home, 390/768 px layouts, notification state and focus, reduced transparency and motion, WebGL wallpaper displacement, and bounded redraw checks |
| JavaScript syntax | Passed | 22 changed or added JS/CJS files and both inline scripts in the app HTML |
| Isolated startup and version smoke check | Passed | Temporary server bound to loopback, successful admin sign-in, dashboard reported `5.6.0-rc.1` |
| HTTP revalidation | Passed | HTML, manifest and nine referenced CSS/JS resources returned 200 with ETag and `max-age=0`. Conditional requests returned 304 |

Node checks ran on **v24.19.0** with npm **11.17.0**. This is below the project’s configured Node 24 floor of **v24.22.1**. Repeat startup and regression checks on a supported deployment runtime before production acceptance. Browser checks used Chromium via Microsoft Edge **158.0.4370.33**. Both browser suites reported zero uncaught page errors. Tests used isolated fixtures without production databases, uploads, credentials, or audio.

The Web/PWA source has no service-worker registration. The local server revalidates the tested static resources through HTTP. Deployed proxy or CDN cache rules and updates to installed PWA instances remain to be checked.

## Privacy gate and publication

The public GitHub repository’s `main` pointed to `5cf204bf9725a471377726218a9f947557046654` at preflight. Its reachable history includes `chat-history.json`, introduced in `92d66aa9e5f84d72f2a45a9660c470de34c07bd6`. The subsequent removal in `7fa6d9cc28aa1270a115683c6a1630ccdcc83389` leaves the earlier object reachable. The [5.5.9 privacy review](RELEASE-READINESS-5.5.9.md#u11--p1-高优先级隐私风险未关闭) recorded 287 messages and 10 image entries. Their authorization for public release remains unresolved. Historical source also contains a former administrator password fallback. Review where it was ever used and rotate any reused credential through the authorized owner.

The candidate file allowlist excludes runtime data, secret configuration, logs and visual output. Screened history and staged files for known private paths and common credential or embedded-media patterns. This review is bounded by those checks and leaves U11 open.

Local candidate preparation and a reviewed local commit are permitted. Branch push, annotated tag `v5.6.0-rc.1`, GitHub Pre-release and production deployment are withheld. The repository owner must authorize and verify a remediation path before public delivery. Options include independently reviewed clean publication history, restricted access, or a separately authorized history cleanup. Existing third-party copies may persist.

## Outstanding acceptance

- Safari interaction and WebRTC, including iPhone Safari and installed PWA.
- Physical microphones, Bluetooth audio routing, and VoiceOver.
- Calls across independent public networks and forced TURN relaying.
- Sustained power and GPU measurements on representative hardware.
- Clean startup and regression execution on the configured Node runtime, plus verification of deployed cache behavior.
