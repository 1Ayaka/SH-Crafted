# SH-Crafted 本地 FunASR

该目录只提供部署模板，不会在开发机或生产机自动启动服务。

默认使用官方 FunASR Runtime CPU 镜像的固定 tag 和 2pass 模型组合。部署前请根据官方 Runtime 文档核对 tag、模型版本与许可证，并在 `.env` 中显式填写 `FUNASR_IMAGE`。FunASR 仅绑定到 `127.0.0.1:10095`，Node 网关通过 `VOICE_FUNASR_WS_URL=ws://127.0.0.1:10095` 连接。`hotwords.txt` 包含“小蕉小蕉”和项目专有词，修改后需要重启容器。

```bash
cp -n .env.example .env
mkdir -p models
sudo docker compose pull
sudo docker compose up -d
sudo docker compose ps
sudo docker compose logs -f funasr
```

`docker compose up -d` 可重复执行；不要再次运行同名 `docker run`。如果终端提示 `container name "/sh-crafted-funasr" is already in use`，先执行 `sudo docker ps -a --filter 'name=^/sh-crafted-funasr$'` 和 `sudo docker logs --tail=120 sh-crafted-funasr`，已有容器退出时使用 `sudo docker start sh-crafted-funasr`，不要继续创建第二个容器。完整迁移与回滚步骤见 `docs/FunASR本地语音识别部署与运维.md`。

Compose 会直接以前台方式启动 `funasr-wss-server-2pass`。不要把 `run_server_2pass.sh` 直接作为容器主命令：该脚本会把服务放到后台后退出，导致容器显示 `Restarting (0)`。

Linux 服务器首次启动会下载模型，时间和磁盘空间取决于模型。上线前使用项目侧测试：

```bash
npm run voice:test
npm run voice:test-protocol
FUNASR_INTEGRATION_TEST=1 npm run voice:test-integration
```

FunASR 不可用时，将 `VOICE_STT_PROVIDER=browser`，重启 SH-Crafted 后恢复浏览器兼容识别；若要完全关闭语音识别，设置为 `disabled`，文字输入仍可用。
