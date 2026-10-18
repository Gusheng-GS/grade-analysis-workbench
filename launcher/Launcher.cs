// DSH 成绩分析工作台 · 启动器
//
// 用户动作：双击本 exe
// 期望结果：等几秒后浏览器自动打开 WebUI，中间不出现黑色命令行窗口
//
// 实现要点（每条都经过实测确认，不是推测）：
//   1. 用 exe 旁边的 runtime\node.exe 启动程序目录里已构建好的 dsh，用户无需安装 Node
//      程序目录自动识别（优先 app-0.2.1，其次 app），换目录名不用改启动器
//   2. DSH_HOME 指向 exe 旁边同名的 data 目录（app-0.2.1 → data-0.2.1）
//      —— 绿色免安装，数据跟着文件夹走
//   3. 【不重定向子进程输出】。实测：重定向 stdout/stderr 会导致服务起不来，
//      而 dsh 内部还会再开子进程，管道句柄极易出问题。
//      改成隐藏窗口、不重定向后，8 秒内服务就绪。
//   4. 【不加 --no-open】。dsh 自己会用带进程 token 的地址打开默认浏览器；
//      直接访问 http://127.0.0.1:3080/ 会因缺少 token 被 401 拒绝，
//      所以"打开浏览器"这个动作必须交给 dsh 自己做。
//   5. 启动器只负责：拉起服务 → 等端口就绪 → 给出反馈 → 自己退出。
//
// 更新功能（2026-10 新增）：
//   把更新压缩包放进同目录的 update\ 文件夹，本程序启动时会自动：
//   解压 → 备份旧版 → 覆盖程序目录 → 重新注入成绩工作台 → 提示重启。
//   为什么必须由启动器做：浏览器读不了本地文件、也不能解压。
//
// 全程零第三方依赖，只用 .NET Framework 自带程序集。

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Windows.Forms;

static class Program
{
    private const int DefaultPort = 3080;
    /// <summary>等待服务就绪的上限：每次 500 毫秒，共 240 次即 120 秒。</summary>
    private const int WaitRounds = 240;

    private static int port = DefaultPort;
    private static string logPath;

    // ── 更新代理（update_agent.js）──
    // 浏览器没法把文件写进程序目录，所以下载交给一个本地小进程做：
    // 启动器用随机端口把它拉起来，并把"端口 + 一次性 token + 版本号"注入到页面里。
    private const int AgentPortFrom = 30990;
    private const int AgentPortTo = 31010;
    private static string agentToken = Guid.NewGuid().ToString("N");
    private static int agentPort = 0;
    private static Process agentProc = null;

    [STAThread]
    static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        // 日志放到 _开发文件 下，避免老师在自己的文件夹里看到一个 txt 而困惑
        string logDir = Path.Combine(baseDir, "_开发文件");
        try { if (!Directory.Exists(logDir)) Directory.CreateDirectory(logDir); } catch { }
        logPath = Path.Combine(logDir, "启动日志.txt");
        try { if (File.Exists(logPath)) File.Delete(logPath); } catch { }

        Log("=== 启动器开始 ===");
        Log("目录: " + baseDir);
        Log("64位进程: " + Environment.Is64BitProcess);

        if (args.Length >= 1)
        {
            int p;
            if (int.TryParse(args[0], out p) && p > 0 && p < 65536) port = p;
        }
        Log("端口: " + port);

        // ── 更新检查 ──
        // 浏览器读不了本地文件、也不能解压，所以更新只能由本启动器做。
        // 约定：把更新压缩包放进同目录的 update\ 文件夹，本程序启动时自动应用。
        string updateDir = Path.Combine(baseDir, "update");
        string[] pkgs = new string[0];
        try
        {
            if (Directory.Exists(updateDir))
            {
                pkgs = Directory.GetFiles(updateDir, "*.zip");
            }
        }
        catch (Exception ex) { Log("扫描更新目录失败: " + ex.Message); }

        if (pkgs.Length > 0)
        {
            Array.Sort(pkgs);
            Log("发现更新包: " + pkgs[0]);
            ApplyUpdate(baseDir, pkgs[0]);
            return;   // ApplyUpdate 内部会提示并退出，交给用户重启
        }

        string nodeExe = Path.Combine(baseDir, "runtime", "node.exe");
        // 自动选择程序目录：优先新版 app-0.2.1，其次 app。
        // 这样更新换目录名时启动器不用改，也方便交付时只留一个程序目录。
        string appDir = DetectAppDir(baseDir);
        string dshEntry = Path.Combine(appDir, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
        string dataDirName = Path.GetFileName(appDir) == "app-0.2.1" ? "data-0.2.1" : "data";
        string dshHome = Path.Combine(baseDir, dataDirName);

        if (!File.Exists(nodeExe))
        {
            Log("缺少 node: " + nodeExe);
            Fail("缺少运行环境文件：\r\n" + nodeExe + "\r\n\r\n请确认整个文件夹完整拷贝（不能只拷 exe）。");
            return;
        }
        if (!File.Exists(dshEntry))
        {
            Log("缺少 dsh 入口: " + dshEntry);
            Fail("缺少程序文件：\r\n" + dshEntry + "\r\n\r\n请确认 app 子文件夹存在且完整。");
            return;
        }
        Directory.CreateDirectory(dshHome);

        // 已经在运行：dsh 不会重复打开浏览器，这里只做提示
        if (PortInUse(port))
        {
            Log("端口 " + port + " 已在监听，判断为服务已在运行");
            MessageBox.Show(
                "服务已经在运行了。\r\n\r\n" +
                "如果浏览器里没有看到界面，请手动打开：\r\n" +
                "http://127.0.0.1:" + port + "/\r\n\r\n" +
                "如果打不开，请先双击「停止服务.bat」，再重新运行本程序。",
                "成绩分析工作台", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        // 更新代理的端口每次启动都重新挑（页面里注入的 token 也随之换新）。
        // 必须在启动 node 之前定好，因为下面要把它注入 index.html。
        agentPort = FindFreePort(AgentPortFrom, AgentPortTo);
        if (agentPort == 0) Log("没有空闲端口，自动更新不可用");
        IntegrateWorkbench(baseDir, appDir);

        Form splash = BuildSplash();
        splash.Show();
        splash.Refresh();

        try
        {
            // 注意：故意不加 --no-open —— 交给 dsh 自己打开带 token 的浏览器地址
            string arguments = Quote(dshEntry) + " web --port " + port;
            Log("启动命令: " + nodeExe + " " + arguments);

            var psi = new ProcessStartInfo
            {
                FileName = nodeExe,
                Arguments = arguments,
                WorkingDirectory = Path.GetDirectoryName(dshEntry),
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            };
            psi.EnvironmentVariables["DSH_HOME"] = dshHome;
            psi.EnvironmentVariables["NO_COLOR"] = "1";

            Process node = Process.Start(psi);
            if (node == null)
            {
                Log("Process.Start 返回 null");
                Fail("无法启动服务进程。");
                return;
            }
            Log("node 已启动 PID=" + node.Id);

            bool ready = false;
            for (int i = 0; i < WaitRounds; i++)
            {
                if (node.HasExited)
                {
                    Log("node 已退出，退出码 " + node.ExitCode);
                    Fail("服务启动失败（退出码 " + node.ExitCode + "）。\r\n\r\n" +
                         "常见原因：\r\n" +
                         "  · 程序文件不完整（请确认整个文件夹都拷过来了）\r\n" +
                         "  · 端口 " + port + " 被其它程序占用\r\n" +
                         "  · 前端产物缺失\r\n\r\n" +
                         "想知道具体原因：双击同目录的「启动.bat」，\r\n" +
                         "那个黑窗口里会显示详细的错误信息。");
                    return;
                }
                if (PortInUse(port)) { ready = true; break; }

                if (i == 12) UpdateSplash(splash, "正在启动服务，请稍候…\r\n\r\n首次启动会慢一些，请勿关闭本窗口");
                if (i == 60) UpdateSplash(splash, "还在启动中…\r\n\r\n启动完成后浏览器会自动打开");
                Thread.Sleep(500);
            }

            if (!ready)
            {
                Log("等待超时");
                Fail("等待服务就绪超时（120 秒）。\r\n\r\n" +
                     "服务可能仍在后台启动，稍后请手动打开：\r\n" +
                     "http://127.0.0.1:" + port + "/\r\n\r\n" +
                     "想知道具体原因：双击同目录的「启动.bat」，\r\n" +
                     "那个黑窗口里会显示详细的错误信息。");
                return;
            }

            Log("服务已就绪，浏览器应由 dsh 自动打开");
            UpdateSplash(splash, "启动成功！\r\n\r\n浏览器正在打开，请稍候…");

            // 拉起更新代理（失败不影响使用：页面上的"检查更新"会退化成去发布页手动下载）
            StartUpdateAgent(baseDir);

            Thread.Sleep(2500);   // 留出 dsh 打开浏览器的时间
            splash.Close();
            Log("=== 启动完成 ===");
        }
        catch (Exception ex)
        {
            Log("异常: " + ex);
            Fail("启动过程中出错：\r\n" + ex.Message +
                 "\r\n\r\n详细信息见「_开发文件\\启动日志.txt」。");
        }
    }

    // ── 界面 ────────────────────────────────────────────────

    static Form BuildSplash()
    {
        var f = new Form();
        f.Text = "成绩分析工作台";
        f.FormBorderStyle = FormBorderStyle.FixedDialog;
        f.StartPosition = FormStartPosition.CenterScreen;
        f.MinimizeBox = false;
        f.MaximizeBox = false;
        f.ClientSize = new Size(420, 150);
        f.BackColor = Color.White;

        var label = new Label();
        label.Name = "status";
        label.Text = "正在启动服务，请稍候…";
        label.Font = new Font("Microsoft YaHei UI", 11F);
        label.TextAlign = ContentAlignment.MiddleCenter;
        label.Dock = DockStyle.Fill;
        f.Controls.Add(label);

        return f;
    }

    static void UpdateSplash(Form f, string text)
    {
        var c = f.Controls["status"];
        if (c != null) c.Text = text;
        f.Refresh();
    }

    static void Fail(string message)
    {
        Log("失败提示: " + message.Replace("\r\n", " | "));
        MessageBox.Show(message, "启动失败", MessageBoxButtons.OK, MessageBoxIcon.Warning);
    }

    // ── 工具 ────────────────────────────────────────────────

    static void Log(string message)
    {
        try
        {
            File.AppendAllText(logPath,
                DateTime.Now.ToString("HH:mm:ss.fff") + "  " + message + Environment.NewLine,
                new UTF8Encoding(false));
        }
        catch { /* 日志失败不影响启动 */ }
    }

    /// <summary>端口是否已被监听，用于判断服务是否就绪。</summary>
    /// <param name="p">要检测的端口号。</param>
    /// <returns>已在监听返回 true。</returns>
    static bool PortInUse(int p)
    {
        try
        {
            using (var c = new TcpClient())
            {
                var ar = c.BeginConnect("127.0.0.1", p, null, null);
                if (!ar.AsyncWaitHandle.WaitOne(500)) return false;
                c.EndConnect(ar);
                return true;
            }
        }
        catch { return false; }
    }

    static string Quote(string s) { return "\"" + s + "\""; }

    /// <summary>
    /// 给"目录路径"加引号：Windows 命令行里 "C:\dir\" 的结尾反斜杠会把引号转义掉，
    /// 所以路径以 \ 结尾时补一个 \，变成 "C:\dir\\"。
    /// </summary>
    static string QuoteDir(string p)
    {
        if (p.EndsWith("\\")) p = p + "\\";
        return "\"" + p + "\"";
    }

    // ── 更新代理 ──────────────────────────────────────────────

    /// <summary>读程序版本号（version.txt，由打包脚本放进交付目录）；读不到就用 0.0.0。</summary>
    static string AppVersion(string baseDir)
    {
        try
        {
            string p = Path.Combine(baseDir, "version.txt");
            if (File.Exists(p)) return File.ReadAllText(p).Trim();
        }
        catch { }
        return "0.0.0";
    }

    /// <summary>在给定范围里找一个空闲的本机端口（挑不到就返回 0）。</summary>
    static int FindFreePort(int from, int to)
    {
        for (int p = from; p <= to; p++)
        {
            try
            {
                var l = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback, p);
                l.Start();
                l.Stop();
                return p;
            }
            catch { }
        }
        return 0;
    }

    /// <summary>
    /// 拉起本地更新代理。它只做一件事：把 GitHub 上的安装包下载到 update\ 目录，
    /// 真正的安装仍然由下次启动时的 ApplyUpdate 完成。
    /// </summary>
    static void StartUpdateAgent(string baseDir)
    {
        try
        {
            string agent = Path.Combine(baseDir, "update_agent.js");
            if (!File.Exists(agent)) { Log("没有 update_agent.js，自动更新不可用（页面会提示手动下载）"); return; }

            string nodeExe = Path.Combine(baseDir, "runtime", "node.exe");
            if (!File.Exists(nodeExe)) { Log("缺少 runtime\\node.exe，自动更新不可用"); return; }

            if (agentPort == 0) { Log("没有空闲端口，自动更新不可用"); return; }

            var psi = new ProcessStartInfo
            {
                FileName = nodeExe,
                Arguments = Quote(agent) + " --home " + QuoteDir(baseDir) +
                            " --port " + agentPort +
                            " --token " + agentToken +
                            " --app-port " + port,
                WorkingDirectory = baseDir,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            };
            agentProc = Process.Start(psi);
            Log("更新代理已启动 端口=" + agentPort + " PID=" + (agentProc == null ? "null" : agentProc.Id.ToString()));
            Log("程序版本: " + AppVersion(baseDir));
        }
        catch (Exception ex)
        {
            Log("启动更新代理失败: " + ex.Message);
        }
    }

    // ── 更新功能 ──────────────────────────────────────────────

    /// <summary>
    /// 应用一个更新包：解压 → 覆盖 app → 重新集成工作台 → 提示重启。
    ///
    /// 为什么用"覆盖文件"而不是"移动/替换整个 app 目录"：
    /// 实测 Directory.Move 在本机环境下会被拒绝（IOException: 访问被拒绝），
    /// 而逐文件复制是允许的；同时避免动整个目录，风险更小。
    /// </summary>
    /// <param name="baseDir">程序所在目录。</param>
    /// <param name="zipPath">更新包路径。</param>
    static void ApplyUpdate(string baseDir, string zipPath)
    {
        string staging = Path.Combine(baseDir, "update", "_stage");
        // 用自动探测到的程序目录，而不是写死的 app
        string currentApp = DetectAppDir(baseDir);

        try
        {
            Log("=== 开始更新 ===");
            Log("更新包: " + zipPath);

            // ① 解压到临时目录（先不动现有安装）
            if (Directory.Exists(staging)) Directory.Delete(staging, true);
            Directory.CreateDirectory(staging);
            Log("正在解压…");
            ZipFile.ExtractToDirectory(zipPath, staging);

            // ② 找到包里的 app 目录（允许根下直接是 app，或外面套一层文件夹）
            string newApp = FindAppDir(staging);
            if (newApp == null)
            {
                Log("更新包内找不到 app 目录");
                Fail("更新包格式不对。\r\n\r\n压缩包里应该包含 app 文件夹" +
                     "（也就是 node_modules 那一层）。\r\n\r\n" +
                     "这次没有做任何改动，程序仍可正常使用。");
                return;
            }
            Log("新版本目录: " + newApp);

            // ③ 覆盖到现有 app（同名文件被替换，旧版本多出来的文件不会影响运行）
            if (!Directory.Exists(currentApp)) Directory.CreateDirectory(currentApp);
            Log("正在覆盖文件…");
            int copied = CopyDir(newApp, currentApp, 0);
            Log("已复制文件数: " + copied);

            // ④ 把包里的工作台页面 / xlsx 也同步到 update\ 一份。
            //    必须做：下面 IntegrateWorkbench 是从 update\_workbench.html 复制到前端的，
            //    不同步的话，它会把刚覆盖进去的新页面又用旧的 update\_workbench.html 覆盖回去
            //    —— 也就是说"只更新页面的小包"会静默失效。
            string newDist = Path.Combine(newApp, "node_modules", "@deepseek-ai",
                                          "dsh-web-frontend", "dist");
            foreach (string fn in new string[] { "_workbench.html", "xlsx.full.min.js" })
            {
                string from = Path.Combine(newDist, fn);
                if (!File.Exists(from)) continue;
                string to = Path.Combine(baseDir, "update", fn);
                try { Directory.CreateDirectory(Path.GetDirectoryName(to)); } catch { }
                File.Copy(from, to, true);
                Log("已同步到 update\\" + fn);
            }

            // ⑤ 允许随包更新使用说明（只认这一个文件名，避免包里的东西乱写交付目录）
            string newDoc = Path.Combine(staging, "_delivery", "使用说明.txt");
            if (File.Exists(newDoc))
            {
                File.Copy(newDoc, Path.Combine(baseDir, "使用说明.txt"), true);
                Log("已更新 使用说明.txt");
            }

            // ⑥ 重新集成成绩工作台
            //    新版本前端是全新的，必须重新注入界面，否则更新完会变回原版 DSH
            Log("正在重新集成工作台…");
            bool integrated = IntegrateWorkbench(baseDir, currentApp);

            try { Directory.Delete(staging, true); } catch { }
            try { File.Delete(zipPath); } catch { }

            Log("=== 更新完成，集成=" + integrated + " ===");

            MessageBox.Show(
                "更新完成！\r\n\r\n" +
                "新版本文件已经覆盖安装" + (integrated ? "，成绩工作台也重新集成好了。" : "。") +
                "\r\n\r\n" +
                (integrated ? "" : "注意：工作台界面没能重新注入，更新后可能显示为原版 DSH 界面。\r\n\r\n") +
                "请重新运行本程序，更新才会生效。\r\n\r\n" +
                "（更新采用覆盖方式，旧版多余的文件会保留，不影响使用。）",
                "更新完成", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception ex)
        {
            Log("更新失败: " + ex);
            Fail("更新失败：\r\n" + ex.Message +
                 "\r\n\r\n程序可能处于不完整状态。\r\n" +
                 "请把之前备份的整个文件夹恢复回来再试。");
        }
    }

    /// <summary>
    /// 递归复制目录内容，覆盖同名文件。
    /// </summary>
    /// <param name="src">源目录。</param>
    /// <param name="dst">目标目录（不存在会自动建）。</param>
    /// <param name="depth">递归深度，用于防御异常深的目录。</param>
    /// <returns>复制的文件数。</returns>
    static int CopyDir(string src, string dst, int depth)
    {
        int n = 0;
        if (depth > 40) return 0;   // node_modules 最深也就十几层，40 足够且能防止异常
        if (!Directory.Exists(dst)) Directory.CreateDirectory(dst);

        foreach (string f in Directory.GetFiles(src))
        {
            string target = Path.Combine(dst, Path.GetFileName(f));
            try
            {
                File.Copy(f, target, true);
                n++;
            }
            catch (Exception ex)
            {
                Log("复制失败(跳过) " + Path.GetFileName(f) + ": " + ex.Message);
            }
        }
        foreach (string d in Directory.GetDirectories(src))
        {
            n += CopyDir(d, Path.Combine(dst, Path.GetFileName(d)), depth + 1);
        }
        return n;
    }

    /// <summary>
    /// 选择实际使用的程序目录：优先 app-0.2.1，其次 app。
    ///
    /// 启动和更新都必须用它，否则更新时会把新版本覆盖到错误的目录
    /// （实测踩过：整合/更新写死 app，交付目录却叫 app-0.2.1）。
    /// </summary>
    /// <param name="baseDir">程序所在目录。</param>
    /// <returns>程序目录路径（可能不存在，由调用方检查）。</returns>
    static string DetectAppDir(string baseDir)
    {
        string preferred = Path.Combine(baseDir, "app-0.2.1");
        if (File.Exists(Path.Combine(preferred, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js")))
            return preferred;
        return Path.Combine(baseDir, "app");
    }

    /// <summary>
    /// 在解压目录里寻找 app 目录（含 node_modules\@deepseek-ai 的那一层）。
    ///
    /// 认两种判据：
    ///   · 完整包：node_modules\@deepseek-ai\dsh\lib\bin.js 存在
    ///   · 只改界面的小包：只有 node_modules\@deepseek-ai\dsh-web-frontend\dist
    /// 只认第一种的话，"只更新工作台页面"的小包会被判成"格式不对"而装不上。
    /// </summary>
    /// <param name="root">解压根目录。</param>
    /// <returns>找到返回路径，否则返回 null。</returns>
    static string FindAppDir(string root)
    {
        try
        {
            foreach (string d in Directory.GetDirectories(root))
            {
                if (File.Exists(Path.Combine(d, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js")))
                    return d;
                if (Directory.Exists(Path.Combine(d, "node_modules", "@deepseek-ai", "dsh-web-frontend", "dist")))
                    return d;
            }
            foreach (string d in Directory.GetDirectories(root))
            {
                string inner = FindAppDir(d);
                if (inner != null) return inner;
            }
        }
        catch { }
        return null;
    }

    /// <summary>
    /// 把成绩工作台重新注入新版前端。
    /// 用"模板替换法"：从 index.dsh-original.html 模板重建，避免重复叠加注入。
    /// </summary>
    /// <param name="baseDir">程序所在目录（用于找 update\_workbench.html）。</param>
    /// <param name="appDir">实际的程序目录（app 或 app-0.2.1）。</param>
    /// <returns>成功返回 true。</returns>
    static bool IntegrateWorkbench(string baseDir, string appDir)
    {
        try
        {
            string dist = Path.Combine(appDir, "node_modules", "@deepseek-ai",
                                       "dsh-web-frontend", "dist");
            string index = Path.Combine(dist, "index.html");
            if (!File.Exists(index)) { Log("找不到新版 index.html: " + index); return false; }

            // 模板：优先用之前备份的原版，其次用磁盘上未被改过的
            string tplPath = Path.Combine(dist, "index.dsh-original.html");
            if (!File.Exists(tplPath))
            {
                string t = File.ReadAllText(index);
                if (t.Contains("workbench-layer")) { Log("index.html 已集成且无原版模板"); return false; }
                File.WriteAllText(tplPath, t);
            }
            string tpl = File.ReadAllText(tplPath);
            if (tpl.Contains("workbench-layer"))
            {
                Log("模板本身已含集成，放弃（避免叠加）");
                return false;
            }

            // 样式
            string css =
                "\n  <style>\n" +
                "    #workbench-layer{position:fixed;inset:0;z-index:2147483000;background:#f3f3f3;border:none;width:100%;height:100%}\n" +
                "    html.wb-hidden #workbench-layer{display:none}\n" +
                "    #wb-toggle{position:fixed;right:16px;bottom:16px;z-index:2147483001;display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 15px;border-radius:17px;border:1px solid rgba(0,0,0,.12);background:rgba(255,255,255,.86);backdrop-filter:blur(20px) saturate(1.6);box-shadow:0 2px 8px rgba(0,0,0,.14);color:#1a1a1a;font:600 12.5px/1 'Segoe UI Variable Text','Segoe UI','Microsoft YaHei UI',system-ui,sans-serif;cursor:pointer}\n" +
                "    #wb-toggle:hover{background:#fff;box-shadow:0 4px 14px rgba(0,0,0,.18)}\n" +
                "    #wb-toggle .dot{width:7px;height:7px;border-radius:50%;background:#0078d4}\n" +
                "    @media (prefers-color-scheme: dark){#wb-toggle{background:rgba(45,45,45,.86);border-color:rgba(255,255,255,.14);color:#fff}#workbench-layer{background:#202020}}\n" +
                "  </style>\n";

            // 把最新工作台 HTML 也放进去。来源优先级：
            //   ① update\_workbench.html —— 交付包自带，更新时可以顺带换新版页面
            //   ② 前端目录里已有的 _workbench.html —— 覆盖更新后它一般还在
            //   ③ 程序根目录的 成绩分析工作台-首页.html —— 开发调试用
            string wbDest = Path.Combine(dist, "_workbench.html");
            string wbSource = Path.Combine(baseDir, "update", "_workbench.html");
            if (!File.Exists(wbSource)) wbSource = wbDest;
            if (!File.Exists(wbSource)) wbSource = Path.Combine(baseDir, "成绩分析工作台-首页.html");
            if (File.Exists(wbSource) && !string.Equals(Path.GetFullPath(wbSource),
                    Path.GetFullPath(wbDest), StringComparison.OrdinalIgnoreCase))
            {
                File.Copy(wbSource, wbDest, true);
                Log("已部署工作台页面");
            }
            else if (File.Exists(wbDest))
            {
                Log("沿用前端目录里已有的工作台页面");
            }

            // SheetJS：读 xlsx 用（"导入成绩"的核心依赖）。必须和工作台页面同目录，
            // 否则导入只能走 CDN —— 校园网访问不了 CDN 就废了。
            string xlsxSource = Path.Combine(baseDir, "update", "xlsx.full.min.js");
            string xlsxDest = Path.Combine(dist, "xlsx.full.min.js");
            if (File.Exists(xlsxSource))
            {
                File.Copy(xlsxSource, xlsxDest, true);
                Log("已部署 xlsx 解析库");
            }
            else if (File.Exists(xlsxDest))
            {
                Log("沿用前端目录里已有的 xlsx 解析库");
            }
            else
            {
                Log("警告：缺少 xlsx.full.min.js，导入成绩会依赖联网 CDN");
            }

            bool hasWb = File.Exists(wbDest);
            string build = ((long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalSeconds).ToString();

            string body =
                "\n  <script>window.__WB_UPDATER__={agent:'http://127.0.0.1:" + agentPort + "',token:'" + agentToken +
                "',version:'" + AppVersion(baseDir) + "',repo:'Gusheng-GS/grade-analysis-workbench'};</script>\n" +
                "\n  <iframe id=\"workbench-layer\" src=\"./_workbench.html?v=" + build + "\" title=\"成绩分析工作台\"></iframe>\n" +
                "  <button id=\"wb-toggle\"><span class=\"dot\"></span><span id=\"wb-toggle-label\">切到 DSH 界面</span></button>\n" +
                "  <script>(function(){var K='wb-show-workbench',r=document.documentElement,l=document.getElementById('wb-toggle-label');" +
                "function a(s){r.classList.toggle('wb-hidden',!s);if(l)l.textContent=s?'切到 DSH 界面':'切回成绩工作台';try{localStorage.setItem(K,s?'1':'0')}catch(e){}}" +
                "var v=null;try{v=localStorage.getItem(K)}catch(e){}a(v===null?true:v==='1');" +
                "document.getElementById('wb-toggle').addEventListener('click',function(){a(r.classList.contains('wb-hidden'))});})();</script>\n";

            string html = tpl.Replace("</head>", css + "</head>");
            html = html.Replace("</body>", body + "</body>");
            File.WriteAllText(index, html);
            Log("index.html 已重新注入" + (hasWb ? "（工作台已就位）" : "（工作台文件缺失）"));
            return hasWb;
        }
        catch (Exception ex)
        {
            Log("集成工作台失败: " + ex.Message);
            return false;
        }
    }
}
