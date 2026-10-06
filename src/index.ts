// 進入點：讀取環境變數，用 Socket Mode 連上 Slack。
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { App, type BlockAction, type ButtonAction } from '@slack/bolt';
import { GameHost } from './slack.js';
import { StatsStore } from './stats.js';

const { SLACK_BOT_TOKEN, SLACK_APP_TOKEN } = process.env;
if (!SLACK_BOT_TOKEN || !SLACK_APP_TOKEN) {
  console.error('Missing SLACK_BOT_TOKEN or SLACK_APP_TOKEN. Set them in .env (see .env.example).');
  process.exit(1);
}

const app = new App({ token: SLACK_BOT_TOKEN, appToken: SLACK_APP_TOKEN, socketMode: true });
const statsFile = process.env.STATS_DB ?? 'data/stats.db';
mkdirSync(dirname(statsFile), { recursive: true });
const host = new GameHost(app.client, { stats: new StatsStore(statsFile) });

app.command('/werewolf', async ({ command, ack }) => {
  await ack();
  await host.command(command.channel_id, command.user_id, command.user_name, command.text);
});

app.action<BlockAction<ButtonAction>>(/^ww:/, async ({ action, body, ack }) => {
  await ack();
  await host.button(action.action_id, action.value ?? '', body.user.id, body.user.username);
});

// 頻道裡真人打的字（忽略 bot 的訊息、編輯和其他子類型）
app.message(async ({ message }) => {
  if (message.subtype !== undefined || 'bot_id' in message) return;
  await host.chat(message.channel, message.user, message.text ?? '');
});

await app.start();
console.log('[werewolf] Bot is running (Socket Mode)');
