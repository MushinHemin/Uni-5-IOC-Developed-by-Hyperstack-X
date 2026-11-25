# Changelog · Uni 5.6 Napa Valley Release Candidate 1

**Version** `5.6.0-rc.1`

**Previous source baseline** Sonoma 5.5.9, commit `b8c177c`

## Added

- Liquid Crystal home cards with WebGL sampling of the bundled Sonoma wallpaper, rounded-edge refraction, RGB channel separation, and local luminance compensation.
- Uni Call with one-to-one WebRTC voice, Opus negotiation, invitations, mute and device controls, network quality estimates, bounded ICE recovery, and server-authored private-chat outcomes.
- Uni Call Island with one persistent top-center control, reversible expansion, audio settings, device disclosure, and real speech activity and approximate RTT indicators.
- Local synthetic previews and focused browser tests for Liquid Crystal, the Fidelity interaction pilot, and Uni Call.

## Refined

- Home material hierarchy and notification placement, motion, keyboard isolation, and focus return, informed by Apple’s published design guidance.
- Crystal Island CSS backdrop transmission, directional edge highlights, translucent phone buttons, and more compact audio controls.
- Light and dark appearances, dock clearance at narrow widths, short landscape scrolling, reduced transparency, and reduced motion.
- Version strings in package metadata, the browser title, the manifest, and the README. Dependencies and database schema retain their existing versions and structure.

The homepage refracts a known wallpaper texture. Uni Call Island uses CSS backdrop transmission and edge highlights. See the [optical refinement report](UNI-CALL-OPTICAL-REFINEMENT.md) for the test and technology boundary.

The [release notes](RELEASE-NOTES-5.6.0-rc.1.md) and [acceptance report](RELEASE-READINESS-5.6.0-rc.1.md) describe the candidate, verified environments, and publication gate. The [5.5.9 changelog](CHANGELOG-5.5.9.md) retains the earlier maintenance history.
