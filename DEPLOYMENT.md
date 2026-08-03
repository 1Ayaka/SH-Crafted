# SH-Crafted 部署手册

本文以 Ubuntu/Debian、Nginx、systemd 和 GitHub 为例。正式站点由 Node 监听 `127.0.0.1:7100`，Nginx 对外提供域名与 HTTPS。

本项目当前正式域名为 `avonana.site`，服务器用户为 `ubuntu`。示例中的 `YOUR_GITHUB_OWNER` 仍需替换为你的 GitHub 用户名。

## 1. 上传 GitHub

在 GitHub 新建一个空仓库，不要勾选自动创建 README、许可证或 `.gitignore`。然后在本机项目目录执行：

```powershell
cd D:\Project\SH-Crafted
git add .
git commit -m "release: SH-Crafted v1"
git remote add origin git@github.com:YOUR_GITHUB_OWNER/SH-Crafted.git
git push -u origin main
```

`.env` 已被 Git 忽略，DeepSeek 密钥不会随代码上传。

## 2. 准备服务器

安装 Git、Nginx、Node.js 22 或更高版本；生产环境推荐 Node.js 24 LTS。安装完成后确认版本：

```bash
git --version
nginx -v
node --version
npm --version
```

开放云服务器安全组和系统防火墙的 TCP `22`、`80`、`443`；不要对公网开放 `7100`。

克隆代码并安装依赖：

```bash
sudo mkdir -p /var/www/sh-crafted
sudo chown ubuntu:ubuntu /var/www/sh-crafted
git clone git@github.com:YOUR_GITHUB_OWNER/SH-Crafted.git /var/www/sh-crafted
cd /var/www/sh-crafted
npm ci --omit=dev --ignore-scripts
npm run check
```

如果仓库是私有仓库，需要先给服务器配置只读 GitHub Deploy Key；如果是公开仓库，也可以把克隆地址改为 `https://github.com/YOUR_GITHUB_OWNER/SH-Crafted.git`，避免服务器保存 GitHub 凭据。

把密钥单独放在服务器上，不要放入仓库：

```bash
sudo install -m 600 /dev/null /etc/sh-crafted.env
sudo nano /etc/sh-crafted.env
```

文件内容：

```dotenv
DEEPSEEK_API_KEY=你的密钥
ADMIN_USERNAME=djt
ADMIN_PASSWORD=12345689
CONTENT_STORE_PATH=/var/lib/sh-crafted/content.json
COMMUNITY_STORE_PATH=/var/lib/sh-crafted/community.json
ADMIN_COOKIE_SECURE=true
```

为在线编辑内容创建独立持久化目录：

```bash
sudo install -d -o ubuntu -g ubuntu -m 0750 /var/lib/sh-crafted
```

## 3. 配置 systemd

复制已经配置好 `ubuntu` 用户的模板：

```bash
sudo cp /var/www/sh-crafted/deploy/sh-crafted.service /etc/systemd/system/sh-crafted.service
sudo nano /etc/systemd/system/sh-crafted.service
sudo systemctl daemon-reload
sudo systemctl enable --now sh-crafted
sudo systemctl status sh-crafted
```

本机验证：

```bash
curl -I http://127.0.0.1:7100/
```

## 4. 绑定域名与 Nginx

先在域名 DNS 控制台添加：

- 根域名 `@` 的 `A` 记录指向服务器公网 IPv4。
- `www` 的 `A` 记录也指向同一公网 IPv4；不需要 `www` 时可省略。

复制已经配置好 `avonana.site` 与 `www.avonana.site` 的模板：

```bash
sudo cp /var/www/sh-crafted/deploy/nginx.conf.example /etc/nginx/sites-available/sh-crafted
sudo nano /etc/nginx/sites-available/sh-crafted
sudo ln -s /etc/nginx/sites-available/sh-crafted /etc/nginx/sites-enabled/sh-crafted
sudo nginx -t
sudo systemctl reload nginx
```

DNS 生效且 HTTP 可访问后，使用 Certbot 为域名签发并安装 HTTPS 证书：

```bash
sudo certbot --nginx -d avonana.site -d www.avonana.site
sudo certbot renew --dry-run
```

备案号 `滇ICP备2026003342号` 已在全站底部展示，并链接到工信部备案查询系统。请确认备案主体、已备案域名和实际接入服务商信息一致。

## 5. 日常更新

本机完成修改后：

```powershell
git add .
git commit -m "描述本次更新"
git push
```

手动部署时，在服务器执行：

```bash
cd /var/www/sh-crafted
bash scripts/deploy.sh
```

脚本只接受 `main` 的快进更新，随后运行 `npm ci`、语法检查并重启服务。检查日志：

```bash
sudo journalctl -u sh-crafted -n 100 --no-pager
```

## 6. 推送后自动部署（可选）

仓库包含 `.github/workflows/deploy.yml`。在 GitHub 仓库的 `Settings → Secrets and variables → Actions` 中配置：

| Secret | 内容 |
| --- | --- |
| `SSH_HOST` | 服务器公网 IP 或 SSH 域名 |
| `SSH_PORT` | SSH 端口，通常为 `22` |
| `SSH_USER` | `ubuntu` |
| `SSH_PRIVATE_KEY` | 仅用于部署的 SSH 私钥全文 |
| `SSH_KNOWN_HOSTS` | 本机执行 `ssh-keyscan -H 服务器地址` 得到的主机公钥行 |

部署用户需要免交互执行指定服务重启命令。使用 `sudo visudo -f /etc/sudoers.d/sh-crafted-deploy` 写入：

```text
ubuntu ALL=NOPASSWD: /usr/bin/systemctl restart sh-crafted, /usr/bin/systemctl is-active --quiet sh-crafted
```

此后每次推送 `main` 都会自动 SSH 到服务器并执行 `scripts/deploy.sh`。GitHub 私钥不要复用个人日常 SSH 私钥。

## 7. 站内管理

管理员通过 `https://avonana.site/#/admin/login` 登录，在用户页面原位编辑文字，并在工序管理页调整材料与操作。编辑内容保存在 `/var/lib/sh-crafted/content.json`；点击统计、传承人序号和社区投稿保存在 `/var/lib/sh-crafted/community.json`，均不随 Git 更新覆盖。完整使用、协作与备份说明见 [`docs/内容后台使用与部署.md`](docs/内容后台使用与部署.md)。
