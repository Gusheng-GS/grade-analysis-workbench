# 本仓库里的第三方代码与协议

本仓库（`To Github`）只收录**自己写的代码**与一个第三方单文件库。

本项目自己的代码按 **Apache License 2.0** 授权（全文见 `LICENSE`，归属声明见 `NOTICE`）；
其中的第三方代码保留其原有协议，互不影响。

DSH（DeepSeek Harness）及其依赖**不随仓库分发**，由使用者执行 `python data/bootstrap.py`
从 npm 安装 —— 因此本仓库不承担"再分发这些二进制"的义务。

如果你打算把**构建出来的成品**（含 `app-0.2.1`、`node.exe`）也放出去，
请阅读下面第 3 节，那会给你的分发加上额外义务。

---

## 1. 随仓库分发的第三方代码

| 文件 | 组件 | 协议 | 说明 |
|---|---|---|---|
| `xlsx.full.min.js` | [SheetJS Community Edition](https://sheetjs.com/) 0.18.5 | **Apache-2.0** | 浏览器里读 xlsx 用。文件头保留了原作者版权注释；与本项目同一协议，全文即 `LICENSE`，归属声明见 `NOTICE` |

> 该文件由 `data/sync_workbench.py` 从 npm 包 `xlsx` 复制而来，未做修改。
> 若将来升级 SheetJS 版本，请连同本文件与 `NOTICE` 一起更新。

---

## 2. 只在构建/测试时使用、不随仓库分发

| 组件 | 协议 | 用途 |
|---|---|---|
| [`@deepseek-ai/dsh`](https://www.npmjs.com/package/@deepseek-ai/dsh) 0.2.1-alpha.1 | **MIT** | 程序外壳（本地 Web 服务 + WebUI）。由 bootstrap 从 npm 安装 |
| `@deepseek-ai/dsh-web-frontend` | **MIT**（实测：包内 LICENSE 与 package.json 都是 MIT） | 前端产物；工作台以 iframe 注入其中 |
| [`xlsx`](https://www.npmjs.com/package/xlsx) 0.18.5 | Apache-2.0 | 测试里读样例 xlsx（devDependency） |
| [`jsdom`](https://www.npmjs.com/package/jsdom) ^30 | MIT | 在 Node 里跑页面做端到端测试（devDependency） |
| Node.js 运行时 | **MIT** | `runtime/node.exe`，由 bootstrap 从 nodejs.org 取用 |

### 关于 DSH 依赖树（454 个包）的实测结论

| 结论 | 明细 |
|---|---|
| 绝大多数是宽松协议 | MIT 420 / Apache-2.0 13 / ISC 9 / BSD 6 / 其余零星，共 451 个 |
| 弱传染只有 2 个 | `@deepseek-ai/libreoffice-kit`、`-win32`（MPL-2.0，文件级；未修改，指向 npm 来源即可） |
| 无 GPL / AGPL | 不会传染本仓库的授权选择 |
| 唯一需要留意 | `@img/sharp-win32-x64` 里捆绑的 `libvips-42.dll`（vips 8.18.7）为 **LGPLv3**，且 DLL 内还静态含 glib / librsvg / libheif / libexif / libjpeg / libpng / libwebp / libtiff / lcms / libarchive / libexpat / zlib（逐个核对过，见第 3 节） |
| 两处归属缺失 | `sherpa-onnx-*` 声明 Apache-2.0 但包内无许可证文件；`node-pty/third_party/conpty` 捆了微软的 conpty.dll 却未附许可证 |

（以上结论由 `python data/scan_licenses.py` 扫交付目录得出，可复现。）

---

## 3. 如果你要分发"构建出来的成品"

`bootstrap.py` 生成的成品目录里有第三方二进制（DSH、Node、libvips 等）。分发它属于**再分发**，需要：

1. **附上许可证文本**：MIT（DSH / Node）、Apache-2.0（SheetJS / sharp）、
   MPL-2.0（libreoffice-kit）、**LGPLv3**（libvips）与 **LGPL-2.1**（其内置的 glib 等）、
   以及各包自带的 LICENSE 文件。
   > 本仓库的 `licenses/` 目录已经把上面这些原文备齐了（含 `README.txt` 说明每个组件
   > 的版本、来源与源码获取方式），打包脚本 `data/make_release_zip.py` 会把它一起放进
   > 发布包 —— 直接抄这个目录即可。
2. **LGPL 的两条硬要求**：
   - 让使用者能替换这些库 —— 现在它们是独立的 `.dll` 文件（运行时动态加载），满足；
     **不要**把 libvips 静态链接或打进单个 exe。
   - 提供对应源码或书面指向（如 <https://github.com/libvips/libvips>）。
3. **不要**暗示本项目的作者与 DeepSeek 有合作或背书关系。
   MIT 虽然只要求保留版权声明、不禁止提名字，但"官方/合作"这类表述会误导人 ——
   发布版因此把软件名从 `DSH成绩分析工作台` 改成了 `成绩分析工作台`，
   只在说明里写清"基于 DSH 构建，非官方"。

---

## 4. 自己代码里的第三方痕迹

- 工作台页面里的折线图是**自己用内联 SVG 画的**，没有引入图表库。
- 启动器 `launcher/Launcher.cs` 只依赖 .NET Framework 自带程序集，无第三方库。
- `data/` 下的 Python 脚本只用标准库（刻意不装第三方包，方便在没网/没权限的机器上跑）。
