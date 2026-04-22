import { randomUUID } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { logger } from "../utils/logger.js";
import { runClaudeCli, type PermissionMode, type StreamEvent } from "./cli.js";

export type { PermissionMode } from "./cli.js";

export interface ClaudeSessionConfig {
  workingDir: string;
  model: string;
  permissionMode: PermissionMode;
  systemPrompt?: string;
}

export interface ClaudeSession {
  sessionId: string;
  cliSessionId: string;
  config: ClaudeSessionConfig;
  history: Array<{ role: "user" | "assistant"; text: string }>;
  childProcess: ChildProcess | null;
}

const sessions = new Map<string, ClaudeSession>();

export function sessionKey(accountId: string, userId: string): string {
  return `${accountId}:${userId}`;
}

export function getOrCreateSession(
  key: string,
  defaults: ClaudeSessionConfig,
): ClaudeSession {
  const existing = sessions.get(key);
  if (existing) return existing;

  const session: ClaudeSession = {
    sessionId: randomUUID(),
    cliSessionId: "",
    config: { ...defaults },
    history: [],
    childProcess: null,
  };
  sessions.set(key, session);
  logger.info(`Session created: ${key}`);
  return session;
}

export function getSession(key: string): ClaudeSession | undefined {
  return sessions.get(key);
}

export function clearSession(key: string): void {
  const session = sessions.get(key);
  if (session?.childProcess) {
    session.childProcess.kill("SIGTERM");
  }
  sessions.delete(key);
  logger.info(`Session cleared: ${key}`);
}

export function updateSessionConfig(
  key: string,
  updates: Partial<ClaudeSessionConfig>,
): void {
  const session = sessions.get(key);
  if (!session) return;
  session.config = { ...session.config, ...updates };
}

export async function runClaudeQuery(
  session: ClaudeSession,
  userMessage: string,
  onEvent: (event: unknown) => Promise<void>,
): Promise<string> {
  session.history.push({ role: "user", text: userMessage });

  const result = await runClaudeCli(
    {
      prompt: userMessage,
      cwd: session.config.workingDir,
      model: session.config.model,
      permissionMode: session.config.permissionMode,
      sessionId: session.cliSessionId || undefined,
      systemPrompt: session.config.systemPrompt || undefined,
    },
    (evt: StreamEvent) => {
      onEvent(evt).catch((err) => {
        logger.error(`Event handler error: ${String(err)}`);
      });
    },
  );

  if (result.sessionId) {
    session.cliSessionId = result.sessionId;
  }

  if (result.finalText) {
    session.history.push({ role: "assistant", text: result.finalText });
  }

  return result.finalText;
}

export function abortSession(key: string): boolean {
  const session = sessions.get(key);
  if (!session?.childProcess) return false;
  session.childProcess.kill("SIGTERM");
  session.childProcess = null;
  return true;
}
