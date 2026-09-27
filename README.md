# OmniBox-Spider

个人自用的 OmniBox 爬虫源集合（基于 [Silent1566/OmniBox-Spider](https://github.com/Silent1566/OmniBox-Spider) 改造）。

## 订阅地址

```
https://gh-proxy.org/https://github.com/MoraGG/OmniBox-Spider/raw/refs/heads/main/{目录}/{脚本名}.js
```

## 直播

| 脚本 | 说明 |
|---|---|
| [斗鱼直播.js](直播/斗鱼直播.js) | 斗鱼直播源；关注直播间通过环境变量 `DOUYU_FOLLOWED_ROOMS` 配置 |

### 斗鱼直播 - 环境变量配置

关注哪些直播间完全由环境变量控制，**不需要改脚本**。

| 环境变量 | 必填 | 说明 |
|---|---|---|
| `DOUYU_FOLLOWED_ROOMS` | 否 | 关注的斗鱼房间号，多个用英文/中文逗号、分号、空格或换行分隔。留空则回退到默认值 `3484:SCBOY`（改脚本里的 `DEFAULT_FOLLOWED_ROOMS` 即可） |
| `DOUYU_ROOMS` | 否 | `DOUYU_FOLLOWED_ROOMS` 的别名，优先级更低（只在未配置前者时生效） |
| `DOUYU_PLAY_VIA_PROXY` | 否 | 设为 `1` 时让播放走 OmniBox 内置代理（旧行为）。**默认不设**，见下方「为什么之前只能播 30 多秒」 |

**取值格式**

- 只写房间号：`3484,7546,660002`
- 带自定义显示名（推荐，避免每次都要请求拿主播名）：`房间号:名称` 或 `房间号=名称`，如 `3484:SCBOY,7546:Macsed`
- 混用也可以：`3484:SCBOY,7546,9999:YYF`

> 只保留纯数字房间号，非法项会被跳过并打 error 日志。

**配置示例（docker-compose.yml）**

```yaml
services:
  omnibox:
    image: lampon/omnibox:latest
    environment:
      - DOUYU_FOLLOWED_ROOMS=3484:SCBOY,7546:Macsed,9999
```

改完环境变量后重启容器即可生效：

```bash
docker compose up -d
```

**行为说明**

- 首页会把配置里的每个房间作为「关注直播间」列出，并实时标注 `🔴 直播中` / `⚫ 未开播`（开播判定用 `room.show_status === 1`，与斗鱼开放 API 的 `room_status` 一致）。
- 房间名优先取环境变量里的自定义名，其次主播昵称，最后直播间标题。
- 房间查询限并发 4，查询失败不会阻塞首页返回。

## 为什么之前只能播 30 多秒（v1.2.0 修复）

**根因不在斗鱼，也不在本脚本的解析逻辑，而在 OmniBox 内置的播放代理。**

调用链是：浏览器播放器（flv.js）→ OmniBox 后端 `/api/spider-source/proxy-play` → 斗鱼 CDN。

只要爬虫返回的 `play()` 结果里带 `header` 字段，OmniBox 前端就会把播放地址包装成
`/api/spider-source/proxy-play?url=...&headers=...` 再播出，以便由后端补上 Referer/UA。
而该代理对**单个请求有 30 秒硬超时**，到点即切断连接。HTTP-FLV 是一条长连接直播流，
必然在 30 秒被杀；前端 flv.js 又没有断流重连逻辑，于是缓冲播完就停 —— 表现为「播 30 多秒」。

实测证据（同一台机器）：

| 场景 | 结果 |
|---|---|
| 斗鱼 FLV 直链，经 OmniBox 代理 | 30.002s 断流 |
| 斗鱼 FLV 直链，经 OmniBox 代理（复测） | 30.001s 断流 |
| 本机自建慢速流，直连 | 45.0s 正常 |
| 本机自建慢速流，经 OmniBox 代理 | 30.0016s 断流（与斗鱼无关，证明是代理自身超时） |
| 斗鱼 FLV 直链，不经代理直连 | 连续 99.5s / 28.8MB 正常 |

**修复方式**：`play()` 默认不再返回 `header`。前端只有在 `header` 非空时才会走代理，
不返回时播放器直接使用该地址、flv.js 直连斗鱼 CDN。斗鱼 CDN 对播放地址返回
`Access-Control-Allow-Origin: *`（302 与最终节点都有），跨域可直接播放。

若某些环境直连异常，可设 `DOUYU_PLAY_VIA_PROXY=1` 回退到走代理（代价是仍会 30 秒断）。

> 备注：斗鱼播放地址带 `expire=300`（约 5 分钟有效期），长时间观看依赖播放器在出错时
> 重新调用爬虫接口取新地址。

## 版本

| 脚本 | 版本 | 变更 |
|---|---|---|
| 斗鱼直播.js | 1.2.0 | 修复「只能播 30 多秒」：默认不返回 `header`，绕开 OmniBox 代理的 30 秒硬超时；新增 `DOUYU_PLAY_VIA_PROXY` 回退开关 |
| 斗鱼直播.js | 1.1.0 | 新增 `DOUYU_FOLLOWED_ROOMS` 环境变量驱动关注直播间；修正开播判定字段与封面地址 |
