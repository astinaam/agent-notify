import * as p from '@clack/prompts';
import pc from 'picocolors';
import { TelegramClient } from './telegram.js';
import { saveConfig, loadSavedConfig, getConfigPath } from './config.js';
import type { TelegramConfig } from './types.js';

export async function runSetup(): Promise<void> {
  p.intro(pc.bgCyan(pc.black(' agent-notify setup ')));

  const existingConfig = loadSavedConfig();

  p.note(
    `To send notifications, you need a Telegram Bot token.\n\n` +
      `1. Open Telegram and search for ${pc.cyan('@BotFather')}\n` +
      `2. Send ${pc.yellow('/newbot')} and follow the instructions\n` +
      `3. Copy the API token provided by BotFather`,
    'Step 1: Get a Bot Token'
  );

  let botToken = '';
  let botInfo: { id: number; first_name: string; username?: string } | null = null;

  while (!botInfo) {
    const tokenInput = await p.text({
      message: 'Enter your Telegram Bot Token:',
      initialValue: existingConfig.botToken || '',
      validate(val) {
        if (!val || !val.trim()) return 'Bot token cannot be empty';
      },
    });

    if (p.isCancel(tokenInput)) {
      p.cancel('Setup cancelled.');
      process.exit(0);
    }

    botToken = tokenInput.trim();

    const spinner = p.spinner();
    spinner.start('Validating Bot Token with Telegram API...');

    try {
      const client = new TelegramClient({ botToken, chatId: '' });
      botInfo = await client.getMe();
      spinner.stop(pc.green(`✓ Bot verified: @${botInfo.username || botInfo.first_name} (${botInfo.first_name})`));
    } catch (err: any) {
      spinner.stop(pc.red(`✗ Validation failed: ${err.message}`));
      p.log.error('Invalid Bot Token. Please check and try again.');
    }
  }

  p.note(
    `Now we need your Telegram Chat ID.\n` +
      `We can automatically detect it if you send a message to ${pc.cyan(`@${botInfo.username}`)} now.`,
    'Step 2: Connect Your Chat'
  );

  const method = await p.select({
    message: 'How would you like to provide your Chat ID?',
    options: [
      { value: 'auto', label: 'Auto-detect (Send a message to your bot on Telegram)' },
      { value: 'manual', label: 'Enter Chat ID manually' },
    ],
  });

  if (p.isCancel(method)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  let chatId = '';

  if (method === 'auto') {
    const spinner = p.spinner();
    spinner.start(
      `Waiting for a message to @${botInfo.username}... Open Telegram and send /start or "hello"`
    );

    const client = new TelegramClient({ botToken, chatId: '' });
    const startTime = Date.now();
    const timeout = 60 * 1000; // 60 seconds

    while (Date.now() - startTime < timeout) {
      try {
        const updates = await client.getUpdates(-10, 3);
        const latestMsg = updates.reverse().find((u) => u.message?.chat?.id);
        if (latestMsg) {
          chatId = String(latestMsg.message.chat.id);
          const fromUser =
            latestMsg.message.chat.username ||
            latestMsg.message.chat.first_name ||
            'your account';
          spinner.stop(pc.green(`✓ Detected message from @${fromUser} (Chat ID: ${chatId})`));
          break;
        }
      } catch {
        // Retry polling
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    if (!chatId) {
      spinner.stop(pc.yellow('⚠ No message received within 60 seconds.'));
      const manualInput = await p.text({
        message: 'Enter your Telegram Chat ID manually:',
        initialValue: existingConfig.chatId || '',
        validate(val) {
          if (!val || !val.trim()) return 'Chat ID cannot be empty';
        },
      });
      if (p.isCancel(manualInput)) {
        p.cancel('Setup cancelled.');
        process.exit(0);
      }
      chatId = manualInput.trim();
    }
  } else {
    const manualInput = await p.text({
      message: 'Enter your Telegram Chat ID:',
      initialValue: existingConfig.chatId || '',
      validate(val) {
        if (!val || !val.trim()) return 'Chat ID cannot be empty';
      },
    });
    if (p.isCancel(manualInput)) {
      p.cancel('Setup cancelled.');
      process.exit(0);
    }
    chatId = manualInput.trim();
  }

  const useTopic = await p.confirm({
    message: 'Are you using a Telegram Forum Topic / Supergroup Topic?',
    initialValue: Boolean(existingConfig.topicId),
  });

  if (p.isCancel(useTopic)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  let topicId: number | undefined;
  if (useTopic) {
    const topicInput = await p.text({
      message: 'Enter Topic Message Thread ID:',
      initialValue: existingConfig.topicId ? String(existingConfig.topicId) : '',
    });
    if (p.isCancel(topicInput)) {
      p.cancel('Setup cancelled.');
      process.exit(0);
    }
    if (topicInput && topicInput.trim()) {
      topicId = Number.parseInt(topicInput.trim(), 10);
    }
  }

  // Save configuration
  const newConfig: TelegramConfig = {
    botToken,
    chatId,
    topicId,
  };

  saveConfig(newConfig);
  p.log.success(`Configuration saved to ${pc.cyan(getConfigPath())}`);

  // Test notification
  const sendTest = await p.confirm({
    message: 'Send a test notification to Telegram now?',
    initialValue: true,
  });

  if (!p.isCancel(sendTest) && sendTest) {
    const spinner = p.spinner();
    spinner.start('Sending test message...');
    try {
      const client = new TelegramClient(newConfig);
      await client.sendMessage({
        text: '🎉 <b>agent-notify setup complete!</b>\n\nYour AI agents can now send you messages and ask for human-in-the-loop decisions here.',
        parseMode: 'HTML',
        level: 'success',
      });
      spinner.stop(pc.green('✓ Test message sent successfully! Check your Telegram.'));
    } catch (err: any) {
      spinner.stop(pc.red(`✗ Failed to send test message: ${err.message}`));
    }
  }

  p.outro(
    pc.bold(
      `Setup finished! You can now use:\n` +
        `  ${pc.cyan('agent-notify send "Hello from terminal"')}\n` +
        `  ${pc.cyan('agent-notify ask "Deploy now?" --options "Yes,No"')}\n` +
        `  ${pc.cyan('agent-notify mcp')} (for MCP clients)`
    )
  );
}
