import {
  Client,
  GatewayIntentBits,
  Message,
  Partials,
} from "discord.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "./lib/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OWNER_ID = "1492017858182385684";
const DATA_DIR = path.resolve(__dirname, "../data");
const DATA_FILE = path.join(DATA_DIR, "bot-data.json");
const PREFIX = ",";

interface UserData {
  reactions: string[];
}

interface BotData {
  authorized: Record<string, UserData>;
}

function loadData(): BotData {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(DATA_FILE)) {
    const initial: BotData = { authorized: {} };
    writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(readFileSync(DATA_FILE, "utf-8")) as BotData;
}

function saveData(data: BotData): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function extractEmojis(text: string): string[] {
  const emojiRegex =
    /(\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/gu;
  const unicodeMatches = text.match(emojiRegex) ?? [];

  const customEmojiRegex = /<a?:[a-zA-Z0-9_]+:\d+>/g;
  const customMatches = text.match(customEmojiRegex) ?? [];

  return [...unicodeMatches, ...customMatches].filter(
    (e, i, arr) => arr.indexOf(e) === i
  );
}

export function startBot(): void {
  const token = process.env["DISCORD_BOT_TOKEN"];
  if (!token) {
    logger.warn("DISCORD_BOT_TOKEN not set — bot will not start");
    return;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
  });

  client.once("ready", () => {
    logger.info({ tag: client.user?.tag }, "Discord bot online");
  });

  client.on("messageCreate", async (message: Message) => {
    if (message.author.bot) return;

    const content = message.content.trim();
    const authorId = message.author.id;

    if (content.startsWith(PREFIX)) {
      const withoutPrefix = content.slice(PREFIX.length).trim();
      const parts = withoutPrefix.split(/\s+/);
      const command = parts[0]?.toLowerCase();

      if (command === "sys" && parts[1]?.toLowerCase() === "auth") {
        if (authorId !== OWNER_ID) {
          await message.reply(
            "❌ ask **@remandment** for access."
          );
          return;
        }
        const targetId = parts[2];
        if (!targetId) {
          await message.reply("Usage: `,sys auth <user_id>`");
          return;
        }
        const data = loadData();
        if (data.authorized[targetId]) {
          await message.reply(`⚠️ <@${targetId}> already has access.`);
          return;
        }
        data.authorized[targetId] = { reactions: ["✅"] };
        saveData(data);
        await message.reply(`✅ Granted access to <@${targetId}>.`);
        return;
      }

      if (command === "sys" && parts[1]?.toLowerCase() === "revoke") {
        if (authorId !== OWNER_ID) {
          await message.reply(
            "❌ ask **@remandment** for access."
          );
          return;
        }
        const targetId = parts[2];
        if (!targetId) {
          await message.reply("Usage: `,sys revoke <user_id>`");
          return;
        }
        const data = loadData();
        if (!data.authorized[targetId]) {
          await message.reply(`⚠️ <@${targetId}> doesn't have access.`);
          return;
        }
        delete data.authorized[targetId];
        saveData(data);
        await message.reply(`🗑️ Revoked access from <@${targetId}>.`);
        return;
      }

      if (command === "autoreact") {
        const subcommand = parts[1]?.toLowerCase();

        if (subcommand === "customize") {
          const data = loadData();
          const isOwner = authorId === OWNER_ID;
          const isAuthorized = !!data.authorized[authorId];

          if (!isOwner && !isAuthorized) {
            await message.reply(
              "❌ ask **@remandment** for access."
            );
            return;
          }

          const emojiText = withoutPrefix.slice("autoreact customize".length).trim();
          const emojis = extractEmojis(emojiText);

          if (emojis.length === 0) {
            await message.reply(
              "❌ No valid emojis found. Usage: `,autoreact customize 🤡 🎭 🔥`"
            );
            return;
          }

          if (isOwner && !isAuthorized) {
            data.authorized[authorId] = { reactions: emojis };
          } else {
            data.authorized[authorId]!.reactions = emojis;
          }
          saveData(data);
          await message.reply(
            `✅ Auto-react set to: ${emojis.join(" ")}`
          );
          return;
        }

        if (subcommand === "list") {
          const isOwner = authorId === OWNER_ID;
          const data = loadData();
          if (!isOwner && !data.authorized[authorId]) {
            await message.reply("❌ ask **@remandment** for access.");
            return;
          }
          const entries = Object.entries(data.authorized);
          if (entries.length === 0) {
            await message.reply("No authorized users yet.");
            return;
          }
          const lines = entries.map(
            ([id, ud]) => `<@${id}>: ${ud.reactions.join(" ")}`
          );
          await message.reply(`📋 Authorized users:\n${lines.join("\n")}`);
          return;
        }

        if (subcommand === "clear") {
          const data = loadData();
          const isOwner = authorId === OWNER_ID;
          const isAuthorized = !!data.authorized[authorId];
          if (!isOwner && !isAuthorized) {
            await message.reply("❌ ask **@remandment** for access.");
            return;
          }
          if (isAuthorized) {
            data.authorized[authorId]!.reactions = [];
            saveData(data);
          }
          await message.reply("🗑️ Your auto-reactions cleared.");
          return;
        }
      }

      const data = loadData();
      const isOwner = authorId === OWNER_ID;
      const isAuthorized = !!data.authorized[authorId];
      if (!isOwner && !isAuthorized) {
        await message.reply("❌ ask **@remandment** for access.");
        return;
      }
      return;
    }

    const data = loadData();
    const isOwner = authorId === OWNER_ID;
    const userData = data.authorized[authorId];

    if (!isOwner && !userData) return;

    const reactions =
      userData?.reactions?.length
        ? userData.reactions
        : isOwner && !userData
        ? []
        : [];

    for (const emoji of reactions) {
      try {
        await message.react(emoji);
      } catch {
        logger.warn({ emoji, authorId }, "Failed to react with emoji");
      }
    }
  });

  client.login(token).catch((err: unknown) => {
    logger.error({ err }, "Failed to login to Discord");
  });
}
