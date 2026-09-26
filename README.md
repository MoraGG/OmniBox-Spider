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

## 版本

| 脚本 | 版本 | 变更 |
|---|---|---|
| 斗鱼直播.js | 1.1.0 | 新增 `DOUYU_FOLLOWED_ROOMS` 环境变量驱动关注直播间；修正开播判定字段与封面地址 |
