import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import os from "node:os";

const LAUNCHD_LABEL = "com.cc-wechat.daemon";
const PLIST_PATH = path.join(
  os.homedir(),
  "Library",
  "LaunchAgents",
  `${LAUNCHD_LABEL}.plist`,
);

function plistContent(nodePath: string, scriptPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${scriptPath}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardErrorPath</key>
  <string>${path.join(os.homedir(), ".cc-wechat", "logs", "daemon-stderr.log")}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
  </dict>
</dict>
</plist>`;
}

export function installDaemon(): void {
  const nodePath = process.execPath;
  const scriptPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    "index.js",
  );

  const plist = plistContent(nodePath, scriptPath);
  fs.mkdirSync(path.dirname(PLIST_PATH), { recursive: true });
  fs.writeFileSync(PLIST_PATH, plist, "utf-8");

  execSync(`launchctl load ${PLIST_PATH}`);
  console.log("✅ 守护进程已安装（launchd）");
}

export function uninstallDaemon(): void {
  if (fs.existsSync(PLIST_PATH)) {
    try {
      execSync(`launchctl unload ${PLIST_PATH}`);
    } catch {
      // may not be loaded
    }
    fs.unlinkSync(PLIST_PATH);
  }
  console.log("✅ 守护进程已卸载");
}

export function daemonStatus(): void {
  try {
    const output = execSync(
      `launchctl list | grep ${LAUNCHD_LABEL}`,
      { encoding: "utf-8" },
    );
    console.log(`守护进程运行中:\n${output}`);
  } catch {
    console.log("守护进程未运行");
  }
}

export function restartDaemon(): void {
  uninstallDaemon();
  installDaemon();
  console.log("✅ 守护进程已重启");
}