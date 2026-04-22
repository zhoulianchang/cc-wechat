import { loginWithQRCode } from "./wechat/auth.js";
import { saveGlobalConfig, loadGlobalConfig } from "./router/session.js";
import { logger } from "./utils/logger.js";
import * as readline from "node:readline";

async function main(): Promise<void> {
  console.log("cc-wechat 微信绑定设置\n");

  console.log("正在获取二维码...");
  const result = await loginWithQRCode();

  if (!result.success) {
    console.error(`登录失败: ${result.message}`);
    process.exit(1);
  }

  console.log(`\n✅ ${result.message}`);
  console.log(`账号 ID: ${result.accountId}`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const config = loadGlobalConfig();

  const workingDir = await new Promise<string>((resolve) => {
    rl.question(
      `工作目录 [${config.workingDir || process.cwd()}]: `,
      (answer) => {
        resolve(answer.trim() || config.workingDir || process.cwd());
      },
    );
  });

  config.workingDir = workingDir;
  saveGlobalConfig(config);
  rl.close();

  console.log(`\n✅ 设置完成！`);
  console.log(`工作目录: ${workingDir}`);
  console.log(`\n启动服务: npm start`);
  console.log(`守护进程: npm run daemon -- start`);
}

main().catch((err) => {
  logger.error(`Setup failed: ${String(err)}`);
  process.exit(1);
});