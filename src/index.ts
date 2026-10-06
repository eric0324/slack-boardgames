// 進入點：讀取環境變數，用 Socket Mode 連上 Slack。
import { App, type BlockAction, type ButtonAction } from '@slack/bolt';
import { GameHost } from './slack.js';

const { SLACK_BOT_TOKEN, SLACK_APP_TOKEN } = process.env;
if (!SLACK_BOT_TOKEN || !SLACK_APP_TOKEN) {
  console.error('請在 .env 設定 SLACK_BOT_TOKEN 和 SLACK_APP_TOKEN（參考 .env.example）');
  process.exit(1);
}

const app = new App({ token: SLACK_BOT_TOKEN, appToken: SLACK_APP_TOKEN, socketMode: true });
const host = new GameHost(app.client);

app.command('/werewolf', async ({ command, ack }) => {
  await ack();
  await host.command(command.channel_id, command.user_id, command.user_name, command.text);
});

app.action<BlockAction<ButtonAction>>(/^ww:/, async ({ action, body, ack }) => {
  await ack();
  await host.button(action.action_id, action.value ?? '', body.user.id, body.user.username);
});

await app.start();
console.log('狼人殺 bot 已啟動（Socket Mode）');
