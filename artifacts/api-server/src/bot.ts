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

interface TargetData {
  reactions: string[];
}

interface BotData {
  targets: Record<string, TargetData>;
}

function loadData(): BotData {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(DATA_FILE)) {
    const initial: BotData = { targets: {} };
    writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(readFileSync(DATA_FILE, "utf-8")) as BotData;
}

function saveData(data: BotData): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function parseMention(text: string): string | null {
  const match = text.match(/^<@!?(\d+)>$/) ?? text.match(/^(\d{17,20})$/);
  return match?.[1] ?? null;
}

function extractEmojis(text: string): string[] {
  const unicodeRegex =
    /(\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/gu;
  const unicodeMatches = text.match(unicodeRegex) ?? [];
  const customMatches = text.match(/<a?:[a-zA-Z0-9_]+:\d+>/g) ?? [];
  return [...unicodeMatches, ...customMatches].filter(
    (e, i, arr) => arr.indexOf(e) === i
  );
}

function isOwner(authorId: string): boolean {
  return authorId === OWNER_ID;
}

async function rejectUnauthorized(message: Message): Promise<void> {
  await message.reply("❌ ask **@remandment** for access.");
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

    // ── Commands ────────────────────────────────────────────────────────────
    if (content.startsWith(PREFIX)) {
      const withoutPrefix = content.slice(PREFIX.length).trim();
      const parts = withoutPrefix.split(/\s+/);
      const command = parts[0]?.toLowerCase();

      // ,autoreact @user 💩 🤡  — set reactions on a target
      // ,autoreact remove @user  — remove a target
      // ,autoreact list          — show all targets
      if (command === "autoreact") {
        if (!isOwner(authorId)) {
          await rejectUnauthorized(message);
          return;
        }

        const sub = parts[1]?.toLowerCase();

        // ,autoreact list
        if (sub === "list") {
          const data = loadData();
          const entries = Object.entries(data.targets);
          if (entries.length === 0) {
            await message.reply("No targets set yet.");
            return;
          }
          const lines = entries.map(
            ([id, t]) => `<@${id}> → ${t.reactions.join(" ") || "(no reactions)"}`
          );
          await message.reply(`📋 Active targets:\n${lines.join("\n")}`);
          return;
        }

        // ,autoreact remove @user
        if (sub === "remove") {
          const targetId = parseMention(parts[2] ?? "");
          if (!targetId) {
            await message.reply("Usage: `,autoreact remove @user`");
            return;
          }
          const data = loadData();
          if (!data.targets[targetId]) {
            await message.reply(`⚠️ <@${targetId}> is not a target.`);
            return;
          }
          delete data.targets[targetId];
          saveData(data);
          await message.reply(`🗑️ Removed <@${targetId}> from targets.`);
          return;
        }

        // ,autoreact @user 💩 🤡
        const targetId = parseMention(parts[1] ?? "");
        if (!targetId) {
          await message.reply(
            "Usage:\n" +
            "• `,autoreact @user 💩 🤡` — set reactions on a target\n" +
            "• `,autoreact remove @user` — remove a target\n" +
            "• `,autoreact list` — show all targets"
          );
          return;
        }

        // everything after the mention is emojis
        const emojiText = parts.slice(2).join(" ");
        const emojis = extractEmojis(emojiText);

        if (emojis.length === 0) {
          await message.reply("❌ No valid emojis found after the mention.");
          return;
        }

        const data = loadData();
        data.targets[targetId] = { reactions: emojis };
        saveData(data);
        await message.reply(
          `✅ Every message from <@${targetId}> will get: ${emojis.join(" ")}`
        );
        return;
      }

      // ,sys auth / ,sys revoke — kept for granting bot command access to others
      if (command === "sys") {
        if (!isOwner(authorId)) {
          await rejectUnauthorized(message);
          return;
        }
        // reserved for future use
        await message.reply("Unknown sys command.");
        return;
      }

      // any other command by a non-owner
      if (!isOwner(authorId)) {
        await rejectUnauthorized(message);
      }
      return;
    }

    // ── Auto-react ──────────────────────────────────────────────────────────
    const data = loadData();
    const target = data.targets[authorId];
    if (!target || target.reactions.length === 0) return;

    for (const emoji of target.reactions) {
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
