import { DiscordBot } from "./discord";
import { RevoltBot } from "./revolt";
import { IStorage } from "../storage";
import { Bridge } from "@shared/schema";
import { Message as RevoltMessage } from "revolt.js";
import { Message as DiscordMessage } from "discord.js";

let discordBot: DiscordBot | null = null;
let revoltBot: RevoltBot | null = null;

export async function initializeBridge(storage: IStorage) {
  try {
    const settings = await storage.getSettings();

    storage.createLog({
      timestamp: new Date().toISOString(),
      level: "info",
      message: "Attempting to initialize bridge with settings",
      metadata: {
        discordTokenPresent: !!settings.discordToken,
        revoltTokenPresent: !!settings.revoltToken
      }
    });

    if (!settings.discordToken || !settings.revoltToken) {
      storage.createLog({
        timestamp: new Date().toISOString(),
        level: "error",
        message: "Bot tokens not configured",
        metadata: {
          discordTokenSet: !!settings.discordToken,
          revoltTokenSet: !!settings.revoltToken
        }
      });
      return;
    }

    discordBot = new DiscordBot(settings.discordToken);
    revoltBot = new RevoltBot(settings.revoltToken);

    discordBot.onMessage(async (message: DiscordMessage, bridge: Bridge) => {
      if (!bridge.enabled || !revoltBot) return;

      try {
        const masquerades = await storage.getMasquerades(bridge.id);
        const masquerade = masquerades.find(m => m.userId === message.author.id);

        // メッセージ内容の処理
        let content = message.content || "";

        // 添付ファイルの処理
        const attachments = Array.from(message.attachments.values());
        const imageAttachments = attachments.filter(att => 
          att.contentType?.startsWith('image/') || att.url.match(/\.(jpg|jpeg|png|gif|webp)$/i)
        );

        // 画像が添付されている場合、URLをメッセージに追加
        if (imageAttachments.length > 0) {
          const attachmentLinks = imageAttachments.map(att => att.url);
          if (content) content += "\n\n";
          content += "添付画像:\n" + attachmentLinks.join("\n");
        }

        // メッセージを送信
        await revoltBot.sendMessage(
          bridge.revoltChannelId,
          content,
          {
            username: masquerade?.username || message.author.username,
            avatarUrl: masquerade?.avatar || message.author.displayAvatarURL()
          }
        );

        storage.createLog({
          timestamp: new Date().toISOString(),
          level: "info",
          message: "Successfully relayed Discord message to Revolt",
          metadata: { 
            messageId: message.id,
            attachmentCount: imageAttachments.length
          }
        });
      } catch (error) {
        storage.createLog({
          timestamp: new Date().toISOString(),
          level: "error",
          message: "Failed to relay Discord message to Revolt",
          metadata: { 
            error: (error as Error).message,
            messageId: message.id,
            stack: (error as Error).stack
          }
        });
      }
    });

    revoltBot.onMessage(async (message: RevoltMessage, bridge: Bridge) => {
      if (!bridge.enabled || !discordBot || !message.author) return;

      try {
        let avatarUrl: string | null = null;
        if (message.author?.avatar?._id) {
          avatarUrl = `https://autumn.revolt.chat/avatars/${message.author.avatar._id}`;
        }

        const masquerades = await storage.getMasquerades(bridge.id);
        const masquerade = masquerades.find(m => m.userId === message.author?._id);

        const username = masquerade?.username || message.author?.username || "Unknown User";

        // Generate attachment links for Revolt
        const attachmentLinks = message.attachments?.map(att => 
          `https://autumn.revolt.chat/attachments/${att._id}`
        ) || [];

        // Combine content and attachment links
        let contentWithLinks = message.content || "";
        if (attachmentLinks.length > 0) {
          contentWithLinks += "\n" + attachmentLinks.join("\n");
        }

        // Send message to Discord
        await discordBot.sendMessage(
          bridge.discordChannelId,
          contentWithLinks,
          {
            username: username,
            avatarUrl: masquerade?.avatar || avatarUrl
          }
        );

        storage.createLog({
          timestamp: new Date().toISOString(),
          level: "info",
          message: "Successfully relayed Revolt message to Discord",
          metadata: { 
            messageId: message._id,
            attachmentCount: attachmentLinks.length
          }
        });
      } catch (error) {
        storage.createLog({
          timestamp: new Date().toISOString(),
          level: "error",
          message: "Failed to relay Revolt message to Discord",
          metadata: { 
            error: (error as Error).message,
            messageId: message._id,
            stack: (error as Error).stack
          }
        });
      }
    });

    await storage.clearErrorLogs();

    storage.createLog({
      timestamp: new Date().toISOString(),
      level: "info",
      message: "Bridge initialized successfully"
    });
  } catch (error) {
    storage.createLog({
      timestamp: new Date().toISOString(),
      level: "error",
      message: "Failed to initialize bridge",
      metadata: { 
        error: (error as Error).message,
        stack: (error as Error).stack
      }
    });
  }
}