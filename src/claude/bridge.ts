import { randomUUID } from "node:crypto";
import { logger } from "../utils/logger.js";

export type PermissionMode = "default" | "acceptEdits" | "plan" | "auto";

export interface ApprovalRequest {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface ClaudeSessionConfig {
  workingDir: string;
  model: string;
  permissionMode: PermissionMode;
  systemPrompt?: string;
}

export interface ClaudeSession {
  sessionId: string;
  sdkSessionId: string;
  config: ClaudeSessionConfig;
  pendingApproval: ApprovalRequest | null;
  history: Array<{ role: "user" | "assistant"; text: string }>;
  abortController: AbortController | null;
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
    sdkSessionId: "",
    config: { ...defaults },
    pendingApproval: null,
    history: [],
    abortController: null,
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
  if (session?.abortController) {
    session.abortController.abort();
  }
  if (session?.pendingApproval) {
    clearTimeout(session.pendingApproval.timer);
    session.pendingApproval.resolve(false);
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
  const { query } = await import("@anthropic-ai/claude-agent-sdk");

  session.abortController = new AbortController();
  session.history.push({ role: "user", text: userMessage });

  let finalText = "";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const queryOpts: any = {
    prompt: userMessage,
    options: {
      model: session.config.model,
      cwd: session.config.workingDir,
      permissionMode:
        session.config.permissionMode === "auto"
          ? ("bypassPermissions" as const)
          : (session.config.permissionMode as "default" | "acceptEdits" | "plan"),
      includePartialMessages: true,
      abortController: session.abortController,
      settingSources: ["project"],
    },
  };

  if (session.config.systemPrompt) {
    queryOpts.options.systemPrompt = {
      type: "preset",
      preset: "claude_code",
      append: session.config.systemPrompt,
    };
  }

  if (session.sdkSessionId) {
    queryOpts.options.resume = session.sdkSessionId;
  }

  if (session.config.permissionMode === "auto") {
    queryOpts.options.allowDangerouslySkipPermissions = true;
  } else {
    queryOpts.options.canUseTool = async (
      toolName: string,
      input: Record<string, unknown>,
    ) => {
      return new Promise<{
        behavior: "allow" | "deny";
        message?: string;
        updatedInput?: Record<string, unknown>;
      }>((resolve) => {
        const approvalId = randomUUID();
        const timer = setTimeout(() => {
          session.pendingApproval = null;
          resolve({ behavior: "deny", message: "审批超时（120s），自动拒绝" });
        }, 120_000);

        session.pendingApproval = {
          id: approvalId,
          toolName,
          input,
          resolve: (approved: boolean) => {
            session.pendingApproval = null;
            if (approved) {
              resolve({ behavior: "allow", updatedInput: input });
            } else {
              resolve({ behavior: "deny", message: "用户拒绝" });
            }
          },
          timer,
        };

        onEvent({
          type: "permission_request",
          toolName,
          input,
          approvalId,
        });
      });
    };
  }

  try {
    for await (const message of query(queryOpts)) {
      const msg = message as Record<string, unknown>;
      const type = msg.type as string;

      if (type === "system" && msg.subtype === "init") {
        session.sdkSessionId = msg.session_id as string;
      }

      if (type === "stream_event") {
        await onEvent(msg);
      }

      if (type === "assistant") {
        const content = msg.message as {
          content?: Array<{ type: string; text?: string }>;
        };
        if (content?.content) {
          const text = content.content
            .filter((b) => b.type === "text")
            .map((b) => b.text ?? "")
            .join("");
          if (text) finalText = text;
        }
      }

      if (type === "result") {
        const subtype = msg.subtype as string;
        if (subtype === "success") {
          finalText = (msg.result as string) || finalText;
        }
      }
    }
  } catch (err) {
    logger.error(`Claude query error: ${String(err)}`);
    finalText = `Claude 执行出错: ${String(err)}`;
  } finally {
    session.abortController = null;
  }

  if (finalText) {
    session.history.push({ role: "assistant", text: finalText });
  }

  return finalText;
}

export function abortSession(key: string): boolean {
  const session = sessions.get(key);
  if (!session?.abortController) return false;
  session.abortController.abort();
  session.abortController = null;
  return true;
}

export function resolveApproval(key: string, approved: boolean): boolean {
  const session = sessions.get(key);
  if (!session?.pendingApproval) return false;
  clearTimeout(session.pendingApproval.timer);
  session.pendingApproval.resolve(approved);
  session.pendingApproval = null;
  return true;
}
