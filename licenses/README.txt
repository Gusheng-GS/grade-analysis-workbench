成绩分析工作台 · 随包第三方许可证说明
============================================================

一、这份文件夹是干什么用的
------------------------------------------------------------
这个软件不是"从零到一全是我写的"。它站在别人的地基上：

  · 运行外壳是 DeepSeek Harness（DSH，一个开源项目）
  · 自带了一个 node.exe 运行环境
  · 图片/文档相关的功能用到了 sharp、libvips、LibreOffice Kit

这些第三方代码的许可证允许我们免费用、也可以随软件一起发给别人，
但都有一个共同条件：**分发时必须把它们的许可证原文一起带上、并把版权归属写清楚**。
少了这一步就是侵权——哪怕软件本身完全免费、完全开源。

这个文件夹就是为了把这一步补齐。里面的 .txt 都是许可证原文，不是我们改写的。

（一处说明：GPL-2.0 / GPL-3.0 / LGPL-2.1 / LGPL-3.0 这四份，是从随包的
 LibreOffice 许可证文件里提取的同一份官方文本，**条款文字一字未改**，
 只是重新排了版（按段落折行）。其余几份是各组件包里原封不动的 LICENSE 文件。）

本项目自己的代码按 Apache-2.0 授权，全文在上一层目录的 LICENSE；
版权与归属声明在 NOTICE；第三方组件的完整清单在 THIRD-PARTY-NOTICES.md。


二、随包分发的第三方组件
------------------------------------------------------------
组件                                  版本              协议                              原文文件
--------------------------------------------------------------------------------------------------------
DeepSeek Harness（DSH）               0.2.1-alpha.1     MIT                               MIT-DeepSeek-Harness.txt
DSH 内置的 Web 前端                   0.2.1-alpha.1     MIT                               MIT-DeepSeek-WebFrontend.txt
Node.js 运行时（runtime\node.exe）    v24.22.1          MIT                               MIT-Node.js.txt
sharp                                 0.35.5            Apache-2.0                        Apache-2.0.txt
@img/sharp-win32-x64（含 libvips）     0.35.5            Apache-2.0 + LGPL-3.0-or-later     Apache-2.0.txt、LGPL-3.0.txt、GPL-3.0.txt
  └ 其内置依赖（glib 等，见第三节）    —                 LGPL-2.1 / LGPL-3.0 等           LGPL-2.1.txt、GPL-2.0.txt
@deepseek-ai/libreoffice-kit          0.1.5             MPL-2.0                           MPL-2.0.txt、MPL-2.0-NOTICE.txt
@deepseek-ai/libreoffice-kit-win32-x64 0.1.5            MPL-2.0                           MPL-2.0.txt
node-pty                              1.2.0-beta.15     MIT                               MIT-node-pty.txt
SheetJS（update\xlsx.full.min.js）    0.18.5            Apache-2.0                        Apache-2.0.txt
sherpa-onnx-node / -win-x64           1.13.8            Apache-2.0                        Apache-2.0.txt

除此之外，程序目录 app-0.2.1\node_modules 下还有 530 多个依赖包，
其中绝大多数是 MIT（420 个）、Apache-2.0、ISC、BSD 等宽松协议，
约 10 个是 0BSD / Unlicense / Python-2.0 / BSD-2 等，2 个是 MPL-2.0，
1 个是双许可（MIT 或 CC0，我们按 MIT 使用）。
每个包自己的 LICENSE 文件都原样留在 node_modules 里，没有删改。


三、关于 LGPL-3.0（libvips）——唯一需要额外说明的一项
------------------------------------------------------------
这是本包里唯一的"弱传染性"二进制，需要多说两句。

它在哪：
  app-0.2.1\node_modules\@img\sharp-win32-x64\lib\libvips-42.dll
  app-0.2.1\node_modules\@img\sharp-win32-x64\lib\libvips-cpp-8.18.7.dll

为什么我们可以随包分发：
  1. 它们是独立的 DLL，由 Node 在运行时动态加载，
     **没有被编译/静态链接进我们自己的 exe**。谁想换版本、换自己改过的版本，
     直接替换这个 DLL 即可，不需要动我们任何代码。这正是 LGPL 要保证的自由。
  2. 我们**没有修改**这些库，用的是上游发布的原版。
  3. LGPL-3.0 要求随附协议原文：LGPL-3.0.txt 与 GPL-3.0.txt 都在本文件夹
     （LGPLv3 是在 GPLv3 之上追加若干额外许可，所以两份都要给）。

它们对应的源码在哪：
  · libvips 8.18.7         https://github.com/libvips/libvips/releases
  · 上面那个 DLL 里还静态包含了这些库（已逐个核对过，均为上游原版）：
    glib、librsvg、libheif、libexif、libjpeg、libpng、libwebp、libtiff、
    lcms、libarchive、libexpat、zlib
    其中 glib / libheif / libexif 属于 LGPL-2.1 一族，所以本文件夹同时给了
    LGPL-2.1.txt 与 GPL-2.0.txt；librsvg 属于 LGPL-3.0，对应上面两份 v3 文本。
    各库源码在各自的上游仓库（libvips 的 Windows 预编译包由
    https://github.com/libvips/build-win64-mxe 构建）。

书面要约：
  如果你需要上述 LGPL 组件的完整源码，可以在项目仓库的 Issues 里说明，
  我们会提供对应版本的源码包（或指向确切的上游地址）。
  本承诺自每个发布版本发布之日起 3 年内有效。


四、关于 MPL-2.0（LibreOffice Kit）
------------------------------------------------------------
  · 我们**没有修改**这两个包，原样分发。
  · MPL-2.0 是"文件级"弱传染：只要求被 MPL 覆盖的那些文件保持 MPL 授权、
    并在分发时能让接收者拿到这些文件的源码形式。
  · 这两个包以 JavaScript / 资源文件形式分发，包内本身就是可读的源码形式；
    同版本的原始 tarball 也可以在 npm 上取得：
        https://www.npmjs.com/package/@deepseek-ai/libreoffice-kit/v/0.1.5
        https://www.npmjs.com/package/@deepseek-ai/libreoffice-kit-win32-x64/v/0.1.5
  · 该包自带的 licenses\ 子目录（LibreOffice 官方许可证与第三方清单）
    被完整保留，没有删除。


五、上游打包的疏漏（我们如实写出来，不假装齐全）
------------------------------------------------------------
我们检查了全部依赖，发现有几处是**上游自己没附许可证文件**。
这不是我们能补写的（原文只有上游才有），这里如实说明来源：

  1. sherpa-onnx-node、sherpa-onnx-win-x64（1.13.8）
     包内 package.json 声明 Apache-2.0，但没有附带许可证文件。
     Apache-2.0 全文已在本文件夹提供。

  2. node-pty\third_party\conpty（1.25.260303002）
     里面是微软 Windows Terminal 的 OpenConsole.exe 与 conpty.dll，
     属于 MIT 许可，但上游没附许可证文件。
     来源：https://github.com/microsoft/terminal

  3. 另外约有 18 个包上游没有附带许可证文件
     （例如 @xterm/addon-serialize、@xterm/headless、fontkit、brotli、
     saxes、standardwebhooks、data-uri-to-buffer 等）。
     它们的协议以各自 package.json 里的声明为准，都是宽松协议。

  4. Node.js 官方只以单个 node.exe 形式分发，不带 LICENSE 文件。
     本文件夹附了 MIT 正文（Node.js contributors 与 Joyent 两段），
     完整清单（含 node.exe 内置的 V8、OpenSSL、ICU、zlib 等第三方组件）
     见 https://github.com/nodejs/node/blob/v24.22.1/LICENSE


六、我们自己的代码
------------------------------------------------------------
  · 工作台界面（成绩分析工作台-首页.html 及其生成脚本）
  · 五岳导出的解析与统计
  · 启动器（Launcher.cs 编译出的 exe）
  · 各种构建 / 测试脚本

以上按 Apache-2.0 授权：可以免费使用、修改、再发布（含商用），
但必须保留版权与协议声明，且不能用本项目作者的名义为你的版本背书。
全文见上一层目录的 LICENSE，归属声明见 NOTICE。


七、联系方式
------------------------------------------------------------
对许可证有疑问、或需要 LGPL 组件的源码，请在项目仓库的 Issues 里说明。
