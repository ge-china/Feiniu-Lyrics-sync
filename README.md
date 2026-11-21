# 飞牛歌词同步

**给飞牛 fnOS 音乐库自动补全歌词的 NAS 应用。**

扫描你的音乐目录，找出没有歌词的歌曲，从多个公开歌词源匹配带时间轴的 LRC，写到歌曲旁边或写进音频标签里。

**国内镜像**：[Gitee · 飞牛歌词同步](https://gitee.com/ge-china/feiniu-lyrics-sync)（GitHub 访问慢时用这个）

<p>
  <img alt="fnOS" src="https://img.shields.io/badge/fnOS-1.1%2B-4C8DFF">
  <img alt="Node" src="https://img.shields.io/badge/Node.js-22-339933">
  <img alt="License" src="https://img.shields.io/badge/License-MIT-blue">
  <img alt="Version" src="https://img.shields.io/badge/version-0.4.0-success">
</p>

---

## 为什么做这个

在 NAS 上下载的音乐，音频文件齐了，歌词却经常是空的。手动一首首找歌词、改名、放进文件夹——几百首歌能干一下午。

这个应用把这件事变成一次点击：扫一遍曲库，缺歌词的自动补齐，拿不准的列出来让你挑。

## 功能

- **曲库扫描** — 递归扫描音乐目录，读取标签与时长，识别已有歌词（`.lrc` / `.LRC` / 双扩展名 / 内嵌标签）
- **多源匹配** — LRCLIB、网易云、QQ 音乐、酷狗并行检索，按「歌名 + 歌手 + 时长」综合打分
- **检索阶梯** — 歌名+歌手 → 去括号 → 繁简转换 → 专辑 → 去副标题 → 仅歌名 → 文件名，逐级降级，命中即停
- **人工选版** — 全自动 / 多版本时询问 / 全部人工，三种模式；待确认列表里挑版本，选择会被记住
- **两种写入** — 独立 `.lrc` 文件（可逆、通用）或音频内嵌标签（FLAC / MP3 / M4A）
- **封面补全** — 搜索并写入专辑封面（网易云 / QQ / 酷狗），支持独立图片或内嵌
- **删除歌词** — 勾选批量删除，可选删文件或清标签
- **自定义源** — 往数据目录放一个 `.js` 就能接入自己的歌词源

## 下载

| 来源 | 链接 |
|---|---|
| GitHub 直链（v0.5.0） | [feiniu-lyrics-sync-0.5.0.fpk](https://raw.githubusercontent.com/ge-china/Feiniu-Lyrics-sync/dist/feiniu-lyrics-sync-0.5.0.fpk) |
| Gitee 直链（v0.5.0，国内快） | [飞牛歌词同步-0.5.0.fpk](https://gitee.com/ge-china/feiniu-lyrics-sync/raw/dist/dist-feiniu-lyrics-sync-0.5.0.fpk) |
| GitHub 发行说明 | [Releases](https://github.com/ge-china/Feiniu-Lyrics-sync/releases) |
| Gitee 发行说明 | [发行版](https://gitee.com/ge-china/feiniu-lyrics-sync/releases) |

## 安装

1. 从 [Releases](../../releases) 下载 `飞牛歌词同步-x.y.z.fpk`
2. 飞牛 NAS → 应用中心 → 手动安装 → 选择该文件
3. 首次安装会自动安装依赖应用 `nodejs_v22`

### ⚠️ 安装后必须授权目录

应用以独立的包用户身份运行，**没有用户文件权限**。不授权的话只能扫描、写不进去：

> 应用中心 → 飞牛歌词同步 → 设置 → 授权目录 → 添加音乐文件夹

## 使用

1. 打开「飞牛歌词同步」
2. 填音乐目录（也可点「授权目录」自动读取已授权路径）
3. 点「扫描曲库」
4. 点「自动补全（缺歌词）」
5. 有歧义的歌进「待确认」，挑一个版本点「写入这个」

第一次建议把下载模式设为**「多版本时询问」**，跑一批看看匹配质量，稳定后再改「全自动」。

## 工作原理

```
扫描 ──▶ 识别缺失 ──▶ 检索阶梯 ──▶ 打分排序 ──▶ 取歌词 ──▶ 写盘 ──▶ 记录状态
                        │
                        ├─ 快源并行：网易云 / QQ / 酷狗
                        └─ 慢源兜底：LRCLIB（结果不够好时才问）
```

**采纳门槛**：分数 ≥ 55 **且** 时长差 ≤ 5 秒。宁可空着，也不写错版本。

## 技术栈

- **运行时**：Node.js 22（fnOS 依赖应用 `nodejs_v22`）
- **后端**：原生 Node HTTP 服务，无框架
- **前端**：原生 JS 单页，无构建步骤
- **标签处理**：`music-metadata`（读）+ `node-taglib-sharp`（写）
- **繁简转换**：`opencc-js`
- **打包**：fnOS `.fpk`（gzip tar，生命周期脚本 + 统一网关入口）

### 目录结构

```
源代码/
├── src/               后端
│   ├── server.js        HTTP 服务、API、网关前缀路由
│   ├── scanner.js       扫描、标签读取、歌词检测、写权限探测
│   ├── searchplan.js    L1~L7 检索阶梯
│   ├── match.js         候选打分
│   ├── sources/         lrclib / netease / qq / kugou / kuwo
│   ├── writer.js        .lrc 写入
│   ├── tagwriter.js     内嵌标签写入
│   ├── queue.js         待确认队列、选择记忆
│   └── fnas.js          fnOS 授权目录查询
├── web/                单页界面
├── fpk/                .fpk 打包源
└── testlib/            测试音频（不入库）
```

## 开发

```bash
cd 源代码
npm install
npm start          # http://localhost:8791
```

打包：

```bash
node 工具/mkfpk.mjs 源代码/fpk 安装包/飞牛歌词同步-x.y.z.fpk
```

> **踩坑提醒**：Windows 版 fnpack 打出的 `cmd/*` 权限是 0666，fnOS 会拒绝执行；`.fpk` 还必须是 gzip 压缩。`mkfpk.mjs` 两件事都替你处理了。

## 常见问题

<details>
<summary>扫描到歌了，但一首都没写进去？</summary>

多半是没授权目录。没写权限时页面顶部会有黄色提示条。去「应用设置 → 授权目录」加上音乐文件夹，重新扫描。
</details>

<details>
<summary>为什么有的歌没匹配到？</summary>

默认要求分数 ≥ 55 且时长差 ≤ 5 秒，宁可空着也不写错。可以调低「最低匹配分」，或用「手动搜索」自己挑。
</details>

<details>
<summary>会覆盖我原来的歌词吗？</summary>

默认「保留已有歌词」，不勾掉就不会覆盖。
</details>

<details>
<summary>会改坏音乐文件吗？</summary>

写 `.lrc` 只新增文本文件，不碰音频。写内嵌标签会重写文件标签区（音轨数据不变），建议开启「改标签前备份音频」。
</details>

## 免责声明

歌词内容来自第三方公开接口，**版权归原作者与词作者所有**。本项目仅用于个人本地补全，不缓存、不分发、不提供歌词下载服务。请勿用于商业用途。

## License

[MIT](LICENSE)
