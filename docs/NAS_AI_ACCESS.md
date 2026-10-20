# NAS 访问方式（供 AI 机器人使用）

> 适用范围：CoffeeBear Production 所在极空间 Q4 NAS（局域网 `192.168.5.227`）。
> 本文件只描述**访问方式**，不含任何密码。凭据由维护者在会话中提供，或从本机受控文件读取；禁止进入 Git、Issue、PR 描述或 CI 日志。
> 最近实测：2026-10-20。

## 1. 可达端点

| 目标 | 地址 | 状态 |
|---|---|---|
| 电商平台 Web | `http://192.168.5.227:8000` | 在线 |
| API 文档 | `http://192.168.5.227:8000/docs`、`/openapi.json` | 匿名可读 |
| 健康检查 | `GET http://192.168.5.227:8000/health` | 匿名可读 |
| NAS 文件 | `sftp://192.168.5.227:2022` | 可登录，仅文件操作 |
| 宿主机 shell | 无 | 不开放（见 §4） |

`/health` 返回的 `gitSha` 就是当前运行的代码版本，可用于确认发布是否生效。

## 2. SFTP 登录

- 服务：极空间 ZFileShare（SSH banner `ZFileShare_2.5.4`）
- 端口：`2022`
- 用户名：维护者提供的账号（手机号即用户名），通过环境变量 `NAS_SFTP_USER` 传入
- 密码：通过环境变量 `NAS_SFTP_PASSWORD` 传入，**不得写入仓库**
- 仅支持 SFTP：exec / shell 请求会被拒绝（`exec request failed on channel 0`）

### 非交互连接（Git Bash 已验证）

```bash
# askpass 只在本地临时目录生成，用完立即删除
printf '#!/bin/sh\necho "$NAS_SFTP_PASSWORD"\n' > /tmp/askpass.sh
chmod +x /tmp/askpass.sh
export SSH_ASKPASS=/tmp/askpass.sh SSH_ASKPASS_REQUIRE=force DISPLAY=:0

printf 'ls -la /\n' | sftp -o StrictHostKeyChecking=no -o ConnectTimeout=10 \
  -P 2022 "$NAS_SFTP_USER@192.168.5.227"

rm -f /tmp/askpass.sh
```

注意：

- 不能用 `sftp -b 批处理文件`，`BatchMode` 会禁用密码认证。
- Windows 自带 OpenSSH 不支持该 askpass 方式，应使用 Git Bash 自带的 `sftp`。
- 传输文件用 `get` / `put`，不要尝试远程执行命令。

## 3. 文件区结构

```text
/nvme13-18006585505/     个人 NVMe 空间
  ├── coffeebear/        GitHub zip 解压的源码副本（非运行容器目录）
  ├── LobeHub/
  └── 浏览器/
/存储1/                  大容量存储（工作、照片、品牌资料等）
/public/
/share/
```

`coffeebear/` 内只有源码副本与 `docker-compose.yml` 目录说明树；真正运行的容器不在此目录，Compose 工程路径在宿主机上，无 shell 时无法确认。

## 4. 不可用通道

| 通道 | 结果 |
|---|---|
| SSH exec（2022 端口） | 拒绝，仅 SFTP |
| 22 端口 SSH | 关闭 |
| Docker API（2375/2376） | 关闭 |
| SMB / `net view` | 禁用 IPC$ |
| 网页平台未登录调用运维 API | 401 |

因此：**容器更新、`git pull`、重启服务都必须由维护者在宿主机终端执行**，AI 只能通过 SFTP 读写文件、通过 HTTP 读取状态。

## 5. 最小验证清单

```bash
curl -s http://192.168.5.227:8000/health            # 确认在线与 gitSha
curl -s http://192.168.5.227:8000/openapi.json      # 确认 API 可读
# SFTP：ls / 与 ls /nvme13-18006585505/coffeebear/ 可正常返回
```

## 6. 版本更新

更新流程以 `docs/DEPLOYMENT.md`、`docs/RELEASE_STANDARD.md` 和最新 Release notes 为准。要点：

- 只使用 Release notes 中给出的不可变 digest（`IMAGE_REF`，必要时加 `UPDATE_AGENT_IMAGE_REF`）。
- 禁止 `stable` / `latest` / `candidate` / `:main` 等可变标签。
- 禁止在 NAS 上重新构建镜像。
- 更新后以 `/health` 的 `gitSha` 与 Release 中记录的 source SHA 比对验收。

## 7. 安全要求

- 本文件与仓库任何位置都不得出现密码、Token、Cookie。
- 凭据只在单次会话内使用，不写入脚本、日志或提交信息。
- 一旦凭据出现在聊天、Issue 或文件中，应视为已泄露并轮换。
- 网页平台 RBAC 账号与 NAS 账号是两套凭据，不要混用。
