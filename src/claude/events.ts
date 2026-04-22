import type { WechatApiOptions } from "../wechat/api.js";
import { sendTextMessage, sendTyping } from "../wechat/api.js";
import { logger } from "../utils/logger.js";
import { TypingStatus } from "../wechat/types.js";

const MAX_MESSAGE_LENGTH = 4000;
const THINKING_PREVIEW_LENGTH = 300;

export function splitMessage(
  text: string,
  maxLength: number = MAX_MESSAGE_LENGTH,
): string[] {
  if (!text) return [];
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt <= 0) splitAt = maxLength;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}

const TOOL_EMOJI: Record<string, string> = {
  Bash: "🔧",
  Read: "📖",
  Write: "✏️",
  Edit: "📝",
  Glob: "🔍",
  Grep: "🔎",
  WebSearch: "🌐",
  WebFetch: "🌐",
};

function toolDisplay(name: string): string {
  return `${TOOL_EMOJI[name] ?? "🔧"} ${name}`;
}

export function formatToolSummary(
  toolName: string,
  input: Record<string, unknown>,
): string {
  switch (toolName) {
    case "Bash": {
      const cmd = String(input.command ?? "").slice(0, 100);
      return `${toolDisplay("Bash")} ${cmd}`;
    }
    case "Read":
      return `${toolDisplay("Read")} ${String(input.file_path ?? "")}`;
    case "Write":
      return `${toolDisplay("Write")} ${String(input.file_path ?? "")}`;
    case "Edit":
      return `${toolDisplay("Edit")} ${String(input.file_path ?? "")}`;
    case "Glob":
      return `${toolDisplay("Glob")} ${String(input.pattern ?? "")}`;
    case "Grep":
      return `${toolDisplay("Grep")} ${String(input.pattern ?? "")}`;
    default:
      return `${toolDisplay(toolName)}`;
  }
}

export function createEventHandler(
  apiOpts: WechatApiOptions,
  toUserId: string,
  contextToken: string | undefined,
  typingTicket: string | undefined,
) {
  return async (event: Record<string, unknown>): Promise<void> => {
    const eventType = event.type as string;

    try {
      if (eventType === "stream_event") {
        const rawEvent = event.event as Record<string, unknown>;
        const rawType = rawEvent?.type as string;

        if (rawType === "content_block_start") {
          const contentBlock = rawEvent.content_block as Record<string, unknown>;
          if (contentBlock?.type === "tool_use") {
            const toolName = contentBlock.name as string;
            const toolInput = (contentBlock.input ?? {}) as Record<string, unknown>;

            if (typingTicket) {
              await sendTyping({
                ...apiOpts,
                body: {
                  ilink_user_id: toUserId,
                  typing_ticket: typingTicket,
                  status: TypingStatus.TYPING,
                },
              });
            }

            await sendTextMessage({
              ...apiOpts,
              toUserId,
              text: formatToolSummary(toolName, toolInput),
              contextToken,
            });
          }
        }

        if (rawType === "content_block_delta") {
          const delta = rawEvent.delta as Record<string, unknown>;
          if (delta?.type === "thinking_delta") {
            const thinking = String(delta.thinking ?? "").slice(0, THINKING_PREVIEW_LENGTH);
            if (thinking) {
              await sendTextMessage({
                ...apiOpts,
                toUserId,
                text: `💭 ${thinking}...`,
                contextToken,
              });
            }
          }
        }
      }

      if (eventType === "permission_request") {
        const toolName = event.toolName as string;
        const input = (event.input ?? {}) as Record<string, unknown>;
        const summary = formatToolSummary(toolName, input);
        await sendTextMessage({
          ...apiOpts,
          toUserId,
          text: `🔑 权限请求: ${summary}\n\n回复 y 允许 / n 拒绝`,
          contextToken,
        });
      }
    } catch (err) {
      logger.error(`Event handler error: ${String(err)}`);
    }
  };
}

export async function sendFinalReply(
  apiOpts: WechatApiOptions,
  toUserId: string,
  text: string,
  contextToken?: string,
): Promise<void> {
  const chunks = splitMessage(text);
  for (const chunk of chunks) {
    await sendTextMessage({
      ...apiOpts,
      toUserId,
      text: chunk,
      contextToken,
    });
  }
}