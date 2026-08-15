import { Command } from 'commander';
import fs from 'node:fs';
import pc from 'picocolors';
import { TelegramClient } from './telegram.js';
import { resolveConfig, validateConfig, saveConfig, loadSavedConfig, getConfigPath } from './config.js';
import { runSetup } from './setup.js';
import { runMcpServer } from './mcp.js';
import { startServer, ensureServerRunning, stopDaemon, isServerRunning, getPidFile, getLogFile } from './server.js';
import { getNetworkAddresses, getMessageLinks } from './network.js';
import type { NotificationLevel, ParseMode } from './types.js';

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return '';
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

const program = new Command();

program
  .name('agent-notify')
  .description('Telegram notification & two-way human-in-the-loop CLI for AI agents with Web History')
  .version('1.0.0');

// Global flags
program
  .option('-t, --token <token>', 'Telegram bot token override')
  .option('-c, --chat-id <id>', 'Telegram chat ID override')
  .option('--topic-id <id>', 'Telegram forum topic ID override');

// Command: send / notify
program
  .command('send [message]')
  .alias('notify')
  .description('Send a notification message to Telegram (reads from stdin if message omitted)')
  .option('-a, --agent <name>', 'Agent name (e.g. Antigravity, Claude, Deployer)', 'CLI')
  .option('-l, --level <level>', 'Notification level (info, success, warn, error)', 'info')
  .option('-p, --parse-mode <mode>', 'Parse mode (HTML, Markdown, MarkdownV2)', 'HTML')
  .option('-s, --silent', 'Send quietly without sound notification')
  .option('-f, --file <filePath>', 'Attach a file, image, or log')
  .option('--caption <caption>', 'Caption when sending a file')
  .option('--no-links', 'Do not attach Tailscale/LAN web links')
  .action(async (message, options) => {
    try {
      const globalOpts = program.opts();
      const config = resolveConfig({
        botToken: globalOpts.token,
        chatId: globalOpts.chatId,
        topicId: globalOpts.topicId ? Number.parseInt(globalOpts.topicId, 10) : undefined,
      });

      const validation = validateConfig(config);
      if (!validation.valid) {
        console.error(pc.red(`Error: ${validation.error}`));
        process.exit(1);
      }

      const client = new TelegramClient(config);

      if (options.file) {
        const caption = options.caption || message;
        const res = await client.sendFile({
          filePath: options.file,
          caption,
          agent: options.agent,
          level: options.level as NotificationLevel,
          silent: options.silent,
          includeLinks: options.links !== false,
        });
        console.log(pc.green(`✓ File sent successfully (message_id: ${res.message_id})`));
        if (res.messageRecord?.links) {
          console.log(pc.dim(`  Tailscale: ${res.messageRecord.links.tailscale}`));
          console.log(pc.dim(`  LAN:       ${res.messageRecord.links.lan}`));
        }
        return;
      }

      let text = message;
      if (!text || text === '-') {
        text = await readStdin();
      }

      if (!text) {
        console.error(pc.red('Error: Message text cannot be empty. Provide as argument or pipe via stdin.'));
        process.exit(1);
      }

      const res = await client.sendMessage({
        text,
        agent: options.agent,
        level: options.level as NotificationLevel,
        parseMode: options.parseMode as ParseMode,
        silent: options.silent,
        includeLinks: options.links !== false,
      });

      console.log(pc.green(`✓ Notification sent successfully (message_id: ${res.message_id})`));
      if (res.messageRecord?.links) {
        console.log(pc.dim(`  Tailscale: ${res.messageRecord.links.tailscale}`));
        console.log(pc.dim(`  LAN:       ${res.messageRecord.links.lan}`));
      }
    } catch (err: any) {
      console.error(pc.red(`✗ Failed to send message: ${err.message}`));
      process.exit(1);
    }
  });

// Command: send-file
program
  .command('send-file <filePath>')
  .description('Upload and send a file, screenshot, or document to Telegram')
  .option('-a, --agent <name>', 'Agent name', 'CLI')
  .option('-c, --caption <caption>', 'Caption for the file')
  .option('-l, --level <level>', 'Notification level (info, success, warn, error)')
  .option('-s, --silent', 'Send quietly without sound')
  .option('--no-links', 'Do not attach web links')
  .action(async (filePath, options) => {
    try {
      const globalOpts = program.opts();
      const config = resolveConfig({
        botToken: globalOpts.token,
        chatId: globalOpts.chatId,
        topicId: globalOpts.topicId ? Number.parseInt(globalOpts.topicId, 10) : undefined,
      });

      const validation = validateConfig(config);
      if (!validation.valid) {
        console.error(pc.red(`Error: ${validation.error}`));
        process.exit(1);
      }

      const client = new TelegramClient(config);
      const res = await client.sendFile({
        filePath,
        caption: options.caption,
        agent: options.agent,
        level: options.level as NotificationLevel,
        silent: options.silent,
        includeLinks: options.links !== false,
      });

      console.log(pc.green(`✓ File uploaded successfully (message_id: ${res.message_id})`));
      if (res.messageRecord?.links) {
        console.log(pc.dim(`  Tailscale: ${res.messageRecord.links.tailscale}`));
        console.log(pc.dim(`  LAN:       ${res.messageRecord.links.lan}`));
      }
    } catch (err: any) {
      console.error(pc.red(`✗ Failed to upload file: ${err.message}`));
      process.exit(1);
    }
  });

// Command: ask (Two-way interactive question)
program
  .command('ask <question>')
  .description('Ask the user a question via Telegram/Web and wait for response (two-way)')
  .option('-a, --agent <name>', 'Agent name', 'CLI')
  .option('-o, --options <options>', 'Comma-separated button options (e.g. "Approve,Reject")')
  .option('-t, --timeout <seconds>', 'Timeout in seconds to wait for answer', '300')
  .option('-l, --level <level>', 'Notification level (info, success, warn, error)', 'info')
  .option('--no-links', 'Do not attach web links')
  .option('--json', 'Output result in JSON format')
  .action(async (question, options) => {
    try {
      const globalOpts = program.opts();
      const config = resolveConfig({
        botToken: globalOpts.token,
        chatId: globalOpts.chatId,
        topicId: globalOpts.topicId ? Number.parseInt(globalOpts.topicId, 10) : undefined,
      });

      const validation = validateConfig(config);
      if (!validation.valid) {
        console.error(pc.red(`Error: ${validation.error}`));
        process.exit(1);
      }

      const parsedOptions = options.options
        ? options.options.split(',').map((s: string) => s.trim()).filter(Boolean)
        : undefined;

      const timeoutSeconds = Number.parseInt(options.timeout, 10) || 300;

      if (!options.json) {
        console.log(pc.cyan(`Waiting for response on Telegram / Web UI (timeout: ${timeoutSeconds}s)...`));
      }

      const client = new TelegramClient(config);
      const result = await client.askUser({
        question,
        agent: options.agent,
        options: parsedOptions,
        timeoutSeconds,
        level: options.level as NotificationLevel,
        includeLinks: options.links !== false,
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        if (!result.answered) {
          process.exit(124);
        }
        return;
      }

      if (result.answered) {
        console.log(
          pc.green(`✓ Response received: `) +
            pc.bold(result.response || '') +
            pc.dim(` (by ${result.answeredBy || 'User'})`)
        );
        process.exit(0);
      } else {
        console.error(pc.yellow(`⚠ Timed out waiting for response after ${timeoutSeconds}s`));
        process.exit(124);
      }
    } catch (err: any) {
      console.error(pc.red(`✗ Error asking question: ${err.message}`));
      process.exit(1);
    }
  });

// Command: serve / web
program
  .command('serve')
  .alias('web')
  .description('Start the Web UI server in foreground (optional, starts automatically in background)')
  .option('-p, --port <port>', 'Port to listen on', '4173')
  .option('-h, --host <host>', 'Host to bind to', '0.0.0.0')
  .action(async (options) => {
    try {
      const port = Number.parseInt(options.port, 10) || 4173;
      const { addresses } = await startServer(port, options.host);

      console.log();
      console.log(pc.bgCyan(pc.black(' agent-notify web dashboard ')));
      console.log();
      console.log(pc.bold('  Access URLs:'));
      console.log(`  🏠 Local LAN:   ${pc.cyan(addresses.localLanUrl)}`);
      if (addresses.tailscaleUrl) {
        console.log(`  🌐 Tailscale:   ${pc.green(addresses.tailscaleUrl)}`);
      }
      console.log(`  💻 Localhost:   ${pc.dim(addresses.localhostUrl)}`);
      console.log();
      console.log(pc.dim('  Press Ctrl+C to stop the server.'));
      console.log();
    } catch (err: any) {
      console.error(pc.red(`✗ Failed to start web server: ${err.message}`));
      process.exit(1);
    }
  });

// Command: daemon
const daemonCommand = program
  .command('daemon')
  .description('Manage background web server daemon');

daemonCommand
  .command('status')
  .description('Check background daemon status')
  .action(async () => {
    const config = resolveConfig();
    const port = config.serverPort || 4173;
    const running = await isServerRunning(port);
    const pidFile = getPidFile();

    if (running) {
      let pid = '';
      if (fs.existsSync(pidFile)) {
        pid = fs.readFileSync(pidFile, 'utf8').trim();
      }
      const addrs = getNetworkAddresses(port, config);
      console.log(pc.green(`✓ Daemon is RUNNING (Port: ${port}${pid ? `, PID: ${pid}` : ''})`));
      if (addrs.tailscaleUrl) console.log(`  🌐 Tailscale: ${pc.green(addrs.tailscaleUrl)}`);
      console.log(`  🏠 Local LAN: ${pc.cyan(addrs.localLanUrl)}`);
      console.log(`  💻 Localhost: ${pc.dim(addrs.localhostUrl)}`);
    } else {
      console.log(pc.yellow(`⚠ Daemon is NOT running (Port: ${port})`));
      console.log(pc.dim('  It will auto-start on next message or run `agent-notify daemon start`'));
    }
  });

daemonCommand
  .command('start')
  .description('Start background daemon')
  .action(async () => {
    const config = resolveConfig();
    const port = config.serverPort || 4173;
    await ensureServerRunning(port);
    const running = await isServerRunning(port);
    if (running) {
      const addrs = getNetworkAddresses(port, config);
      console.log(pc.green(`✓ Background daemon started on port ${port}`));
      if (addrs.tailscaleUrl) console.log(`  🌐 Tailscale: ${pc.green(addrs.tailscaleUrl)}`);
      console.log(`  🏠 Local LAN: ${pc.cyan(addrs.localLanUrl)}`);
    } else {
      console.error(pc.red('✗ Failed to start background daemon. Check ~/.config/agent-notify/server.log'));
    }
  });

daemonCommand
  .command('stop')
  .description('Stop background daemon')
  .action(() => {
    const stopped = stopDaemon();
    if (stopped) {
      console.log(pc.green('✓ Background daemon stopped.'));
    } else {
      console.log(pc.yellow('No running daemon found to stop.'));
    }
  });

// Command: links
program
  .command('links [messageId]')
  .description('Show Tailscale & Local LAN links for the web dashboard or a specific message')
  .action((messageId) => {
    const config = resolveConfig();
    if (messageId) {
      const links = getMessageLinks(messageId, config.serverPort, config);
      console.log(pc.bold(`Message Links for #${messageId}:`));
      console.log(`  🌐 Tailscale: ${pc.green(links.tailscale)}`);
      console.log(`  🏠 Local LAN: ${pc.cyan(links.lan)}`);
      console.log(`  💻 Localhost: ${pc.dim(links.local)}`);
    } else {
      const addrs = getNetworkAddresses(config.serverPort, config);
      console.log(pc.bold('Dashboard Links:'));
      if (addrs.tailscaleUrl) {
        console.log(`  🌐 Tailscale: ${pc.green(addrs.tailscaleUrl)}`);
      }
      console.log(`  🏠 Local LAN: ${pc.cyan(addrs.localLanUrl)}`);
      console.log(`  💻 Localhost: ${pc.dim(addrs.localhostUrl)}`);
    }
  });

// Command: setup
program
  .command('setup')
  .alias('init')
  .description('Interactive setup wizard to configure Telegram bot token and chat ID')
  .action(async () => {
    await runSetup();
  });

// Command: config
const configCommand = program
  .command('config')
  .description('Manage agent-notify configuration');

configCommand
  .command('show')
  .description('Show current saved configuration')
  .action(() => {
    const config = loadSavedConfig();
    const configPath = getConfigPath();
    console.log(pc.cyan(`Config file: ${configPath}`));
    console.log(pc.dim('----------------------------------------'));
    if (!config.botToken && !config.chatId) {
      console.log(pc.yellow('No configuration found. Run `agent-notify setup` to get started.'));
      return;
    }
    const maskedToken = config.botToken
      ? `${config.botToken.slice(0, 6)}...${config.botToken.slice(-4)}`
      : '(not set)';
    console.log(`Bot Token:      ${pc.bold(maskedToken)}`);
    console.log(`Chat ID:        ${pc.bold(config.chatId || '(not set)')}`);
    if (config.topicId) {
      console.log(`Topic ID:       ${pc.bold(String(config.topicId))}`);
    }
    console.log(`Web Port:       ${pc.bold(String(config.serverPort || 4173))}`);
    console.log(`Include Links:  ${pc.bold(String(config.includeLinks !== false))}`);
    if (config.tailscaleHost) {
      console.log(`Tailscale Host: ${pc.bold(config.tailscaleHost)}`);
    }
    if (config.lanHost) {
      console.log(`LAN Host:       ${pc.bold(config.lanHost)}`);
    }
  });

configCommand
  .command('set')
  .description('Set configuration values manually')
  .option('-t, --token <token>', 'Telegram bot token')
  .option('-c, --chat-id <id>', 'Telegram chat ID')
  .option('--topic-id <id>', 'Telegram topic ID')
  .option('-p, --port <port>', 'Web server port')
  .option('--links <boolean>', 'Include links in messages (true/false)')
  .option('--tailscale-host <host>', 'Custom Tailscale host override')
  .option('--lan-host <host>', 'Custom LAN host override')
  .action((options, cmd) => {
    const parentOpts = program.opts();
    const cmdOpts = cmd ? cmd.opts() : options;
    const token = cmdOpts.token || parentOpts.token;
    const chatId = cmdOpts.chatId || parentOpts.chatId;
    const topicId = cmdOpts.topicId || parentOpts.topicId;

    const updates: Partial<any> = {};
    if (token) updates.botToken = token;
    if (chatId) updates.chatId = chatId;
    if (topicId) updates.topicId = Number.parseInt(topicId, 10);
    if (cmdOpts.port) updates.serverPort = Number.parseInt(cmdOpts.port, 10);
    if (cmdOpts.links !== undefined) updates.includeLinks = cmdOpts.links === 'true';
    if (cmdOpts.tailscaleHost) updates.tailscaleHost = cmdOpts.tailscaleHost;
    if (cmdOpts.lanHost) updates.lanHost = cmdOpts.lanHost;

    saveConfig(updates);
    console.log(pc.green(`✓ Configuration updated in ${getConfigPath()}`));
  });

configCommand
  .command('test')
  .description('Send a test message to verify configuration')
  .action(async () => {
    try {
      const config = resolveConfig();
      const validation = validateConfig(config);
      if (!validation.valid) {
        console.error(pc.red(`Error: ${validation.error}`));
        process.exit(1);
      }
      const client = new TelegramClient(config);
      const res = await client.sendMessage({
        text: '🔔 <b>agent-notify test ping!</b>\nYour configuration and web tracking are working properly.',
        agent: 'System',
        parseMode: 'HTML',
        level: 'info',
      });
      console.log(pc.green('✓ Test message sent successfully! Check Telegram.'));
      if (res.messageRecord?.links) {
        console.log(pc.dim(`  Tailscale: ${res.messageRecord.links.tailscale}`));
        console.log(pc.dim(`  LAN:       ${res.messageRecord.links.lan}`));
      }
    } catch (err: any) {
      console.error(pc.red(`✗ Test message failed: ${err.message}`));
      process.exit(1);
    }
  });

configCommand
  .command('path')
  .description('Print configuration file path')
  .action(() => {
    console.log(getConfigPath());
  });

// Command: mcp
program
  .command('mcp')
  .description('Start Model Context Protocol (MCP) stdio server for AI agents')
  .action(async () => {
    await runMcpServer();
  });

// Run CLI
program.parse(process.argv);
