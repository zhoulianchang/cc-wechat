import type { WechatApiOptions } from "../wechat/api.js";
import { sendTextMessage, sendTyping } from "../wechat/api.js";
import { logger } from "../utils/logger.js";
import { TypingStatus } from "../wechat/types.js";
import type { StreamEvent } from "./cli.js";

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
  return async (event: StreamEvent): Promise<void> => {
    try {
      if (event.type === "tool_use_start") {
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
          text: formatToolSummary(event.toolName, event.toolInput),
          contextToken,
        });
      }

      if (event.type === "thinking_delta") {
        const thinking = event.thinking.slice(0, THINKING_PREVIEW_LENGTH);
        if (thinking) {
          await sendTextMessage({
            ...apiOpts,
            toUserId,
            text: `💭 ${thinking}...`,
            contextToken,
          });
        }
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
