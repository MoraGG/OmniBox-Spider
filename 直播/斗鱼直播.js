// @name 斗鱼直播
// @author 
// @description 关注直播间由环境变量 DOUYU_FOLLOWED_ROOMS 配置（逗号分隔房间号，可写 房间号:备注名）
// @dependencies: axios, crypto-js
// @version 1.2.0
// @downloadURL https://gh-proxy.org/https://github.com/MoraGG/OmniBox-Spider/raw/refs/heads/main/直播/斗鱼直播.js

/**
 * ============================================================================
 * 斗鱼直播 - OmniBox 爬虫脚本
 * ============================================================================
 * v1.1.0：新增环境变量 DOUYU_FOLLOWED_ROOMS，用房间号配置首页「关注直播间」
 *   - 例：DOUYU_FOLLOWED_ROOMS=3484,7546,660002
 *   - 支持备注名：DOUYU_FOLLOWED_ROOMS=3484:SCBOY,7546:Macsed
 *   - 不配置时回退到 DEFAULT_FOLLOWED_ROOMS
 *
 * v1.2.0：修复「直播只能播 30 多秒就停」
 *   - 原因：play() 返回了 header，OmniBox 前端会据此把播放地址包装成
 *     /api/spider-source/proxy-play?url=...，而后端代理对单个请求有 30 秒硬超时，
 *     到点即切断 HTTP-FLV 长连接（实测 30.00s 精确复现），前端 flv.js 又无自动重连。
 *   - 修复：默认不再返回 header，让播放器直连 CDN（斗鱼 CDN 已开启
 *     Access-Control-Allow-Origin: *，跨域可直接播）；需要走代理时设
 *     DOUYU_PLAY_VIA_PROXY=1 回退旧行为。
 * ============================================================================
 */
const axios = require("axios");
const CryptoJS = require("crypto-js");
const OmniBox = require("omnibox_sdk");

// ========== 全局配置 ==========
const host = "https://m.douyu.com";
const did = "10000000000000000000000000001501";

const def_headers = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1'
};

// ========== 分类映射 ==========
const categories = {
  'yqk': '娱乐天地',
  'LOL': '网游竞技',
  'TVgame': '单机热游',
  'wzry': '手游休闲',
  'yz': '颜值',
  'smkj': '科技文化',
  'yiqiwan': '语音互动',
  'yyzs': '语音直播',
  'znl': '正能量'
};

// ========== 日志工具 ==========
const logInfo = (message, data = null) => {
  const output = data ? `${message}: ${JSON.stringify(data)}` : message;
  OmniBox.log("info", `[DOUYU-DEBUG] ${output}`);
};

const logError = (message, error) => {
  OmniBox.log("error", `[DOUYU-DEBUG] ${message}: ${error.message || error}`);
};

// ========== 关注直播间（环境变量配置） ==========
// 优先环境变量 DOUYU_FOLLOWED_ROOMS / DOUYU_ROOMS，未配置时回退到下面的默认值
const FOLLOWED_ROOMS_ENV_KEYS = ["DOUYU_FOLLOWED_ROOMS", "DOUYU_ROOMS"];
const DEFAULT_FOLLOWED_ROOMS = "3484:SCBOY";

/**
 * 解析关注房间字符串
 * 支持格式：3484,7546 / 3484:SCBOY / 3484=SCBOY / 3484 SCBOY(换行、分号均可)
 * 只保留纯数字房间号，避免脏配置导致请求异常
 */
function parseFollowedRooms(raw) {
  if (!raw) return [];
  const list = [];
  const seen = {};
  String(raw)
    .split(/[,，;；\r\n\t ]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .forEach(item => {
      const parts = item.split(/[:=]/);
      const rid = (parts[0] || "").trim();
      const name = (parts[1] || "").trim();
      if (!/^\d+$/.test(rid)) {
        OmniBox.log("error", `[DOUYU-DEBUG] 忽略非法房间号配置: ${item}`);
        return;
      }
      if (seen[rid]) return;
      seen[rid] = true;
      list.push({ rid, name });
    });
  return list;
}

/**
 * 读取环境变量中的关注房间列表
 */
function getFollowedRoomsFromEnv() {
  let raw = "";
  let fromKey = "";
  for (const key of FOLLOWED_ROOMS_ENV_KEYS) {
    const val = process.env[key];
    if (val && String(val).trim()) {
      raw = String(val).trim();
      fromKey = key;
      break;
    }
  }
  if (!raw) {
    OmniBox.log("info", `[DOUYU-DEBUG] 未配置 ${FOLLOWED_ROOMS_ENV_KEYS.join(" / ")}，使用默认关注房间`);
    raw = DEFAULT_FOLLOWED_ROOMS;
    fromKey = "DEFAULT";
  }
  const rooms = parseFollowedRooms(raw);
  OmniBox.log("info", `[DOUYU-DEBUG] 关注房间配置来源=${fromKey}, 解析出 ${rooms.length} 个: ${rooms.map(r => r.rid).join(",")}`);
  return rooms;
}

/**
 * 查询单个直播间状态（是否在播 + 直播间信息）
 * 注意：betard 的 room.status 恒为字符串 '1'，不是开播标志；
 *       真正开播标志是 room.show_status === 1（2=未开播）。
 */
async function fetchRoomStatus(rid) {
  const result = { rid, isLive: false, roomName: "", nickname: "", roomPic: "" };
  try {
    const resp = await req(`https://www.douyu.com/betard/${rid}`);
    const data = JSON.parse(resp.content);
    const room = data.room || {};
    const showStatus = parseInt(room.show_status);
    const endTime = parseInt(room.end_time) || 0;
    const now = Math.floor(Date.now() / 1000);
    if (!isNaN(showStatus)) {
      result.isLive = showStatus === 1;
    } else {
      result.isLive = endTime > now;
    }
    result.roomName = room.room_name || "";
    result.nickname = room.nickname || room.owner_name || "";
    result.roomPic = room.room_pic
      || (room.avatar && (room.avatar.big || room.avatar.middle || room.avatar.small))
      || room.avatar_mid || "";
    logInfo(`房间 ${rid} 状态`, { showStatus, endTime, isLive: result.isLive, roomName: result.roomName, nickname: result.nickname });
  } catch (e) {
    logError(`查询房间 ${rid} 状态失败`, e);
  }
  return result;
}

/**
 * 构建首页「关注直播间」列表（限并发，避免被风控）
 */
async function buildFollowedList(rooms, concurrency = 4) {
  const list = [];
  for (let i = 0; i < rooms.length; i += concurrency) {
    const batch = rooms.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(r => fetchRoomStatus(r.rid)));
    results.forEach((st, idx) => {
      const conf = batch[idx];
      const displayName = conf.name || st.nickname || st.roomName || `直播间${st.rid}`;
      list.push({
        "vod_id": st.rid,
        "vod_name": displayName,
        "vod_pic": st.roomPic || `https://apic.douyucdn.com/upload/${st.rid}/live.jpg`,
        "vod_remarks": st.isLive ? '🔴 直播中' : '⚫ 未开播',
        "style": { "type": "rect", "ratio": 1.33 }
      });
    });
  }
  return list;
}

/**
 * 核心:解析播放源字符串为结构化数组 [1]
 */
const parsePlaySources = (fromStr, urlStr) => {
  logInfo("开始解析播放源字符串", { from: fromStr, url: urlStr });
  const playSources = [];
  if (!fromStr || !urlStr) return playSources;

  const froms = fromStr.split('$$$');
  const urls = urlStr.split('$$$');

  for (let i = 0; i < froms.length; i++) {
    const sourceName = froms[i] || `线路${i + 1}`;
    const sourceItems = urls[i] ? urls[i].split('#') : [];

    const episodes = sourceItems.map(item => {
      const parts = item.split('$');
      return {
        name: parts[0] || '正片',
        playId: parts[1] || parts[0]
      };
    }).filter(e => e.playId);

    if (episodes.length > 0) {
      playSources.push({
        name: sourceName,
        episodes: episodes
      });
    }
  }
  logInfo("播放源解析结果", playSources);
  return playSources;
};

/**
 * 通用请求函数
 */
async function req(url, options = {}) {
  try {
    const response = await axios({
      url: url,
      method: options.method || 'GET',
      headers: options.headers || def_headers,
      data: options.body || null,
      timeout: options.timeout || 15000,
    });
    return {
      content: typeof response.data === 'object' ? JSON.stringify(response.data) : response.data
    };
  } catch (error) {
    logError(`请求失败 URL: ${url}`, error);
    return { content: "{}" };
  }
}

// ========== 接口实现 ==========

async function home(params) {
  logInfo("进入斗鱼直播首页");

  let classes = Object.keys(categories).map(key => ({
    'type_id': key,
    'type_name': categories[key]
  }));

  // 关注直播间：从环境变量读取房间号，并实时判断是否在播
  let followedList = [];
  try {
    const followedRooms = getFollowedRoomsFromEnv();
    followedList = await buildFollowedList(followedRooms);
    logInfo(`关注直播间列表构建完成，共 ${followedList.length} 个`);
  } catch (e) {
    logError("获取关注列表失败", e);
  }

  return {
    class: classes,
    list: followedList
  };
}

async function category(params) {
  const { categoryId, page } = params;
  const pg = parseInt(page) || 1;
  logInfo(`请求斗鱼分类: ${categoryId}, 页码: ${pg}`);
  
  try {
    const url = `${host}/api/room/list?page=${pg}&type=${categoryId}`;
    const resp = await req(url);
    const json = JSON.parse(resp.content);
    
    logInfo("分类接口返回数据", json);
    
    let list = (json.data.list || []).map(item => ({
      "vod_id": item.rid.toString(),
      "vod_name": item.roomName,
      "vod_pic": item.roomSrc,
      "vod_remarks": `🔥${item.hn} | ${item.nickname}`,
      "style": { "type": "rect", "ratio": 1.33 }
    }));
    
    return {
      list: list,
      page: pg,
      pagecount: 99
    };
  } catch (e) {
    logError("分类请求失败", e);
    return { list: [], page: pg, pagecount: 0 };
  }
}

async function search(params) {
  const wd = params.keyword || params.wd || "";
  const pg = parseInt(params.page) || 1;
  logInfo(`搜索斗鱼关键词: ${wd}, 页码: ${pg}`);
  
  try {
    const offset = (pg - 1) * 20;
    const url = `${host}/api/search/liveRoom?sk=${encodeURIComponent(wd)}&offset=${offset}&limit=20&did=${did}`;
    const resp = await req(url);
    const json = JSON.parse(resp.content);
    
    logInfo("搜索接口返回数据", json);
    
    let list = (json.data.list || []).map(item => ({
      "vod_id": item.rid.toString(),
      "vod_name": item.roomName,
      "vod_pic": item.roomSrc,
      "vod_remarks": item.nickname
    }));
    
    return {
      list: list,
      page: pg,
      pagecount: 10
    };
  } catch (e) {
    logError("搜索失败", e);
    return { list: [], page: pg, pagecount: 0 };
  }
}

async function detail(params) {
  const videoId = params.videoId;
  logInfo(`请求斗鱼直播间详情 ID: ${videoId}`);
  
  try {
    // ✅ 关键修正：使用 parsePlaySources 解析播放源 [1]
    const playSources = parsePlaySources("Douyu", `点击播放$${videoId}`);
    
    return {
      list: [{
        "vod_id": videoId,
        "vod_name": "直播间: " + videoId,
        "vod_play_sources": playSources,  // ✅ 必须返回此格式 [1]
        "vod_content": "斗鱼直播间"
      }]
    };
  } catch (e) {
    logError("详情获取失败", e);
    return { list: [] };
  }
}

async function play(params) {
  const playId = params.playId;
  logInfo(`准备播放斗鱼直播间 ID: ${playId}`);
  
  try {
    const tt = Math.floor(Date.now() / 1000);
    
    // A. 获取动态加密脚本参数
    const encUrl = `https://www.douyu.com/wgapi/livenc/liveweb/websec/getEncryption?did=${did}`;
    const encResp = await req(encUrl, { 
      headers: { 
        'Referer': `https://www.douyu.com/${playId}`,
        'User-Agent': def_headers['User-Agent']
      } 
    });
    const encData = JSON.parse(encResp.content);
    
    logInfo("加密参数获取结果", encData);
    
    if (!encData || encData.error !== 0) {
      logError("获取加密参数失败", new Error("encData error"));
      return { 
        urls: [],
        parse: 0,
        header: def_headers
      };
    }
    
    const sec = encData.data;
    
    // B. 实现斗鱼 MD5 签名逻辑 [2]
    let current = sec.rand_str;
    for (let i = 0; i < sec.enc_time; i++) {
      current = CryptoJS.MD5(current + sec.key).toString();
    }
    const auth = CryptoJS.MD5(current + sec.key + playId + tt).toString();
    
    logInfo("签名计算完成", { auth });
    
    // C. 请求真实 H5 流地址
    const streamUrl = `https://www.douyu.com/lapi/live/getH5PlayV1/${playId}`;
    const postData = `v=22032021&did=${did}&tt=${tt}&auth=${auth}&enc_data=${sec.enc_data}`;
    
    const streamResp = await req(streamUrl, {
      method: 'POST',
      body: postData,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': `https://www.douyu.com/${playId}`,
        'User-Agent': def_headers['User-Agent']
      }
    });
    
    const streamData = JSON.parse(streamResp.content);
    logInfo("流地址获取结果", streamData);
    
    if (!streamData || streamData.error !== 0) {
      logError("获取流地址失败", new Error("streamData error"));
      return { 
        urls: [],
        parse: 0,
        header: def_headers
      };
    }
    
    const final_url = `${streamData.data.rtmp_url}/${streamData.data.rtmp_live}`;
    logInfo(`最终播放地址: ${final_url}`);

    // ========== 播放方式（环境变量控制）==========
    // 默认：不返回 header —— OmniBox 前端只有在 header 非空时才会把地址包装成
    //        /api/spider-source/proxy-play?url=...，而后端代理对单个请求有 30 秒硬超时，
    //        HTTP-FLV 是长连接直播流，必然在 30 秒被切断（实测 30.0014/30.0020/30.0016s）。
    //        不返回 header 时前端直接使用该地址，flv.js 直连斗鱼 CDN；
    //        斗鱼 CDN 已返回 Access-Control-Allow-Origin: *，跨域可直接播放。
    // 回退：DOUYU_PLAY_VIA_PROXY=1 时保留旧行为（带 header 走 OmniBox 代理，会 30 秒断流）。
    const viaProxy = /^(1|true|yes|on)$/i.test(String(process.env.DOUYU_PLAY_VIA_PROXY || "").trim());
    const result = {
      urls: [{ name: "斗鱼直播", url: final_url }],
      parse: 0
    };
    if (viaProxy) {
      result.header = {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://www.douyu.com/'
      };
      logInfo("播放方式：经 OmniBox 代理（DOUYU_PLAY_VIA_PROXY=1，注意 30 秒断流限制）");
    } else {
      logInfo("播放方式：直连斗鱼 CDN（不返回 header，绕过 OmniBox 代理 30 秒超时）");
    }
    return result;
  } catch (e) {
    logError("播放地址解析失败", e);
    return { 
      urls: [],
      parse: 0,
      header: def_headers
    };
  }
}

module.exports = { home, category, search, detail, play };

const runner = require("spider_runner");
runner.run(module.exports);
