// server/index.ts
import express2 from "express";

// server/routes.ts
import { createServer } from "http";

// server/storage.ts
var MemStorage = class {
  bridges;
  masquerades;
  settings;
  logs;
  currentId;
  constructor() {
    this.bridges = /* @__PURE__ */ new Map();
    this.masquerades = /* @__PURE__ */ new Map();
    this.settings = null;
    this.logs = [];
    this.currentId = {
      bridges: 1,
      masquerades: 1,
      settings: 1,
      logs: 1
    };
  }
  // Bridge implementations
  async getBridges() {
    return Array.from(this.bridges.values());
  }
  async getBridge(id) {
    return this.bridges.get(id);
  }
  async createBridge(bridge) {
    const id = this.currentId.bridges++;
    const newBridge = {
      ...bridge,
      id,
      enabled: bridge.enabled ?? true
    };
    this.bridges.set(id, newBridge);
    return newBridge;
  }
  async updateBridge(id, bridge) {
    const existing = await this.getBridge(id);
    if (!existing) throw new Error("Bridge not found");
    const updated = { ...existing, ...bridge };
    this.bridges.set(id, updated);
    return updated;
  }
  async deleteBridge(id) {
    this.bridges.delete(id);
  }
  // Masquerade implementations
  async getMasquerades(bridgeId) {
    return Array.from(this.masquerades.values()).filter((m) => m.bridgeId === bridgeId);
  }
  async getMasquerade(id) {
    return this.masquerades.get(id);
  }
  async createMasquerade(masquerade) {
    const id = this.currentId.masquerades++;
    const newMasquerade = {
      ...masquerade,
      id,
      enabled: masquerade.enabled ?? true,
      avatar: masquerade.avatar ?? null
    };
    this.masquerades.set(id, newMasquerade);
    return newMasquerade;
  }
  async updateMasquerade(id, masquerade) {
    const existing = await this.getMasquerade(id);
    if (!existing) throw new Error("Masquerade not found");
    const updated = { ...existing, ...masquerade };
    this.masquerades.set(id, updated);
    return updated;
  }
  async deleteMasquerade(id) {
    this.masquerades.delete(id);
  }
  // Settings implementations
  async getSettings() {
    if (!this.settings) {
      const id = this.currentId.settings++;
      this.settings = {
        id,
        discordToken: "",
        revoltToken: "",
        webhookUrl: null,
        logLevel: "info"
      };
    }
    return this.settings;
  }
  async updateSettings(settings2) {
    if (!this.settings) {
      const id = this.currentId.settings++;
      this.settings = {
        id,
        discordToken: settings2.discordToken ?? "",
        revoltToken: settings2.revoltToken ?? "",
        webhookUrl: settings2.webhookUrl ?? null,
        logLevel: settings2.logLevel ?? "info"
      };
    } else {
      this.settings = {
        ...this.settings,
        ...settings2,
        webhookUrl: settings2.webhookUrl ?? this.settings.webhookUrl,
        logLevel: settings2.logLevel ?? this.settings.logLevel,
        discordToken: settings2.discordToken ?? this.settings.discordToken,
        revoltToken: settings2.revoltToken ?? this.settings.revoltToken
      };
    }
    return this.settings;
  }
  // Logs implementations
  async getLogs(limit = 100) {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1e3).toISOString();
    const recentLogs = this.logs.filter((log2) => log2.timestamp >= twentyFourHoursAgo);
    return recentLogs.slice(-limit);
  }
  async createLog(log2) {
    const id = this.currentId.logs++;
    const newLog = {
      ...log2,
      id,
      metadata: log2.metadata ?? null
    };
    this.logs.push(newLog);
    if (this.logs.length > 1e3) {
      this.logs = this.logs.slice(-1e3);
    }
    return newLog;
  }
  // 新しいメソッド: エラーログをクリア
  async clearErrorLogs() {
    const nonErrorLogs = this.logs.filter((log2) => log2.level !== "error");
    this.logs = nonErrorLogs;
  }
};
var storage = new MemStorage();

// shared/schema.ts
import { pgTable, text, serial, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
var bridges = pgTable("bridges", {
  id: serial("id").primaryKey(),
  discordChannelId: text("discord_channel_id").notNull(),
  revoltChannelId: text("revolt_channel_id").notNull(),
  enabled: boolean("enabled").notNull().default(true)
});
var masquerades = pgTable("masquerades", {
  id: serial("id").primaryKey(),
  bridgeId: integer("bridge_id").notNull(),
  userId: text("user_id").notNull(),
  username: text("username").notNull(),
  avatar: text("avatar_url"),
  enabled: boolean("enabled").notNull().default(true)
});
var settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  discordToken: text("discord_token").notNull(),
  revoltToken: text("revolt_token").notNull(),
  webhookUrl: text("webhook_url"),
  logLevel: text("log_level").notNull().default("info")
});
var logs = pgTable("logs", {
  id: serial("id").primaryKey(),
  timestamp: text("timestamp").notNull(),
  level: text("level").notNull(),
  message: text("message").notNull(),
  metadata: jsonb("metadata")
});
var insertBridgeSchema = createInsertSchema(bridges).omit({ id: true });
var insertMasqueradeSchema = createInsertSchema(masquerades).omit({ id: true });
var insertSettingsSchema = createInsertSchema(settings).omit({ id: true });
var insertLogSchema = createInsertSchema(logs).omit({ id: true });

// server/bot/discord.ts
import { Client, GatewayIntentBits, TextChannel, WebhookClient } from "discord.js";
var DiscordBot = class {
  client;
  webhooks = /* @__PURE__ */ new Map();
  ready = false;
  constructor(token) {
    storage.createLog({
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      level: "info",
      message: "Creating Discord bot instance"
    });
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
      ]
    });
    this.client.on("ready", () => {
      this.ready = true;
      storage.createLog({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        level: "info",
        message: "Discord bot ready",
        metadata: {
          username: this.client.user?.tag,
          id: this.client.user?.id
        }
      });
    });
    this.client.on("error", (error) => {
      storage.createLog({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        level: "error",
        message: "Discord bot error",
        metadata: { error: error.message }
      });
    });
    try {
      storage.createLog({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        level: "info",
        message: "Attempting Discord bot login"
      });
      this.client.login(token).catch((error) => {
        storage.createLog({
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          level: "error",
          message: "Discord bot login failed",
          metadata: { error: error.message }
        });
      });
    } catch (error) {
      storage.createLog({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        level: "error",
        message: "Discord bot initialization failed",
        metadata: { error: error.message }
      });
    }
  }
  async getWebhook(channelId) {
    try {
      if (this.webhooks.has(channelId)) {
        return this.webhooks.get(channelId) || null;
      }
      const channel = await this.client.channels.fetch(channelId);
      if (!(channel instanceof TextChannel)) {
        throw new Error("Invalid channel type");
      }
      const webhooks = await channel.fetchWebhooks();
      let webhook = webhooks.find((wh) => wh.owner?.id === this.client.user?.id);
      if (!webhook) {
        webhook = await channel.createWebhook({
          name: "Bridge Bot",
          avatar: this.client.user?.displayAvatarURL()
        });
      }
      const webhookClient = new WebhookClient({ url: webhook.url });
      this.webhooks.set(channelId, webhookClient);
      return webhookClient;
    } catch (error) {
      storage.createLog({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        level: "error",
        message: "Failed to get webhook",
        metadata: { error: error.message, channelId }
      });
      return null;
    }
  }
  async sendMessage(channelId, content, options = {}) {
    if (!this.ready) {
      storage.createLog({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        level: "error",
        message: "Attempted to send message before Discord bot was ready",
        metadata: { channelId }
      });
      throw new Error("Discord bot not ready");
    }
    try {
      const webhook = await this.getWebhook(channelId);
      if (webhook && options.username) {
        const webhookMessage = await webhook.send({
          content,
          username: options.username,
          avatarURL: options.avatarUrl || void 0,
          allowedMentions: { parse: [] }
        });
        storage.createLog({
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          level: "info",
          message: "Successfully sent Discord message via webhook",
          metadata: {
            messageId: webhookMessage.id,
            webhookId: webhookMessage.webhook_id,
            username: options.username,
            channelId
          }
        });
        return webhookMessage;
      } else {
        const channel = await this.client.channels.fetch(channelId);
        if (!(channel instanceof TextChannel)) {
          throw new Error("Invalid channel type");
        }
        const message = await channel.send({
          content,
          allowedMentions: { parse: [] }
        });
        storage.createLog({
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          level: "info",
          message: "Successfully sent Discord message via bot",
          metadata: { messageId: message.id }
        });
        return message;
      }
    } catch (error) {
      storage.createLog({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        level: "error",
        message: "Failed to send Discord message",
        metadata: { error: error.message, channelId }
      });
      throw error;
    }
  }
  onMessage(callback) {
    this.client.on("messageCreate", async (message) => {
      if (message.author.bot) return;
      try {
        const bridges2 = await storage.getBridges();
        const bridge = bridges2.find((b) => b.discordChannelId === message.channelId && b.enabled);
        if (bridge) {
          await callback(message, bridge);
        }
      } catch (error) {
        storage.createLog({
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          level: "error",
          message: "Failed to process Discord message",
          metadata: { error: error.message, messageId: message.id }
        });
      }
    });
  }
};

// server/bot/revolt.ts
import { Client as Client2 } from "revolt.js";
var RevoltBot = class {
  client;
  ready = false;
  constructor(token) {
    storage.createLog({
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      level: "info",
      message: "Creating Revolt bot instance"
    });
    this.client = new Client2();
    this.client.on("ready", async () => {
      this.ready = true;
      storage.createLog({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        level: "info",
        message: "Revolt bot ready",
        metadata: {
          username: this.client.user?.username,
          id: this.client.user?._id
        }
      });
    });
    this.client.on("error", (error) => {
      storage.createLog({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        level: "error",
        message: "Revolt bot error",
        metadata: { error: error.message }
      });
    });
    try {
      storage.createLog({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        level: "info",
        message: "Attempting Revolt bot login"
      });
      this.client.loginBot(token).catch((error) => {
        storage.createLog({
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          level: "error",
          message: "Revolt bot login failed",
          metadata: { error: error.message }
        });
      });
    } catch (error) {
      storage.createLog({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        level: "error",
        message: "Revolt bot initialization failed",
        metadata: { error: error.message }
      });
    }
  }
  async uploadFile(url) {
    try {
      storage.createLog({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        level: "info",
        message: "Attempting to upload file to Revolt",
        metadata: { url }
      });
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`);
      }
      const buffer = await response.arrayBuffer();
      const contentType = response.headers.get("content-type") || "image/png";
      const extension = contentType.split("/")[1] || "png";
      const file = new File([buffer], `image.${extension}`, { type: contentType });
      const formData = new FormData();
      formData.append("file", file);
      const autumn = this.client.configuration?.features.autumn.url;
      if (!autumn) {
        throw new Error("Autumn URL not found in Revolt configuration");
      }
      storage.createLog({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        level: "info",
        message: "Uploading file to Autumn",
        metadata: { autumn, contentType }
      });
      const uploadResponse = await fetch(`${autumn}/attachments`, {
        method: "POST",
        body: formData
      });
      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        throw new Error(`Failed to upload file: ${uploadResponse.statusText}, ${errorText}`);
      }
      const data = await uploadResponse.json();
      storage.createLog({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        level: "info",
        message: "Successfully uploaded file to Revolt",
        metadata: { fileId: data.id }
      });
      return data.id;
    } catch (error) {
      storage.createLog({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        level: "error",
        message: "Failed to upload file to Revolt",
        metadata: {
          error: error.message,
          url,
          stack: error.stack
        }
      });
      return null;
    }
  }
  async sendMessage(channelId, content, options = {}) {
    if (!this.ready) {
      storage.createLog({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        level: "error",
        message: "Attempted to send message before Revolt bot was ready",
        metadata: { channelId }
      });
      throw new Error("Revolt bot not ready");
    }
    try {
      const channel = await this.client.channels.get(channelId);
      if (!channel || !("sendMessage" in channel)) {
        throw new Error("Invalid channel or missing permissions");
      }
      storage.createLog({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        level: "info",
        message: "Attempting to send Revolt message",
        metadata: {
          channelId,
          hasUsername: !!options.username
        }
      });
      const message = await channel.sendMessage({
        content,
        masquerade: options.username ? {
          name: options.username,
          avatar: options.avatarUrl || void 0
        } : void 0
      });
      storage.createLog({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        level: "info",
        message: "Successfully sent Revolt message",
        metadata: { messageId: message._id }
      });
      return message;
    } catch (error) {
      storage.createLog({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        level: "error",
        message: "Failed to send Revolt message",
        metadata: {
          error: error.message,
          channelId,
          stack: error.stack
        }
      });
      throw error;
    }
  }
  onMessage(callback) {
    this.client.on("message", async (message) => {
      if (message.author?.bot) return;
      storage.createLog({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        level: "info",
        message: "Received Revolt message",
        metadata: {
          messageId: message._id,
          channelId: message.channel?._id,
          authorId: message.author?._id
        }
      });
      try {
        const bridges2 = await storage.getBridges();
        const bridge = bridges2.find((b) => b.revoltChannelId === message.channel?._id && b.enabled);
        if (bridge) {
          storage.createLog({
            timestamp: (/* @__PURE__ */ new Date()).toISOString(),
            level: "info",
            message: "Processing Revolt message for bridge",
            metadata: { bridgeId: bridge.id }
          });
          await callback(message, bridge);
        }
      } catch (error) {
        storage.createLog({
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          level: "error",
          message: "Failed to process Revolt message",
          metadata: { error: error.message, messageId: message._id }
        });
      }
    });
  }
};

// server/bot/bridge.ts
var discordBot = null;
var revoltBot = null;
async function initializeBridge(storage2) {
  try {
    const settings2 = await storage2.getSettings();
    storage2.createLog({
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      level: "info",
      message: "Attempting to initialize bridge with settings",
      metadata: {
        discordTokenPresent: !!settings2.discordToken,
        revoltTokenPresent: !!settings2.revoltToken
      }
    });
    if (!settings2.discordToken || !settings2.revoltToken) {
      storage2.createLog({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        level: "error",
        message: "Bot tokens not configured",
        metadata: {
          discordTokenSet: !!settings2.discordToken,
          revoltTokenSet: !!settings2.revoltToken
        }
      });
      return;
    }
    discordBot = new DiscordBot(settings2.discordToken);
    revoltBot = new RevoltBot(settings2.revoltToken);
    discordBot.onMessage(async (message, bridge) => {
      if (!bridge.enabled || !revoltBot) return;
      try {
        const masquerades2 = await storage2.getMasquerades(bridge.id);
        const masquerade = masquerades2.find((m) => m.userId === message.author.id);
        let content = message.content || "";
        const attachments = Array.from(message.attachments.values());
        const imageAttachments = attachments.filter(
          (att) => att.contentType?.startsWith("image/") || att.url.match(/\.(jpg|jpeg|png|gif|webp)$/i)
        );
        if (imageAttachments.length > 0) {
          const attachmentLinks = imageAttachments.map((att) => att.url);
          if (content) content += "\n\n";
          content += "\u6DFB\u4ED8\u753B\u50CF:\n" + attachmentLinks.join("\n");
        }
        await revoltBot.sendMessage(
          bridge.revoltChannelId,
          content,
          {
            username: masquerade?.username || message.author.username,
            avatarUrl: masquerade?.avatar || message.author.displayAvatarURL()
          }
        );
        storage2.createLog({
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          level: "info",
          message: "Successfully relayed Discord message to Revolt",
          metadata: {
            messageId: message.id,
            attachmentCount: imageAttachments.length
          }
        });
      } catch (error) {
        storage2.createLog({
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          level: "error",
          message: "Failed to relay Discord message to Revolt",
          metadata: {
            error: error.message,
            messageId: message.id,
            stack: error.stack
          }
        });
      }
    });
    revoltBot.onMessage(async (message, bridge) => {
      if (!bridge.enabled || !discordBot || !message.author) return;
      try {
        let avatarUrl = null;
        if (message.author?.avatar?._id) {
          avatarUrl = `https://autumn.revolt.chat/avatars/${message.author.avatar._id}`;
        }
        const masquerades2 = await storage2.getMasquerades(bridge.id);
        const masquerade = masquerades2.find((m) => m.userId === message.author?._id);
        const username = masquerade?.username || message.author?.username || "Unknown User";
        const attachmentLinks = message.attachments?.map(
          (att) => `https://autumn.revolt.chat/attachments/${att._id}`
        ) || [];
        let contentWithLinks = message.content || "";
        if (attachmentLinks.length > 0) {
          contentWithLinks += "\n" + attachmentLinks.join("\n");
        }
        await discordBot.sendMessage(
          bridge.discordChannelId,
          contentWithLinks,
          {
            username,
            avatarUrl: masquerade?.avatar || avatarUrl
          }
        );
        storage2.createLog({
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          level: "info",
          message: "Successfully relayed Revolt message to Discord",
          metadata: {
            messageId: message._id,
            attachmentCount: attachmentLinks.length
          }
        });
      } catch (error) {
        storage2.createLog({
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          level: "error",
          message: "Failed to relay Revolt message to Discord",
          metadata: {
            error: error.message,
            messageId: message._id,
            stack: error.stack
          }
        });
      }
    });
    await storage2.clearErrorLogs();
    storage2.createLog({
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      level: "info",
      message: "Bridge initialized successfully"
    });
  } catch (error) {
    storage2.createLog({
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      level: "error",
      message: "Failed to initialize bridge",
      metadata: {
        error: error.message,
        stack: error.stack
      }
    });
  }
}

// server/routes.ts
function registerRoutes(app2) {
  app2.get("/api/bridges", async (req, res) => {
    const bridges2 = await storage.getBridges();
    res.json(bridges2);
  });
  app2.post("/api/bridges", async (req, res) => {
    const result = insertBridgeSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }
    const bridge = await storage.createBridge(result.data);
    res.json(bridge);
  });
  app2.patch("/api/bridges/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const result = insertBridgeSchema.partial().safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }
    const bridge = await storage.updateBridge(id, result.data);
    res.json(bridge);
  });
  app2.delete("/api/bridges/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    await storage.deleteBridge(id);
    res.status(204).end();
  });
  app2.get("/api/bridges/:bridgeId/masquerades", async (req, res) => {
    const bridgeId = parseInt(req.params.bridgeId);
    const masquerades2 = await storage.getMasquerades(bridgeId);
    res.json(masquerades2);
  });
  app2.post("/api/masquerades", async (req, res) => {
    const result = insertMasqueradeSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }
    const masquerade = await storage.createMasquerade(result.data);
    res.json(masquerade);
  });
  app2.patch("/api/masquerades/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const result = insertMasqueradeSchema.partial().safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }
    const masquerade = await storage.updateMasquerade(id, result.data);
    res.json(masquerade);
  });
  app2.delete("/api/masquerades/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    await storage.deleteMasquerade(id);
    res.status(204).end();
  });
  app2.get("/api/settings", async (req, res) => {
    const settings2 = await storage.getSettings();
    res.json(settings2);
  });
  app2.patch("/api/settings", async (req, res) => {
    try {
      const result = insertSettingsSchema.partial().safeParse(req.body);
      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }
      storage.createLog({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        level: "info",
        message: "Updating settings and reinitializing bridge",
        metadata: {
          discordTokenPresent: !!result.data.discordToken,
          revoltTokenPresent: !!result.data.revoltToken
        }
      });
      const settings2 = await storage.updateSettings(result.data);
      await initializeBridge(storage);
      res.json(settings2);
    } catch (error) {
      storage.createLog({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        level: "error",
        message: "Failed to update settings",
        metadata: { error: error.message }
      });
      throw error;
    }
  });
  app2.get("/api/logs", async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit) : void 0;
    const logs2 = await storage.getLogs(limit);
    res.json(logs2);
  });
  const httpServer = createServer(app2);
  storage.createLog({
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    level: "info",
    message: "Starting initial bridge setup"
  });
  initializeBridge(storage);
  return httpServer;
}

// server/vite.ts
import express from "express";
import fs from "fs";
import path2, { dirname as dirname2 } from "path";
import { fileURLToPath as fileURLToPath2 } from "url";
import { createServer as createViteServer, createLogger } from "vite";

// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import themePlugin from "@replit/vite-plugin-shadcn-theme-json";
import path, { dirname } from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { fileURLToPath } from "url";
var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);
var vite_config_default = defineConfig({
  plugins: [react(), runtimeErrorOverlay(), themePlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client", "src"),
      "@shared": path.resolve(__dirname, "shared")
    }
  },
  root: path.resolve(__dirname, "client"),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true
  }
});

// server/vite.ts
import { nanoid } from "nanoid";
var __filename2 = fileURLToPath2(import.meta.url);
var __dirname2 = dirname2(__filename2);
var viteLogger = createLogger();
function log(message, source = "express") {
  const formattedTime = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}
async function setupVite(app2, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      }
    },
    server: serverOptions,
    appType: "custom"
  });
  app2.use(vite.middlewares);
  app2.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path2.resolve(
        __dirname2,
        "..",
        "client",
        "index.html"
      );
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app2) {
  const distPath = path2.resolve(__dirname2, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app2.use(express.static(distPath));
  app2.use("*", (_req, res) => {
    res.sendFile(path2.resolve(distPath, "index.html"));
  });
}

// server/index.ts
var app = express2();
app.use(express2.json());
app.use(express2.urlencoded({ extended: false }));
app.use((req, res, next) => {
  const start = Date.now();
  const path3 = req.path;
  let capturedJsonResponse = void 0;
  const originalResJson = res.json;
  res.json = function(bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path3.startsWith("/api")) {
      let logLine = `${req.method} ${path3} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "\u2026";
      }
      log(logLine);
    }
  });
  next();
});
(async () => {
  const server = registerRoutes(app);
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    throw err;
  });
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const PORT = 5e3;
  server.listen(PORT, "0.0.0.0", () => {
    log(`serving on port ${PORT}`);
  });
})();
