# 成绩分析工作台 V0.1.2 · 安全更新

**本版只做一件事：把内置的 Node.js 运行环境换成安全版本。功能没有任何变化。**

---

## 为什么要更新

Node.js 于 **2026-10-21** 发布安全版本，共修复 10 个漏洞，其中影响较大的包括：

- **CVE-2026-111497**：Brotli 解码器中的**高危远程代码执行（RCE）**
- 若干 **TLS 证书校验绕过**
- DNS 相关缺陷

我们原来随包分发的是 **v24.19.0（2026-08-03）**，发布时间早于上述修复，因此**落在受影响范围内**。

风险边界（免得过度紧张）：这个运行时只在本机 `127.0.0.1` 上跑本地服务、不对外开端口，
也不主动访问不可信网站；但 RCE 类问题后果较重，而升级代价只是重下一次包，所以该升。

## 本版变更

| 项目 | 变化 |
|---|---|
| 内置 Node.js 运行时 | v24.19.0 → **v24.22.1**（LTS Krypton） |
| 功能 / 界面 / 数据格式 | **无变化** |
| 你的数据 | 不受影响；成绩存在浏览器里，换文件夹也不动 |

**为什么是 24.22.1 而不是最新的 26.12.1**：26 是 Current（非长期支持版），而安全补丁已经
backport 到 24 的 LTS 补丁版；留在同一条大版本线上，ABI 不变、无需重编译原生模块，风险最小。

## 升级方法

- **你现在是 0.1.1**（推荐，顺便验证更新链路）：
  设置 → 更新 → 检查更新 → 下载并更新 → 按提示重启。
- **你现在还是 0.1.0**：旧版没有更新器，必须整包替换一次：
  解压新包 → 把旧文件夹里的 `data-0.2.1` 整个拷到新文件夹 → 双击新文件夹的 `启动.bat`。

## 校验

```
文件名  grade-analysis-workbench-v0.1.2-windows-x64.zip
大小    202214631 字节（192.8 MB）
SHA-256 dcaf56b3cce7283ae3df687247f4ce1cb3aab1da51815718bc7452068a7b44b6
```

核对方法（PowerShell）：

```powershell
Get-FileHash "grade-analysis-workbench-v0.1.2-windows-x64.zip" -Algorithm SHA256
```

---

> 本文件只记录 **0.1.1 → 0.1.2 的增量**。
> 完整的产品介绍、系统要求、隐私说明与许可证信息见仓库
> [`README.md`](https://github.com/Gusheng-GS/grade-analysis-workbench/blob/main/README.md)
> 与上一版说明 [`RELEASE-NOTES-v0.1.1.md`](https://github.com/Gusheng-GS/grade-analysis-workbench/blob/main/docs/RELEASE-NOTES-v0.1.1.md)。
