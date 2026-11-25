# Uni Call · Socket.IO 信令

Uni Call 使用现有已认证 Socket.IO，不新增信令服务器或公共房间。客户端调用 `uni-call:<action>` 并提供 acknowledgement。成功为 `{ok:true,...}`，拒绝为 `{ok:false,code,error}`。所有只含当前设备状态的响应都走原 Socket。

## 状态转换

|服务端状态|进入条件|行动及离开条件|
|---|---|---|
|空闲|用户没有 busy 锁|有效 start 同时锁双方。离线或忙线直接形成结果。|
|ringing|双方通过授权检查且接收方至少一个端在线|客户端主叫显示 outgoing，接收端显示 incoming。30 秒超时保存 missed。主叫 end 保存 canceled，未选定接收端 decline 保存 declined。|
|connecting|第一台接收设备成功 accept|轮次从 1 开始。双方获取 ICE 配置，由主叫发 Offer，接听端回 Answer。双方确认连接后转 connected。|
|connected|本轮已有 Answer 且双方发出 connected|服务端开始计时，同一场通话的后续 ICE 重试不改变起点。最多 8 小时。|
|reconnecting|ICE 恢复或信令端暂时断开|每一轮最多 22 秒，最多 2 次 ICE Restart。信令暂停最长 18 秒，未恢复则结束。两端重新授权后创建新轮次。|
|ended|终止动作、超时、会话撤销、重试耗尽|清理定时器和 busy 锁。只写一条最终记录，重复终止无副作用。|

双方同时发起时，先获得账号锁者成为主叫。接听设备由 Socket.IO 服务端同步处理的首个有效 accept 决定。接收账号其余设备会收到 `answered-elsewhere`，只用于关闭界面，不写第二条历史。

## 客户端事件

|后缀|请求字段|服务端约束|
|---|---|---|
|start|`{targetId, requestId}`|目标须可进行私聊，双方未被封禁。相同设备重复使用同一 requestId 可拿到同一个响应，窗口 60 秒。|
|accept|`{id}`|当前响铃设备才能接听。赢家的重复 accept 返回状态。|
|decline|`{id}`|仍响铃且未绑定接听设备时可拒绝。|
|end|`{id}`|只允许当前绑定的参与端。已结束返回 expired，数据库无副作用。|
|sync|`{id}`|当前绑定参与端或响铃设备可获取最新状态。|
|resume|`{id,resumeKey}`|已重新登录的同一账号、原密码版本与对应恢复密钥。只在暂停宽限期内重新绑定 Socket。|
|ice-config|`{id,round}`|已接听且当前轮次的两个有效端点可获取 ICE 配置。|
|signal|`{id,round,kind,value}`|kind 为 offer、answer、ice。SDP 输入是字符串。ICE 为 RTCIceCandidateInit 或 null。服务端只转发给同轮次的另一端。|
|connected|`{id,round}`|本轮已收到 Answer 才接受。双端确认才建立服务端计时。|
|retry|`{id,round}`|绑定端请求有限 ICE Restart。旧轮次请求不会消耗新轮次预算。|

`uni-call:state` 含 `id, revision, state, round, direction, peer, deadline, serverTime, startedAt, reason, paused`。只有有效绑定端收到其自身 `resumeKey`。客户端丢弃过期版本，并在断开期间拒绝使用旧凭证发送。

`uni-call:signal` 含 `id, round, kind, value`。同一轮次仅接受一个有效 Offer 和 Answer，重复确认不会转发第二次。浏览器串行应用 SDP 与 ICE，Remote Description 尚未就绪时缓存最多 96 个 ICE 候选。协商轮次改变后丢弃旧缓存，以 SDP 的 ICE ufrag 对本端迟到候选做额外检查。

通话记录结果为 `completed`、`missed`、`declined`、`canceled`、`busy`、`failed`、`offline`。参与者、记录 ID、结果和时长均由服务端构造。终止事件不接受客户端指定此类字段。
