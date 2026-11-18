# 飞牛歌词同步（musicTB）

为 [飞牛 fnOS](https://www.fnnas.com/) 音乐库自动补全歌词的应用。扫描音乐目录，找出没有歌词的歌曲，从多个公开歌词源匹配并写入。

![fnOS](https://img.shields.io/badge/fnOS-1.1%2B-blue) ![Node](https://img.shields.io/badge/Node-22-green) ![License](https://img.shields.io/badge/License-MIT-lightgrey)

## 功能

- **曲库扫描**：递归扫描音乐目录，读取标签/时长，识别已有歌词（`.lrc`、`.LRC`、双扩展名、内嵌标签）
- **检索阶梯**：L1 歌名+歌手 → 去括号 → 繁简转换 → 专辑 → 去副标题 → 仅歌名 → 文件名原文，逐级降级，命中即停
- **多源匹配**：LRCLIB / 网易云 / QQ音乐 / 酷狗 并行检索，按歌名+歌手+时长打分
- **人工选版**：三种下载模式（全自动 / 多版本时询问 / 全部人工），待确认列表里挑版本，选择会被记住
- **两种写入**：独立 `.lrc` 文件，或写入音频内嵌标签（FLAC/MP3/M4A）
- **删除歌词**：勾选批量删除，可选删文件或清标签
- **自定义源**：放一个 `.js` 到数据目录即可扩展歌词源

## 安装

从 [Releases](../../releases) 下载 `.fpk`，在飞牛 NAS 应用中心「手动安装」。

安装后需要在 **应用中心 → 飞牛歌词同步 → 设置 → 授权目录** 里，把音乐文件夹授权给应用（否则只能读不能写）。

## 使用

1. 打开「飞牛歌词同步」
2. 填音乐目录 → 扫描曲库
3. 点「自动补全（缺歌词）」
4. 有歧义的歌会进「待确认」，挑一个版本写入

## 架构

```
源代码/
├── src/
│   ├── server.js        HTTP 服务 + API + 网关前缀处理
│   ├── scanner.js       目录扫描、标签读取、歌词检测、写权限探测
│   ├── searchplan.js    L1~L7 检索阶梯生成
│   ├── match.js         候选打分
│   ├── sources/         lrclib / netease / qq / kugou / kuwo
│   ├── writer.js        .lrc 写入
│   ├── tagwriter.js     内嵌标签写入（node-taglib-sharp）
│   ├── queue.js         待确认队列 + 选择记忆
│   └── fnas.js          fnOS 授权目录查询（Unix Socket）
├── web/                 单页界面
├── fpk/                 .fpk 打包源（manifest / cmd / config / app）
└── testlib/             本地测试音频
```

- 入口：fnOS 统一网关 `/app/musictb`（不占固定端口）
- 运行时：系统依赖应用 `nodejs_v22`
- 数据目录：`/vol{n}/@appdata/musictb`

## 开发

```bash
cd 源代码
npm install
npm start        # http://localhost:8791（本地调试用固定端口）
```

打包（需要 fnpack，见 `工具/`）：

```bash
node 工具/mkfpk.mjs 源代码/fpk 安装包/飞牛歌词同步-x.y.z.fpk
```

> 注意：Windows 版 fnpack 打出的包 `cmd/*` 权限为 0666，fnOS 无法执行；`mkfpk.mjs` 会强制 0755 并输出 gzip 压缩的 tar（两者都是 fnOS 的硬性要求）。

## 歌词来源与免责

歌词由第三方公开接口获取，**版权归原作者/词作者所有**。本项目仅做个人本地补全，不缓存、不分发、不提供下载服务。请勿用于商业用途。

## License

MIT
