using System;
using System.Diagnostics;
using System.IO;

internal static class CodeCppLauncher
{
    [STAThread]
    private static void Main(string[] args)
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string electron = Path.Combine(root, "node_modules", "electron", "dist", "electron.exe");
        string entry = root.TrimEnd(Path.DirectorySeparatorChar);

        ProcessStartInfo info = new ProcessStartInfo();
        info.WorkingDirectory = root;
        info.UseShellExecute = false;
        info.CreateNoWindow = true;

        if (File.Exists(electron))
        {
            info.FileName = electron;
            info.Arguments = "\"" + entry + "\"" + JoinArgs(args);
        }
        else
        {
            info.FileName = "node";
            info.Arguments = "\"" + Path.Combine(root, "server", "index.js") + "\"" + JoinArgs(args);
        }

        try
        {
            Process.Start(info);
        }
        catch (Exception ex)
        {
            try
            {
                string data = Path.Combine(root, ".codecpp");
                Directory.CreateDirectory(data);
                File.WriteAllText(Path.Combine(data, "launcher-error.log"), ex.ToString());
            }
            catch (Exception)
            {
            }
        }
    }

    private static string JoinArgs(string[] args)
    {
        if (args == null || args.Length == 0) return "";
        string result = "";
        foreach (string item in args)
        {
            result += " \"" + item.Replace("\"", "\\\"") + "\"";
        }
        return result;
    }
}
