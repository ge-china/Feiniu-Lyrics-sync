# 上传到 GitHub

本地仓库已初始化并完成首次提交（`349198d`），共 52 个文件。

> 注意：当前这台开发机 **无法访问 GitHub**（`github.com:443` / `api.github.com:443` 均 TCP 超时），必须先有可用的网络通道。

## 方案 A：本机挂代理（推荐）

1. 启动代理（Clash / v2rayN 等），确认本地端口，例如 `127.0.0.1:7890`
2. 给 git 配代理：

```bash
cd "D:/AI xiang mu/musicTB"
git config http.proxy http://127.0.0.1:7890
git config https.proxy http://127.0.0.1:7890
```

3. 到 GitHub 网页建空仓库（**不要**勾选 README / .gitignore / License）
   - 名称：`Feiniu-Lyrics-sync`（GitHub 不支持中文仓库名）
   - 描述：`飞牛 fnOS 音乐歌词自动补全`
   - 可见性：Public

4. 推送：

```bash
git remote add origin https://github.com/<你的用户名>/Feiniu-Lyrics-sync.git
git branch -M main
git push -u origin main
```

如果用 Token 推送：

```bash
git remote set-url origin https://<用户名>:<TOKEN>@github.com/<用户名>/Feiniu-Lyrics-sync.git
git push -u origin main
```

## 方案 B：换一台能访问 GitHub 的机器

把整个 `musicTB` 目录（含 `.git`）拷过去，执行上面的第 3、4 步即可。

## 方案 C：改用 Gitee（支持中文仓库名）

Gitee 允许中文仓库名，且国内直连：

```bash
git remote add origin https://gitee.com/<用户名>/飞牛歌词同步.git
git branch -M main
git push -u origin main
```

## 发布安装包

仓库里不包含 `.fpk`（已在 .gitignore 中排除）。上架前建议在 Releases 里附上 `安装包/飞牛歌词同步-0.4.0.fpk`。


---

## 附：本机网络修复记录（2026-11-18）

现象：浏览器能打开 github.com，但程序调 API 全部超时。

原因：`C:\Windows\System32\drivers\etc\hosts` 内有错误记录：

```
8.8.4.4     api.github.com        ← 假 IP
8.8.4.4     codeload.github.com   ← 假 IP
140.82.121.3 github.com           ← 该 IP 已不通
```

修复为实测可用的 IP（用 `curl --resolve` 逐个验证）：

```
20.205.243.168  api.github.com
20.6.7.16       codeload.github.com
20.205.243.166  github.com
```

备份：`备份/hosts.bak-*.txt`。GitHub 的 IP 会变，失效时重新用 DoH 查询后替换。
