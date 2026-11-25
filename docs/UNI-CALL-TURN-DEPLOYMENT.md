# Uni Call · ngrok、STUN 与 coturn

HTTPS 页和 Socket.IO 信令继续通过现有 ngrok HTTP/S 入口。浏览器的 STUN/TURN 连接独立访问配置中的 RTC 域名。ngrok HTTP/S 隧道只处理 Web 和 WebSocket 流量，TURN 所需的监听与媒体中继端口由 RTC 主机提供。 [ngrok HTTP/S 文档](https://ngrok.com/docs/gateway/endpoints/http/#websockets)

## 配置 Uni

复制以下键到有访问控制的部署环境。示例域名为占位符，密钥从部署端的秘密管理器注入。

```dotenv
UNI_CALL_STUN_URLS=stun:rtc.example.com:3478
UNI_CALL_TURN_URLS=turn:rtc.example.com:3478?transport=udp,turn:rtc.example.com:3478?transport=tcp,turns:rtc.example.com:5349?transport=tcp
UNI_CALL_TURN_SECRET=
UNI_CALL_ICE_POLICY=all
```

- 空 URL 列表启用浏览器本地 ICE 候选。跨 NAT 验收需要正确配置 RTC 基础设施。
- TURN 密钥至少 32 字节，生产应使用高熵随机值并保护配置权限。同一值进入 coturn 的 secret 配置。密钥由 Node 使用，登录后且接听成功的参与端才收到各自临时用户名及派生凭据。有效期按 8 小时最长通话加 2 分钟设置，保证接续与刷新有余量。派生凭据可能在到期前继续使用，服务端终止通话不会撤销 coturn 已签发的凭据，需配合同用户配额、总配额和审计。
- 默认 `all` 尝试直连，必要时使用中继。独立试验环境可设 `relay` 强制中继。配置被拒绝时检查变量名与 URL 格式。测试通过后按部署计划滚动更换密钥，考虑在途通话。

## 准备 coturn

使用受维护的 coturn 软件包和独立的公网主机。设置 RTC 域名解析，提供受设备信任的 TLS 证书和自动续期。防火墙仅开放规划的客户端端口及中继范围，TLS 端口为 TCP 5349、普通客户端可使用 UDP/TCP 3478。企业网络需要经 TCP 443 时，可使用独立公网地址或主机提供 TURN TLS 443，先核对端口占用。即便客户端使用 TCP 或 TLS，典型 WebRTC 仍需要 TURN 到媒体对端的 UDP 中继能力。公网与私网地址映射时，配置 `external-ip=公网地址/对应内网地址` 并保持中继端口一一映射。 [coturn 官方配置](https://github.com/coturn/coturn/blob/master/examples/etc/turnserver.conf)

适用于独立 IPv4 公网主机的起点，按实际网卡、防火墙及容量调整。以下是部署操作手册，未应用到现有服务。

```ini
realm=rtc.example.com
listening-port=3478
tls-listening-port=5349
cert=/etc/turn/certs/fullchain.pem
pkey=/etc/turn/certs/privkey.pem

use-auth-secret
static-auth-secret=REPLACE_AT_DEPLOY_TIME

min-port=52000
max-port=52199
user-quota=8
total-quota=160
max-bps=64000
bps-capacity=8000000
no-cli
no-multicast-peers

denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
```

配额数值为示例。每用户和总分配配额结合预期多设备重试数评估，`max-bps` 与 `bps-capacity` 单位为字节/秒。建议由网络策略同时阻止访问管理网、云元数据、特殊用途地址和 RTC 主机敏感端口。未配置 IPv6 时不要在公共 DNS 和监听接口上开启 IPv6。部署 IPv6 时需加同等链路本地、回环、ULA、映射和管理网限制。限制进程权限，保护证书与静态密钥，检查异常分配量并设最短可用日志保留期。避免开放管理界面和无认证的 TURN。 [coturn 官方配置](https://github.com/coturn/coturn/blob/master/examples/etc/turnserver.conf)

## 连通性验收

1. 在独立 HTTPS 测试环境使用两个合成账号。分别从同一 Wi-Fi、另一条宽带、移动网络通话。双端分别讲话，静音后对端应听不到本端，解静音后恢复。
2. 在测试配置设 `UNI_CALL_ICE_POLICY=relay`，先只配置 UDP TURN，再分别只配置 TCP 和 TLS TURN。记录浏览器选中 pair 的本地或远端候选类型为 `relay`，同时验证双方 `inbound-rtp` 音频包数增长。仅产生 relay 候选不算接通。可以用浏览器 WebRTC 诊断页面或测试脚本读取统计，保存结果时移除地址、完整 SDP、用户名和凭据。
3. 在通话时从 Wi-Fi 切换至另一网络。验证 ICE 或信令恢复、重新登录提示和有上限的失败路径。拒绝使用撤销后的端点，确认不会在后台继续占用麦克风。
4. 错误密钥、过期凭据、损坏 TLS 证书和未授权分配应被拒绝。在非生产主机检查防火墙、证书续期和带宽配额。

本次没有可用的授权公网 coturn 服务。测试验收表将上述真实网络和 relay 路径保持为待验收。 [W3C WebRTC](https://www.w3.org/TR/webrtc/)
