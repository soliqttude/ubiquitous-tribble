# Discord Autoreact Bot

A Discord bot that auto-reacts to every message from authorized users with customizable emoji reactions.

## Commands

| Command | Who | Description |
|---|---|---|
| `,sys auth <user_id>` | Owner only | Grant a user access to the bot |
| `,sys revoke <user_id>` | Owner only | Remove a user's access |
| `,autoreact customize 🤡 🎭` | Authorized users | Set your auto-reactions |
| `,autoreact clear` | Authorized users | Clear your auto-reactions |
| `,autoreact list` | Authorized users | List all authorized users & reactions |

## Setup

1. Set `DISCORD_BOT_TOKEN` environment variable
2. Run `pnpm --filter @workspace/api-server run dev`

## Access Control

Only the hardcoded owner (remandment) can grant access via `,sys auth <user_id>`.
Unauthorized users who try any command are told: **ask @remandment for access**.
