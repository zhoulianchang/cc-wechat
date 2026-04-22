import {
  installDaemon,
  uninstallDaemon,
  daemonStatus,
  restartDaemon,
} from "./launchd.js";

const command = process.argv[2];

switch (command) {
  case "start":
    installDaemon();
    break;
  case "stop":
    uninstallDaemon();
    break;
  case "restart":
    restartDaemon();
    break;
  case "status":
    daemonStatus();
    break;
  case "logs":
    console.log(
      "查看日志: tail -f ~/.cc-wechat/logs/cc-wechat-$(date +%Y-%m-%d).log",
    );
    break;
  default:
    console.log(
      "用法: npm run daemon -- <start|stop|restart|status|logs>",
    );
    process.exit(1);
}