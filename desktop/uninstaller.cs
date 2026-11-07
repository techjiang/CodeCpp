using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class CodeCppUninstaller
{
    private const string Key = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\CodeCpp";

    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        string dir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        DialogResult answer = MessageBox.Show(
            "Uninstall CodeCpp?\n\n" + dir,
            "CodeCpp Uninstall", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
        if (answer != DialogResult.Yes) return;

        try { Registry.CurrentUser.DeleteSubKeyTree(Key, false); } catch { }
        try
        {
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            string menuDir = Path.Combine(appData, @"Microsoft\Windows\Start Menu\Programs\CodeCpp");
            if (Directory.Exists(menuDir)) Directory.Delete(menuDir, true);
            string desktop = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "CodeCpp.lnk");
            if (File.Exists(desktop)) File.Delete(desktop);
        }
        catch { }

        try
        {
            Process.Start("cmd.exe", "/c timeout /t 2 /nobreak >nul & rmdir /s /q \"" + dir + "\"");
            MessageBox.Show("CodeCpp has been uninstalled.", "CodeCpp",
                MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception ex)
        {
            MessageBox.Show("Could not remove all files: " + ex.Message, "CodeCpp",
                MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }
}
