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

interface AuthorizedUser {
  reactions: string[];
}

interface BotData {
  authorized: Record<string, AuthorizedUser>;
}

function loadData(): BotData {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(DATA_FILE)) {
    const initial: BotData = { authorized: {} };
    writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  const raw = JSON.parse(readFileSync(DATA_FILE, "utf-8")) as Record<string, unknown>;
  // Migrate old format (targets → authorized)
  if ("targets" in raw && !("authorized" in raw)) {
    const migrated: BotData = { authorized: {} };
    const targets = raw["targets"] as Record<string, { reactions: string[] }>;
    for (const [id, t] of Object.entries(targets)) {
      migrated.authorized[id] = { reactions: t.reactions ?? [] };
    }
    saveData(migrated);
    return migrated;
  }
  return raw as BotData;
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

function isAuthorized(data: BotData, authorId: string): boolean {
  return isOwner(authorId) || authorId in data.authorized;
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

      // ── ,sys auth / ,sys revoke ──────────────────────────────────────────
      if (command === "sys") {
        if (!isOwner(authorId)) {
          await rejectUnauthorized(message);
          return;
        }

        const sub = parts[1]?.toLowerCase();

        // ,sys auth <@user|user_id>
        if (sub === "auth") {
          const targetId = parseMention(parts[2] ?? "");
          if (!targetId) {
            await message.reply("Usage: `,sys auth @user` or `,sys auth <user_id>`");
            return;
          }
          if (targetId === OWNER_ID) {
            await message.reply("❌ That's already the owner.");
            return;
          }
          const data = loadData();
          if (data.authorized[targetId]) {
            await message.reply(`⚠️ <@${targetId}> is already authorized.`);
            return;
          }
          data.authorized[targetId] = { reactions: [] };
          saveData(data);
          await message.reply(
            `✅ <@${targetId}> is now authorized.\nThey can set their reactions with \`,autoreact customize 💩 🤡\``
          );
          return;
        }

        // ,sys revoke <@user|user_id>
        if (sub === "revoke") {
          const targetId = parseMention(parts[2] ?? "");
          if (!targetId) {
            await message.reply("Usage: `,sys revoke @user` or `,sys revoke <user_id>`");
            return;
          }
          const data = loadData();
          if (!data.authorized[targetId]) {
            await message.reply(`⚠️ <@${targetId}> is not authorized.`);
            return;
          }
          delete data.authorized[targetId];
          saveData(data);
          await message.reply(`🗑️ <@${targetId}> has been revoked. Their reactions will no longer trigger.`);
          return;
        }

        await message.reply(
          "**Sys commands:**\n" +
          "• `,sys auth @user` — grant a user access\n" +
          "• `,sys revoke @user` — remove a user's access"
        );
        return;
      }

      // ── ,autoreact ───────────────────────────────────────────────────────
      if (command === "autoreact") {
        const data = loadData();

        if (!isAuthorized(data, authorId)) {
          await rejectUnauthorized(message);
          return;
        }

        const sub = parts[1]?.toLowerCase();

        // ,autoreact list — show all authorized users and their reactions
        if (sub === "list") {
          const entries = Object.entries(data.authorized);
          if (entries.length === 0) {
            await message.reply("No authorized users yet. Use `,sys auth @user` to add someone.");
            return;
          }
          const lines = entries.map(([id, u]) => {
            const reacts = u.reactions.length > 0 ? u.reactions.join(" ") : "_(no reactions set)_";
            return `<@${id}> → ${reacts}`;
          });
          await message.reply(`📋 **Authorized users:**\n${lines.join("\n")}`);
          return;
        }

        // ,autoreact clear — clear YOUR own reactions (stays authorized)
        if (sub === "clear") {
          if (isOwner(authorId) && !data.authorized[authorId]) {
            await message.reply("You're the owner — you don't have a reactions entry to clear.");
            return;
          }
          if (!data.authorized[authorId]) {
            await message.reply("⚠️ You don't have an authorized entry.");
            return;
          }
          data.authorized[authorId]!.reactions = [];
          saveData(data);
          await message.reply("🗑️ Your auto-reactions have been cleared. Your messages will no longer get any reactions.");
          return;
        }

        // ,autoreact customize 💩 🤡 — set YOUR own reactions
        if (sub === "customize") {
          const emojiText = parts.slice(2).join(" ");
          const emojis = extractEmojis(emojiText);

          if (emojis.length === 0) {
            await message.reply(
              "❌ No valid emojis found.\nUsage: `,autoreact customize 💩 🤡 😂`"
            );
            return;
          }

          // Owner might not have an entry — create one on the fly
          if (!data.authorized[authorId]) {
            data.authorized[authorId] = { reactions: [] };
          }
          data.authorized[authorId]!.reactions = emojis;
          saveData(data);
          await message.reply(
            `✅ Set! Every message you send will get: ${emojis.join(" ")}`
          );
          return;
        }

        // Unknown autoreact subcommand
        await message.reply(
          "**Autoreact commands:**\n" +
          "• `,autoreact customize 💩 🤡` — set reactions on your messages\n" +
          "• `,autoreact clear` — remove all your reactions\n" +
          "• `,autoreact list` — see all authorized users and their reactions"
        );
        return;
      }

      // Any other command — owner-only guard
      if (!isOwner(authorId)) {
        await rejectUnauthorized(message);
      }
      return;
    }

    // ── Auto-react ──────────────────────────────────────────────────────────
    const data = loadData();
    const userEntry = data.authorized[authorId];
    if (!userEntry || userEntry.reactions.length === 0) return;

    for (const emoji of userEntry.reactions) {
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
