using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class CodeCppSetup
{
    internal const string Version = "1.0.0";
    internal const string Payload = "CodeCpp.Payload.zip";
    internal const string Uninstaller = "CodeCpp.Uninstaller.exe";
    internal const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\CodeCpp";

    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new SetupForm());
    }
}

internal class SetupForm : Form
{
    private readonly TextBox dirBox = new TextBox();
    private readonly Button browseBtn = new Button();
    private readonly Button installBtn = new Button();
    private readonly Button cancelBtn = new Button();
    private readonly CheckBox desktopCheck = new CheckBox();
    private readonly ProgressBar bar = new ProgressBar();
    private readonly Label status = new Label();
    private bool installing;

    public SetupForm()
    {
        Text = "CodeCpp " + CodeCppSetup.Version + " 安装程序";
        Size = new Size(560, 300);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Microsoft YaHei", 9F);

        Label title = new Label
        {
            Text = "CodeCpp · 面向 C 语言的桌面集成开发环境",
            Font = new Font("Microsoft YaHei", 12F, FontStyle.Bold),
            AutoSize = true, Location = new Point(20, 18)
        };
        Label sub = new Label
        {
            Text = "同一个世界，同一个互联网！   作者：科技酱   https://www.asoe.cn",
            AutoSize = true, Location = new Point(20, 48), ForeColor = Color.Gray
        };
        Label pathLabel = new Label { Text = "安装目录：", AutoSize = true, Location = new Point(20, 84) };
        dirBox.Location = new Point(20, 106);
        dirBox.Width = 410;
        dirBox.Text = DefaultDir();
        browseBtn.Text = "浏览...";
        browseBtn.Location = new Point(438, 104);
        browseBtn.Width = 90;
        browseBtn.Click += delegate { Browse(); };
        desktopCheck.Text = "创建桌面快捷方式";
        desktopCheck.Checked = true;
        desktopCheck.AutoSize = true;
        desktopCheck.Location = new Point(20, 140);
        bar.Location = new Point(20, 174);
        bar.Width = 508;
        bar.Height = 18;
        bar.Minimum = 0;
        bar.Maximum = 100;
        status.Text = "准备就绪";
        status.AutoSize = true;
        status.Location = new Point(20, 200);
        status.ForeColor = Color.Gray;
        installBtn.Text = "安装";
        installBtn.Location = new Point(340, 228);
        installBtn.Width = 90;
        installBtn.Click += delegate { StartInstall(); };
        cancelBtn.Text = "取消";
        cancelBtn.Location = new Point(438, 228);
        cancelBtn.Width = 90;
        cancelBtn.Click += delegate { Close(); };

        Controls.Add(title);
        Controls.Add(sub);
        Controls.Add(pathLabel);
        Controls.Add(dirBox);
        Controls.Add(browseBtn);
        Controls.Add(desktopCheck);
        Controls.Add(bar);
        Controls.Add(status);
        Controls.Add(installBtn);
        Controls.Add(cancelBtn);
        AcceptButton = installBtn;
    }

    private static string DefaultDir()
    {
        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Programs", "CodeCpp");
    }

    private void Browse()
    {
        using (FolderBrowserDialog dialog = new FolderBrowserDialog())
        {
            dialog.Description = "选择 CodeCpp 的安装目录";
            string current = dirBox.Text.Trim();
            dialog.SelectedPath = Directory.Exists(current)
                ? current
                : Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            if (dialog.ShowDialog(this) == DialogResult.OK) dirBox.Text = dialog.SelectedPath;
        }
    }

    private void UI(Action action)
    {
        if (InvokeRequired) BeginInvoke(action);
        else action();
    }

    private void StartInstall()
    {
        string target = dirBox.Text.Trim();
        if (target.Length == 0)
        {
            MessageBox.Show(this, "请选择安装目录。", "CodeCpp", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        if (installing) return;
        installing = true;
        installBtn.Enabled = false;
        browseBtn.Enabled = false;
        dirBox.Enabled = false;
        desktopCheck.Enabled = false;
        bool desktop = desktopCheck.Checked;
        Thread worker = new Thread(() => Install(target, desktop));
        worker.IsBackground = true;
        worker.Start();
    }

    private void Install(string target, bool desktop)
    {
        try
        {
            UI(delegate { status.Text = "正在准备安装…"; bar.Value = 5; });
            if (Directory.Exists(target) && File.Exists(Path.Combine(target, "CodeCpp.exe")))
            {
                UI(delegate { status.Text = "正在移除旧版本…"; bar.Value = 12; });
                Directory.Delete(target, true);
            }
            Directory.CreateDirectory(target);

            UI(delegate { status.Text = "正在解压 CodeCpp（约需十几秒）…"; bar.Value = 25; });
            string tmp = Path.Combine(Path.GetTempPath(),
                "codecpp-payload-" + Guid.NewGuid().ToString("N") + ".zip");
            using (Stream src = Assembly.GetExecutingAssembly().GetManifestResourceStream(CodeCppSetup.Payload))
            {
                if (src == null) throw new Exception("安装包数据缺失，请重新下载完整的安装程序。");
                using (FileStream dst = new FileStream(tmp, FileMode.CreateNew, FileAccess.Write)) src.CopyTo(dst);
            }
            ZipFile.ExtractToDirectory(tmp, target);
            File.Delete(tmp);

            UI(delegate { status.Text = "正在创建快捷方式与卸载信息…"; bar.Value = 82; });
            string exe = Path.Combine(target, "CodeCpp.exe");
            string uninstallExe = Path.Combine(target, "CodeCpp.Uninstall.exe");
            using (Stream src = Assembly.GetExecutingAssembly().GetManifestResourceStream(CodeCppSetup.Uninstaller))
            using (FileStream dst = new FileStream(uninstallExe, FileMode.Create, FileAccess.Write))
            {
                if (src == null) throw new Exception("卸载组件缺失。");
                src.CopyTo(dst);
            }

            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            string menuDir = Path.Combine(appData, @"Microsoft\Windows\Start Menu\Programs\CodeCpp");
            Directory.CreateDirectory(menuDir);
            CreateShortcut(Path.Combine(menuDir, "CodeCpp.lnk"), exe, "CodeCpp - C 语言集成开发环境");
            CreateShortcut(Path.Combine(menuDir, "卸载 CodeCpp.lnk"), uninstallExe, "卸载 CodeCpp");
            if (desktop)
            {
                CreateShortcut(Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                    "CodeCpp.lnk"), exe, "CodeCpp");
            }
            WriteRegistry(target, uninstallExe, exe);

            UI(delegate
            {
                status.Text = "安装完成";
                bar.Value = 100;
                DialogResult run = MessageBox.Show(this,
                    "CodeCpp " + CodeCppSetup.Version + " 安装完成！\n\n作者：科技酱 · 同一个世界，同一个互联网！\n\n是否立即启动 CodeCpp？",
                    "安装完成", MessageBoxButtons.YesNo, MessageBoxIcon.Information);
                if (run == DialogResult.Yes && File.Exists(exe)) Process.Start(exe);
                Close();
            });
        }
        catch (Exception ex)
        {
            UI(delegate
            {
                status.Text = "安装失败";
                installBtn.Enabled = true;
                installing = false;
                MessageBox.Show(this, "安装失败：" + ex.Message, "CodeCpp",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
            });
        }
    }

    private static void CreateShortcut(string link, string target, string description)
    {
        try
        {
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            object shell = Activator.CreateInstance(shellType);
            object shortcut = shellType.InvokeMember("CreateShortcut",
                BindingFlags.InvokeMethod, null, shell, new object[] { link });
            Type scType = shortcut.GetType();
            scType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { target });
            scType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut,
                new object[] { Path.GetDirectoryName(target) });
            scType.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { description });
            scType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut,
                new object[] { target + ",0" });
            scType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
        }
        catch { }
    }

    private static void WriteRegistry(string target, string uninstallExe, string exe)
    {
        using (RegistryKey key = Registry.CurrentUser.CreateSubKey(CodeCppSetup.UninstallKey))
        {
            key.SetValue("DisplayName", "CodeCpp " + CodeCppSetup.Version);
            key.SetValue("DisplayVersion", CodeCppSetup.Version);
            key.SetValue("Publisher", "科技酱");
            key.SetValue("URLInfoAbout", "https://www.asoe.cn");
            key.SetValue("HelpLink", "https://docs.asoe.cn");
            key.SetValue("InstallLocation", target);
            key.SetValue("DisplayIcon", exe + ",0");
            key.SetValue("UninstallString", "\"" + uninstallExe + "\"");
            key.SetValue("NoModify", 1, RegistryValueKind.DWord);
            key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
        }
    }
}
