# Uni 5.6 Napa Valley — Release Candidate 1

## The Final Evolution of Sonoma

*See the crystal. Hear the connection.*

Napa Valley is the last major update of the Uni 5 Sonoma generation. It brings Liquid Crystal to the home screen and adds one-to-one voice conversations that stay with you as you move through Uni. Designed and developed by Hyperstack X.

## Liquid Crystal

A shared WebGL renderer samples the bundled Sonoma wallpaper for the three home destinations. Refraction follows the rounded edges, with restrained RGB separation and local luminance compensation to keep labels readable. Light and dark appearances, reduced transparency, and reduced motion adapt the presentation to the user’s settings.

## Uni Call

Start, answer, decline, cancel, or end a private voice call. Uni Call uses WebRTC for audio and Socket.IO for authenticated signaling, with microphone mute, supported input and output selection, network quality indicators, and bounded ICE recovery. The server writes call outcomes to private chat; the app releases media tracks when a call ends.

## Uni Call Island

A top-center capsule expands through a reversible 380ms transition. Call controls stay available when navigating to another view. Open the secondary audio settings to choose a device or adjust volume. The island uses CSS backdrop transmission and edge highlights, while the homepage uses the WebGL renderer described above.

## Refined Experience

The homepage and notification panel use a clearer separation of content and controls. The notifications interaction includes keyboard focus return and a scrollable reading area in short windows. Apple’s published design guidance informed these Web implementations.

## Engineering Validation

The [RC1 acceptance report](RELEASE-READINESS-5.6.0-rc.1.md) records the Node, Chromium, and startup checks performed against this candidate. Chromium exchanges actual bidirectional Opus media using synthetic microphones.

## Known Limitations

Full Safari UI and WebRTC acceptance, iPhone Safari/PWA, physical microphones and Bluetooth devices, cross-network calls, forced TURN relay, VoiceOver, and sustained power/GPU measurements remain pending. Web and PWA are the delivery scope. Android/Capacitor remains historical.

## Release Candidate Notice

Source version `5.6.0-rc.1` is a candidate for evaluation. The intended GitHub release type is **Pre-release**. The current publication status is **Blocked by Privacy Gate (U11)**. The public repository’s reachable history includes chat data whose publication authorization remains unresolved.

## 中文说明

Napa Valley 是 Uni 5 Sonoma 世代的最后一次重大更新。本候选版带来首页 Liquid Crystal 的 Sonoma 壁纸折射、Uni Call 双向语音和随页面切换保留的通话水晶岛。水晶岛采用 CSS 背景透射与边缘高光。实机及公网通话项目按验收报告继续保留，U11 隐私门禁阻止公开发布。
