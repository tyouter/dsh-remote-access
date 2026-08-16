# DSH Remote Access

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）Web UI 添加“远程连接”入口：

- 在侧边栏“设置”上方新增 **远程连接** 按钮
- 弹窗内展示两个小二维码：
  1. **Tailscale 通道**：同一 tailnet 内访问
  2. **外出高速通道**：Cloudflare 加密隧道，手机在外也能用
- 扫码自动登录（cookie token），不用输入账号密码
- DSH 本身仍只监听 `127.0.0.1`，不暴露公网端口

> 本文所有示例均使用占位符，不含任何真实 IP、域名、密钥或 Token。

---

## 架构

```text
┌────────────┐
│ 手机浏览器 │
└─────┬──────┘
      │ 1) Tailscale 专用网      2) Cloudflare 公网隧道
      ▼
┌──────────────────────────────────────────────┐
│ Caddy 认证代理（本机 127.0.0.1:8080）          │
│  - /enter/<token> 写入 cookie 后跳转          │
│  - 带 cookie 的请求才允许反向代理             │
│  - 强制改写 Host/Origin，避免 DSH 信任栅栏 403 │
└──────────────┬───────────────────────────────┘
               ▼
      DSH Web（127.0.0.1:3080，不对外监听）
```

配套组件：

| 组件 | 作用 |
|---|---|
| `dsh-plugin/` | DSH 客户端插件：两个二维码 + 状态检测 |
| `patch-dsh.ps1` | 把插件装进 DSH 源码树并构建 |
| `install.ps1` | 下载 Caddy/cloudflared，生成 token，启动隧道，安装开机自启 |
| `start-cloud-access.ps1` | 开机时拉起 Caddy 和 cloudflared，并发布最新隧道 URL |
| `uninstall.ps1` | 停止服务并清理 |

---

## 前置条件

- Windows 10/11（当前脚本面向 Windows；macOS/Linux 用户可参考脚本改成 systemd）
- 一个能跑 `pnpm dsh web` 的 DeepSeek Harness 源码 checkout
- 能访问 GitHub 和 Cloudflare 的网络
- 手机能访问 `trycloudflare.com`

不需要：公网 IP、光猫/路由器端口映射、云服务器、域名。

---

## 一键部署

### 1. 克隆本仓库

```powershell
git clone <你的仓库地址>
cd dsh-remote-access
```

### 2. 安装网络层

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

脚本会：

1. 下载 `caddy.exe` 和 `cloudflared.exe` 到 `~/.dsh-remote-access/bin`
2. 生成随机访问 token
3. 生成 Caddy 认证代理配置
4. 启动 Caddy + Cloudflare 快速隧道
5. 在启动文件夹创建开机自启项

成功后脚本会打印一个 `<tunnel>/enter/<token>` 入口地址。**不要公开发这个地址。**

### 3. 给 DSH 装插件

```powershell
powershell -ExecutionPolicy Bypass -File .\patch-dsh.ps1 -DshRoot D:\path\to\deepseek-harness
```

脚本会：

1. 复制 `dsh-plugin/` 到 `packages/client/ui-remote-access`
2. 在 `web-app` bundle 中登记插件
3. 执行 `pnpm install`
4. 编译客户端插件

### 4. 重启 DSH

```powershell
cd D:\path\to\deepseek-harness
pnpm dsh web
```

然后点击侧边栏底部的 **远程连接**，扫描 **外出高速通道** 二维码即可。

---

## 配置文件与数据目录

默认数据目录：

```text
C:\Users\<你>\.dsh-remote-access\
├── bin\caddy.exe
├── bin\cloudflared.exe
├── caddy\Caddyfile
├── access-token.txt      # 随机登录 token
├── tunnel-url.txt        # 当前隧道入口 URL（插件读取）
├── start-cloud-access.ps1
└── logs\
```

DSH 插件通过环境变量读取同一目录：

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `DSH_REMOTE_ACCESS_DIR` | `~/.dsh-remote-access` | 数据目录 |
| `DSH_REMOTE_AUTH_PROXY` | `http://127.0.0.1:8080` | Caddy 认证代理地址 |

`install.ps1` 已自动写入这两个用户环境变量。

---

## 自定义端口

```powershell
# DSH 在 4000，代理用 9090
.\install.ps1 -DshPort 4000 -ProxyPort 9090
```

之后记得用相同参数启动 DSH：

```powershell
pnpm dsh web --port 4000
```

---

## Tailscale 通道（可选）

即使没有 Tailscale，公网隧道也能用。想保留两个通道：

1. 电脑和手机都安装并登录 Tailscale
2. 打开 DSH 的“远程连接”弹窗，点击 **开启 Tailscale serve**
3. 扫左侧二维码

插件会执行：

```powershell
tailscale serve --bg --https=443 http://127.0.0.1:<ProxyPort>
```

所以 Tailscale 流量也会经过 Caddy 认证代理。

> 如果运营商是双层 NAT，Tailscale 可能仍走 DERP 中继而偏慢；这正是保留 Cloudflare 通道的原因。

---

## 隐私与安全

### 本仓库不包含任何隐私信息

所有示例值均为占位符：

```text
<你的仓库地址>
<你的用户名>
<你的安装目录>
<你的 DSH checkout 路径>
```

真实 token、隧道地址、Tailscale 域名、IP 都在你机器本地生成，不会进入仓库。

### 安全边界

- Cloudflare 隧道是**公网可达**的随机地址，但只有 `/enter/<token>` 能写入登录 cookie
- 未登录请求只返回 `401`
- Caddy 会移除浏览器 `Origin` 并把 `Host` 改写为 `127.0.0.1:<DSH端口>`，所以 DSH 的 `/api` 信任栅栏正常工作
- DSH 服务本身不监听 `0.0.0.0`
- 隧道流量在手机与 Cloudflare 边缘之间为 TLS 加密；Cloudflare 到本机由 cloudflared 建立加密隧道

### 你需要做到

- 不要把二维码或 `tunnel-url.txt` 的内容发给别人
- 不要把 `access-token.txt` 提交到任何 Git 仓库
- 更换设备或怀疑泄露时，删除数据目录并重跑 `install.ps1`

---

## 常见问题

### 二维码能扫，但页面打不开

1. 确认 DSH 正在本机 `127.0.0.1:3080` 运行
2. 确认 Caddy 在运行：

   ```powershell
   Get-Process caddy
   ```

3. 查看日志：

   ```powershell
   Get-Content ~\.dsh-remote-access\logs\caddy.err.log -Tail 30
   Get-Content ~\.dsh-remote-access\logs\cloudflared.err.log -Tail 30
   ```

### 重启电脑后隧道地址变了

`tunnel-url.txt` 会自动更新。打开“远程连接”弹窗点一下 **刷新**，二维码就是新地址。

### 页面能开，但聊天/API 报错

检查 Caddy 是否在转发时改写了 Host/Origin。正确配置中的两行是：

```text
header_up -Origin
header_up Host 127.0.0.1:<DSH端口>
```

### 手机提示 401

说明 cookie 没有写入。直接扫“外出高速通道”二维码，URL 里应包含 `/enter/<token>`。不要用裸域名。

### 速度慢

Cloudflare 免费隧道不保证全球线路质量。常见优化：

1. 重新扫码，Cloudflare 可能更换边缘节点
2. 若你在海外且访问国内电脑，物理距离决定延迟，任何隧道都只能接近理论 RTT
3. Tailscale 直连失败时走 DERP 会慢；如能进入光猫后台，给 Tailscale UDP 41641 做端口映射/开启 UPnP

---

## 目录结构

```text
.
├── README.md
├── LICENSE
├── SECURITY.md
├── .gitignore
├── dsh-plugin/
│   ├── package.json
│   ├── tsconfig.json
│   ├── tsdown.config.ts
│   └── src/
│       ├── index.ts
│       ├── invariant.ts
│       ├── css-modules.d.ts
│       └── client/
│           ├── index.ts
│           ├── RemoteAccessAction.tsx
│           └── RemoteAccessAction.module.css
├── install.ps1
├── patch-dsh.ps1
├── start-cloud-access.ps1
└── uninstall.ps1
```

---

## 致谢

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- [Caddy](https://caddyserver.com/)
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)
- [Tailscale](https://tailscale.com/)
