import { Command } from 'commander';
import fs from 'node:fs';
import pc from 'picocolors';
import { TelegramClient } from './telegram.js';
import {
  resolveConfig,
  validateConfig,
  saveConfig,
  loadSavedConfig,
  getConfigPath,
  getHumanName,
  setHumanName,
} from './config.js';
import { runSetup } from './setup.js';
import { runMcpServer } from './mcp.js';
import { startServer, ensureServerRunning, stopDaemon, isServerRunning, getPidFile, getLogFile } from './server.js';
import {
  installSystemService,
  getSystemServiceStatus,
  restartSystemService,
  stopSystemService,
  startSystemService,
  uninstallSystemService,
} from './service.js';
import { getNetworkAddresses, getMessageLinks } from './network.js';
import { getSystemMetrics, checkAndEvaluateAlerts } from './monitor.js';
import {
  loadMemory,
  appendMemory,
  getEffectiveSystemPrompt,
  getMemoryFilePath,
  getSystemPromptFilePath,
} from './memory.js';
import type { NotificationLevel, ParseMode } from './types.js';
import { agentPresence, MAIN_CHANNEL_CODE } from './types.js';
import { channelStore } from './channel_store.js';
import {
  relayChannelCreated,
  relayChannelUpdated,
  relayChannelDeleted,
  relayAgentRegistered,
  relayAgentUpdated,
  relayAgentUnregistered,
  relayChannelMessage,
  relayHistoryArchived,
  relayHistoryCleared,
} from './channel_relay.js';

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

// Command: monitor (System resource alert monitor)
const monitorCommand = program
  .command('monitor')
  .description('Optional lightweight system resource monitor & threshold alerts');

monitorCommand
  .command('status')
  .description('View current system resource utilization and alert thresholds')
  .action(() => {
    const config = resolveConfig();
    const metrics = getSystemMetrics();
    const mon = config.monitor || { enabled: false };

    console.log();
    console.log(pc.bgCyan(pc.black(' System Resource Status ')));
    console.log();
    console.log(pc.bold(`  Host:        ${metrics.hostname} (Uptime: ${Math.floor(metrics.uptimeSec / 3600)}h ${Math.floor((metrics.uptimeSec % 3600) / 60)}m)`));
    console.log(`  Monitoring:  ${mon.enabled ? pc.green('ENABLED (Active in daemon)') : pc.yellow('DISABLED (default off)')}`);
    console.log();
    console.log(pc.bold('  Current Utilization:'));
    console.log(`  • CPU:       ${metrics.cpu.usagePct}% (Load: ${metrics.cpu.loadAvg.join(', ')}) [${metrics.cpu.cores} cores]`);
    console.log(`  • RAM:       ${metrics.ram.usedPct}% (${metrics.ram.usedMb} MB used / ${metrics.ram.freeMb} MB free / ${metrics.ram.totalMb} MB total)`);
    console.log(`  • Disk (/):  ${metrics.disk.usedPct}% (${metrics.disk.usedGb} GB used / ${metrics.disk.freeGb} GB free / ${metrics.disk.totalGb} GB total)`);
    if (metrics.tempC !== undefined) {
      console.log(`  • Temp:      ${metrics.tempC}°C`);
    }
    console.log();
    console.log(pc.bold('  Configured Alert Thresholds:'));
    console.log(`  • RAM Alert:       >= ${mon.ramThresholdPct ?? 90}%`);
    console.log(`  • Disk Alert:      >= ${mon.diskThresholdPct ?? 90}%`);
    console.log(`  • CPU Alert:       >= ${mon.cpuThresholdPct ?? 90}%`);
    console.log(`  • Temp Alert:      >= ${mon.tempThresholdC ?? 80}°C`);
    console.log(`  • Check Interval:  Every ${mon.checkIntervalSec ?? 60}s`);
    console.log(`  • Alert Cooldown:  ${(mon.cooldownSec ?? 1800) / 60} minutes between repeat alerts`);
    console.log(`  • Recovery Alert:  ${mon.alertOnRecovery !== false ? 'Yes' : 'No'}`);
    console.log();
  });

monitorCommand
  .command('enable')
  .description('Enable automated background resource monitoring')
  .action(() => {
    saveConfig({ monitor: { enabled: true } });
    console.log(pc.green('✓ System resource monitoring ENABLED.'));
    console.log(pc.dim('  The background daemon will now alert you on Telegram if thresholds are exceeded.'));
  });

monitorCommand
  .command('disable')
  .description('Disable automated background resource monitoring')
  .action(() => {
    saveConfig({ monitor: { enabled: false } });
    console.log(pc.yellow('✓ System resource monitoring DISABLED.'));
  });

monitorCommand
  .command('set')
  .description('Configure monitor thresholds and intervals')
  .option('--cpu <pct>', 'CPU usage alert threshold % (e.g. 90)')
  .option('--ram <pct>', 'RAM usage alert threshold % (e.g. 90)')
  .option('--disk <pct>', 'Disk usage alert threshold % (e.g. 90)')
  .option('--temp <celsius>', 'CPU temperature threshold in °C (e.g. 80)')
  .option('--interval <seconds>', 'Check interval in seconds (e.g. 60)')
  .option('--cooldown <seconds>', 'Cooldown between repeat alerts in seconds (e.g. 1800)')
  .option('--recovery <boolean>', 'Send recovery notification when resource normalizes (true/false)')
  .action((options) => {
    const updates: Partial<any> = {};
    if (options.cpu) updates.cpuThresholdPct = Number.parseInt(options.cpu, 10);
    if (options.ram) updates.ramThresholdPct = Number.parseInt(options.ram, 10);
    if (options.disk) updates.diskThresholdPct = Number.parseInt(options.disk, 10);
    if (options.temp) updates.tempThresholdC = Number.parseFloat(options.temp);
    if (options.interval) updates.checkIntervalSec = Number.parseInt(options.interval, 10);
    if (options.cooldown) updates.cooldownSec = Number.parseInt(options.cooldown, 10);
    if (options.recovery !== undefined) updates.alertOnRecovery = options.recovery === 'true';

    saveConfig({ monitor: updates as any });
    console.log(pc.green('✓ Monitoring configuration updated.'));
  });

monitorCommand
  .command('check')
  .description('Run an immediate one-off resource check and alert evaluation')
  .action(async () => {
    console.log(pc.cyan('Evaluating system resource metrics...'));
    const { triggeredAlerts, recoveredAlerts } = await checkAndEvaluateAlerts();
    if (triggeredAlerts.length > 0) {
      console.log(pc.red(`🚨 ${triggeredAlerts.length} alert(s) triggered & sent to Telegram.`));
      triggeredAlerts.forEach((a) => console.log(`  ${a.replace(/<[^>]*>/g, '')}`));
    } else {
      console.log(pc.green('✓ All system metrics are within normal thresholds.'));
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

daemonCommand
  .command('install-service')
  .description('Install background daemon as a systemd user service (auto-start on boot & auto-restart on failure)')
  .action(async () => {
    console.log(pc.cyan('→ Installing systemd user service...'));
    const result = await installSystemService();
    if (result.success) {
      console.log(pc.green(`✓ ${result.message}`));
      console.log(pc.dim('  Check status anytime with: agent-notify service status'));
    } else {
      console.error(pc.red(`✗ ${result.message}`));
    }
  });

// Command: service (Systemd user service management)
const serviceCommand = program
  .command('service')
  .description('Manage agent-notify systemd user service (auto-start on boot & always-on)');

serviceCommand
  .command('install')
  .description('Install, enable on server boot, and start the systemd background service')
  .action(async () => {
    console.log(pc.cyan('→ Installing agent-notify systemd service...'));
    const result = await installSystemService();
    if (result.success) {
      console.log(pc.green(`✓ ${result.message}`));
      console.log(pc.dim('  The daemon and bot listener will now run 24/7 and survive reboots.'));
    } else {
      console.error(pc.red(`✗ ${result.message}`));
    }
  });

serviceCommand
  .command('status')
  .description('Check systemd service status')
  .action(async () => {
    const status = await getSystemServiceStatus();
    if (!status.installed) {
      console.log(pc.yellow('⚠ Systemd service is NOT installed.'));
      console.log(pc.dim('  Run `agent-notify service install` to enable always-on background service.'));
    } else {
      console.log(status.running ? pc.green('✓ Service is ACTIVE and running') : pc.red('✗ Service is STOPPED'));
      console.log();
      console.log(status.statusText);
    }
  });

serviceCommand
  .command('start')
  .description('Start the systemd service')
  .action(async () => {
    const res = await startSystemService();
    if (res.success) console.log(pc.green(`✓ ${res.message}`));
    else console.error(pc.red(`✗ ${res.message}`));
  });

serviceCommand
  .command('stop')
  .description('Stop the systemd service')
  .action(async () => {
    const res = await stopSystemService();
    if (res.success) console.log(pc.green(`✓ ${res.message}`));
    else console.error(pc.red(`✗ ${res.message}`));
  });

serviceCommand
  .command('restart')
  .description('Restart the systemd service')
  .action(async () => {
    const res = await restartSystemService();
    if (res.success) console.log(pc.green(`✓ ${res.message}`));
    else console.error(pc.red(`✗ ${res.message}`));
  });

serviceCommand
  .command('uninstall')
  .description('Uninstall and disable the systemd service')
  .action(async () => {
    const res = await uninstallSystemService();
    if (res.success) console.log(pc.green(`✓ ${res.message}`));
    else console.error(pc.red(`✗ ${res.message}`));
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
    console.log(`Human Name:     ${pc.bold(config.humanName || getHumanName())}`);
    console.log(`Resource Alert: ${config.monitor?.enabled ? pc.green('ENABLED') : pc.yellow('DISABLED (default)')}`);
    if (config.tailscaleHost) {
      console.log(`Tailscale Host: ${pc.bold(config.tailscaleHost)}`);
    }
    if (config.botListener?.workspaceDir) {
      console.log(`Workspace Dir:  ${pc.bold(config.botListener.workspaceDir)}`);
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
  .option('--workspace-dir <dir>', 'Default workspace directory for agent/shell execution')
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
    if (cmdOpts.workspaceDir) {
      updates.botListener = { workspaceDir: cmdOpts.workspaceDir };
    }

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

// Command: channel — multi-channel agent communication
const channelCommand = program
  .command('channel')
  .description('Multi-channel agent communication (main + coded rooms)');

function explicitChannelFromArgv(): string | undefined {
  const argv = process.argv;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === '-C' || a === '--channel' || a === '--code') && argv[i + 1]) return argv[i + 1];
    if (a.startsWith('--channel=')) return a.slice('--channel='.length);
    if (a.startsWith('--code=')) return a.slice('--code='.length);
  }
  return undefined;
}

function chCode(opts: { channel?: string; code?: string }): string {
  const explicit = explicitChannelFromArgv();
  if (explicit?.trim()) return explicit.trim();
  const env = (process.env.AGENT_NOTIFY_CHANNEL || '').trim();
  if (env) return env;
  return (opts.channel || opts.code || MAIN_CHANNEL_CODE).trim() || MAIN_CHANNEL_CODE;
}

/** Identity for heartbeat: env caller, or the agent this command acts as. */
function callerAgentName(commandName: string, opts: { name?: string; from?: string }): string {
  const envName = (process.env.AGENT_NOTIFY_AGENT || '').trim();
  if (envName) return envName;
  if (commandName === 'say' || commandName === 'dm') return (opts.from || '').trim();
  if (commandName === 'register' || commandName === 'update' || commandName === 'heartbeat') {
    return (opts.name || '').trim();
  }
  return '';
}

channelCommand.hook('preAction', (_thisCommand, actionCommand) => {
  const opts = actionCommand.opts() as { name?: string; from?: string; channel?: string; code?: string };
  const name = callerAgentName(actionCommand.name(), opts);
  if (!name || actionCommand.name() === 'unregister') return;
  const code = chCode(opts);
  try {
    if (!channelStore.exists(code)) return;
    channelStore.touchAgent(code, name);
  } catch {
    // Heartbeat must not fail the command that just ran.
  }
});

channelCommand
  .command('create')
  .description('Create main (if missing) or a new coded channel with purpose (do not register)')
  .option('-C, --channel <code>', 'Channel code (default: main)')
  .option('--code <code>', 'Alias for --channel')
  .option('--purpose <text>', 'Channel purpose / topic')
  .option('--by <name>', 'Creator label (default: configured human name)')
  .action(async (opts) => {
    try {
      const code = (opts.code || opts.channel || MAIN_CHANNEL_CODE).trim() || MAIN_CHANNEL_CODE;
      const by = opts.by || getHumanName();
      if (code === MAIN_CHANNEL_CODE) {
        channelStore.ensureMain(by);
        let state = channelStore.requireChannel(MAIN_CHANNEL_CODE);
        if (opts.purpose) {
          state = channelStore.updateChannel(MAIN_CHANNEL_CODE, { purpose: opts.purpose });
          await relayChannelUpdated(state.meta);
          console.log(pc.green(`✓ Channel #main purpose updated`));
          console.log(pc.dim(`  purpose: ${state.meta.purpose}`));
          return;
        }
        console.log(pc.green(`✓ Channel #main ready (created ${state.meta.createdAt} by ${state.meta.createdBy})`));
        return;
      }
      const purpose = (opts.purpose || '').trim();
      if (!purpose) {
        console.error(pc.red('✗ --purpose is required when creating a non-main channel'));
        process.exit(1);
      }
      const state = channelStore.createChannel({
        code,
        purpose,
        createdBy: by,
      });
      await relayChannelCreated(state.meta);
      console.log(pc.green(`✓ Channel #${state.meta.code} created`));
      console.log(pc.dim(`  purpose: ${state.meta.purpose}`));
      console.log(pc.dim(`  by: ${state.meta.createdBy} at ${state.meta.createdAt}`));
    } catch (err: any) {
      console.error(pc.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

channelCommand
  .command('list')
  .description('List all channels')
  .option('--json', 'Output as JSON')
  .action((opts) => {
    channelStore.ensureMain();
    const list = channelStore.listChannels();
    if (opts.json) {
      console.log(JSON.stringify(list, null, 2));
      return;
    }
    for (const c of list) {
      const lock = c.deletable ? '' : ' (protected)';
      console.log(pc.cyan(`#${c.code}`) + lock);
      console.log(`  purpose: ${c.purpose}`);
      console.log(`  agents: ${c.agentCount}  msgs: ${c.messageCount}  by ${c.createdBy}`);
      console.log('');
    }
  });

channelCommand
  .command('human [name]')
  .description('Show or set the human participant display name')
  .action((name) => {
    try {
      if (!name || !String(name).trim()) {
        console.log(getHumanName());
        return;
      }
      const saved = setHumanName(String(name));
      console.log(pc.green(`✓ Human channel name set to: ${saved}`));
    } catch (err: any) {
      console.error(pc.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

channelCommand
  .command('status')
  .description('Show channel status')
  .option('-C, --channel <code>', 'Channel code', MAIN_CHANNEL_CODE)
  .option('--json', 'Output as JSON')
  .action((opts) => {
    const code = chCode(opts);
    channelStore.ensureMain();
    const status = channelStore.getStatus(code);
    if (opts.json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }
    if (!status.exists) {
      console.log(pc.yellow(`No channel #${code}. Create with: agent-notify channel create --code ${code} --purpose "..."`));
      return;
    }
    console.log(pc.cyan(`📡 Channel #${status.code}`));
    console.log(`  Purpose:  ${status.purpose}`);
    console.log(`  Created:  ${status.createdAt} by ${status.createdBy}`);
    console.log(`  Agents:   ${status.agentCount}`);
    console.log(`  Messages: ${status.messageCount}`);
    console.log(`  Delete:   ${status.deletable ? 'allowed' : 'protected (main)'}`);
  });

channelCommand
  .command('update-channel')
  .description('Update a channel purpose (do not register)')
  .requiredOption('-C, --channel <code>', 'Channel code')
  .requiredOption('--purpose <text>', 'New purpose')
  .action(async (opts) => {
    try {
      const state = channelStore.updateChannel(opts.channel, { purpose: opts.purpose });
      await relayChannelUpdated(state.meta);
      console.log(pc.green(`✓ Updated #${state.meta.code}`));
      console.log(pc.dim(`  purpose: ${state.meta.purpose}`));
    } catch (err: any) {
      console.error(pc.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

channelCommand
  .command('delete')
  .description('Delete a non-main channel (archives full channel first; do not register)')
  .requiredOption('-C, --channel <code>', 'Channel code (not main)')
  .action(async (opts) => {
    try {
      const result = channelStore.deleteChannel(opts.channel);
      await relayChannelDeleted(result.code, result.archivePath);
      console.log(pc.green(`✓ Deleted #${result.code}`));
      console.log(pc.dim(`  Archive: ${result.archivePath}`));
    } catch (err: any) {
      console.error(pc.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

channelCommand
  .command('register')
  .description('Register an agent on a channel')
  .option('-C, --channel <code>', 'Channel code', MAIN_CHANNEL_CODE)
  .requiredOption('-n, --name <name>', 'Unique agent name')
  .requiredOption('-b, --bio <bio>', 'Short bio / current status')
  .option('-m, --model <model>', 'Model name', 'unknown')
  .option('-d, --dir <path>', 'Working directory (default: cwd)')
  .action(async (opts) => {
    try {
      const code = chCode(opts);
      const agent = channelStore.register(code, {
        name: opts.name,
        bio: opts.bio,
        model: opts.model,
        dir: opts.dir,
      });
      await relayAgentRegistered(agent, code);
      console.log(pc.green(`✓ Registered as ${agent.name} on #${code}`));
      console.log(pc.dim(`  bio:   ${agent.bio}`));
      console.log(pc.dim(`  model: ${agent.model}`));
      console.log(pc.dim(`  dir:   ${agent.dir}`));
    } catch (err: any) {
      console.error(pc.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

channelCommand
  .command('update')
  .description('Update an agent bio / model / dir')
  .option('-C, --channel <code>', 'Channel code', MAIN_CHANNEL_CODE)
  .requiredOption('-n, --name <name>', 'Registered agent name')
  .option('-b, --bio <bio>', 'Updated bio / status')
  .option('-m, --model <model>', 'Updated model name')
  .option('-d, --dir <path>', 'Updated working directory')
  .action(async (opts) => {
    try {
      if (opts.bio === undefined && opts.model === undefined && opts.dir === undefined) {
        console.error(pc.red('✗ Provide at least one of --bio, --model, --dir'));
        process.exit(1);
      }
      const code = chCode(opts);
      const agent = channelStore.update(code, {
        name: opts.name,
        bio: opts.bio,
        model: opts.model,
        dir: opts.dir,
      });
      await relayAgentUpdated(agent, code);
      console.log(pc.green(`✓ Updated ${agent.name} on #${code}`));
      console.log(pc.dim(`  bio:   ${agent.bio}`));
      console.log(pc.dim(`  model: ${agent.model}`));
      console.log(pc.dim(`  dir:   ${agent.dir}`));
    } catch (err: any) {
      console.error(pc.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

channelCommand
  .command('unregister')
  .description('Remove an agent from a channel roster')
  .option('-C, --channel <code>', 'Channel code', MAIN_CHANNEL_CODE)
  .requiredOption('-n, --name <name>', 'Registered agent name')
  .action(async (opts) => {
    try {
      const code = chCode(opts);
      const agent = channelStore.unregister(code, opts.name);
      await relayAgentUnregistered(agent, code);
      console.log(pc.green(`✓ Unregistered ${agent.name} from #${code}`));
    } catch (err: any) {
      console.error(pc.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

channelCommand
  .command('agents')
  .description('List registered agents on a channel')
  .option('-C, --channel <code>', 'Channel code', MAIN_CHANNEL_CODE)
  .option('--json', 'Output as JSON')
  .action((opts) => {
    try {
      const code = chCode(opts);
      channelStore.requireChannel(code);
      const agents = channelStore.listAgents(code);
      if (opts.json) {
        console.log(JSON.stringify(agents, null, 2));
        return;
      }
      if (agents.length === 0) {
        console.log(pc.yellow(`No agents registered on #${code}.`));
        return;
      }
      console.log(pc.dim(`Channel #${code}`));
      for (const a of agents) {
        const presence = agentPresence(a.lastSeenAt);
        console.log(pc.cyan(`● ${a.name}`) + pc.dim(`  ${presence.label}`));
        console.log(`  bio:   ${a.bio}`);
        console.log(`  model: ${a.model}`);
        console.log(`  dir:   ${a.dir}`);
        console.log(`  seen:  ${a.lastSeenAt}`);
        console.log('');
      }
    } catch (err: any) {
      console.error(pc.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

channelCommand
  .command('whoami')
  .description('Show one registered agent record')
  .option('-C, --channel <code>', 'Channel code', MAIN_CHANNEL_CODE)
  .requiredOption('-n, --name <name>', 'Agent name')
  .option('--json', 'Output as JSON')
  .action((opts) => {
    try {
      const code = chCode(opts);
      channelStore.requireChannel(code);
      const agent = channelStore.findAgent(code, opts.name);
      if (!agent) {
        console.error(pc.red(`✗ Agent "${opts.name}" is not registered on #${code}.`));
        process.exit(1);
      }
      if (opts.json) {
        console.log(JSON.stringify(agent, null, 2));
        return;
      }
      console.log(pc.cyan(`● ${agent.name}`) + pc.dim(` on #${code}`));
      console.log(`  bio:   ${agent.bio}`);
      console.log(`  model: ${agent.model}`);
      console.log(`  dir:   ${agent.dir}`);
      const presence = agentPresence(agent.lastSeenAt);
      console.log(`  registered: ${agent.registeredAt}`);
      console.log(`  updated:    ${agent.updatedAt}`);
      console.log(`  lastSeen:   ${agent.lastSeenAt}`);
      console.log(`  presence:   ${presence.label}`);
    } catch (err: any) {
      console.error(pc.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

channelCommand
  .command('heartbeat')
  .description('Mark yourself active (also implied by any channel CLI call as you)')
  .option('-C, --channel <code>', 'Channel code', MAIN_CHANNEL_CODE)
  .option('-n, --name <name>', 'Your registered agent name (or AGENT_NOTIFY_AGENT)')
  .option('--json', 'Output presence JSON')
  .action((opts) => {
    try {
      const code = chCode(opts);
      const name = (opts.name || process.env.AGENT_NOTIFY_AGENT || '').trim();
      if (!name) {
        console.error(pc.red('✗ --name or AGENT_NOTIFY_AGENT is required'));
        process.exit(1);
      }
      const touched = channelStore.touchAgent(code, name);
      if (!touched) {
        console.error(pc.red(`✗ Agent "${name}" is not registered on #${code}.`));
        process.exit(1);
      }
      const state = channelStore.agentState(code, touched.name);
      if (opts.json) {
        console.log(JSON.stringify(state, null, 2));
        return;
      }
      console.log(pc.green(`✓ Heartbeat ${state.name} on #${code}`) + pc.dim(` · ${state.presenceLabel}`));
    } catch (err: any) {
      console.error(pc.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

channelCommand
  .command('state')
  .description('Query agent presence (active / away / offline) without changing it unless you are the caller')
  .option('-C, --channel <code>', 'Channel code', MAIN_CHANNEL_CODE)
  .option('-n, --name <name>', 'One agent; omit to list everyone on the channel')
  .option('--json', 'Output as JSON')
  .action((opts) => {
    try {
      const code = chCode(opts);
      channelStore.requireChannel(code);
      if (opts.name) {
        const state = channelStore.agentState(code, opts.name);
        if (opts.json) {
          console.log(JSON.stringify(state, null, 2));
          return;
        }
        console.log(pc.cyan(`● ${state.name}`) + pc.dim(` on #${code}`));
        console.log(`  presence: ${state.presenceLabel} (${state.presence})`);
        console.log(`  lastSeen: ${state.lastSeenAt}` + (state.ageSec != null ? `  (${state.ageSec}s ago)` : ''));
        console.log(`  bio:      ${state.bio}`);
        console.log(`  model:    ${state.model}`);
        console.log(`  dir:      ${state.dir}`);
        return;
      }
      const list = channelStore.listAgentStates(code);
      if (opts.json) {
        console.log(JSON.stringify(list, null, 2));
        return;
      }
      if (!list.length) {
        console.log(pc.yellow(`No agents registered on #${code}.`));
        return;
      }
      for (const s of list) {
        console.log(`${pc.cyan(s.name)}  ${s.presenceLabel}  seen ${s.lastSeenAt}`);
      }
    } catch (err: any) {
      console.error(pc.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

channelCommand
  .command('say [message...]')
  .description('Post a broadcast message')
  .option('-C, --channel <code>', 'Channel code', MAIN_CHANNEL_CODE)
  .requiredOption('-f, --from <name>', 'Sender agent name (must be registered)')
  .option('--no-telegram', 'Portal/agents only — skip Telegram relay')
  .action(async (messageParts, opts) => {
    try {
      let body = (messageParts || []).join(' ').trim();
      if (!body) body = await readStdin();
      if (!body) {
        console.error(pc.red('✗ Message required (argument or stdin)'));
        process.exit(1);
      }
      const code = chCode(opts);
      const telegramRelay = opts.telegram !== false;
      const msg = channelStore.postMessage(code, {
        from: opts.from,
        body,
        kind: 'say',
        telegramRelay,
      });
      await relayChannelMessage(msg, code);
      console.log(
        pc.green(`✓ Posted as ${msg.from} on #${code}`) +
          (telegramRelay ? '' : pc.dim(' (portal only — no Telegram)'))
      );
    } catch (err: any) {
      console.error(pc.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

channelCommand
  .command('dm [message...]')
  .description('Send a DM on a channel')
  .option('-C, --channel <code>', 'Channel code', MAIN_CHANNEL_CODE)
  .requiredOption('-f, --from <name>', 'Sender agent name')
  .requiredOption('--to <name>', 'Recipient agent name (use --to; -t is reserved for --token)')
  .option('--no-telegram', 'Portal/agents only — skip Telegram relay')
  .action(async (messageParts, opts) => {
    try {
      let body = (messageParts || []).join(' ').trim();
      if (!body) body = await readStdin();
      if (!body) {
        console.error(pc.red('✗ Message required (argument or stdin)'));
        process.exit(1);
      }
      const code = chCode(opts);
      const telegramRelay = opts.telegram !== false;
      const msg = channelStore.postMessage(code, {
        from: opts.from,
        to: opts.to,
        body,
        kind: 'dm',
        telegramRelay,
      });
      await relayChannelMessage(msg, code);
      console.log(
        pc.green(`✓ DM ${msg.from} → ${msg.to} on #${code}`) +
          (telegramRelay ? '' : pc.dim(' (portal only — no Telegram)'))
      );
    } catch (err: any) {
      console.error(pc.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

channelCommand
  .command('history')
  .description('Read live conversation history')
  .option('-C, --channel <code>', 'Channel code', MAIN_CHANNEL_CODE)
  .option('-n, --limit <n>', 'Max messages (most recent)', (v) => Number.parseInt(v, 10))
  .option('-f, --from <name>', 'Filter by sender')
  .option('--dm <name>', 'Show DMs involving this agent')
  .option('--json', 'Output as JSON')
  .action((opts) => {
    try {
      const code = chCode(opts);
      channelStore.requireChannel(code);
      const messages = channelStore.getHistory(code, {
        limit: opts.limit,
        from: opts.from,
        dmWith: opts.dm,
      });
      if (opts.json) {
        console.log(JSON.stringify(messages, null, 2));
        return;
      }
      if (messages.length === 0) {
        console.log(pc.yellow(`No messages yet on #${code}.`));
        return;
      }
      for (const m of messages) {
        const ts = m.createdAt.replace('T', ' ').replace(/\.\d+Z$/, 'Z');
        const portal = m.telegramRelay === false ? pc.dim(' [portal]') : '';
        if (m.kind === 'dm') {
          console.log(pc.dim(`[${ts}]`) + ` ${pc.magenta('DM')} ${pc.cyan(m.from)} → ${pc.cyan(m.to || '?')}${portal}: ${m.body}`);
        } else {
          console.log(pc.dim(`[${ts}]`) + ` ${pc.cyan(m.from)}${portal}: ${m.body}`);
        }
      }
    } catch (err: any) {
      console.error(pc.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

channelCommand
  .command('archive')
  .description('Snapshot history + roster; reset live agents (messages kept)')
  .option('-C, --channel <code>', 'Channel code', MAIN_CHANNEL_CODE)
  .option('--label <label>', 'Optional archive label')
  .action(async (opts) => {
    try {
      const code = chCode(opts);
      const result = channelStore.archive(code, opts.label);
      await relayHistoryArchived(result.archivePath, result.messageCount, result.agentCount, code);
      console.log(
        pc.green(
          `✓ Archived #${code}: ${result.messageCount} msg(s) · ${result.agentCount} agent(s) (roster reset)`
        )
      );
      console.log(pc.dim(`  Archive: ${result.archivePath}`));
    } catch (err: any) {
      console.error(pc.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

channelCommand
  .command('clear')
  .description('Archive history + roster, then empty live chat and agents')
  .option('-C, --channel <code>', 'Channel code', MAIN_CHANNEL_CODE)
  .option('--label <label>', 'Optional archive label')
  .action(async (opts) => {
    try {
      const code = chCode(opts);
      const result = channelStore.clear(code, opts.label);
      await relayHistoryCleared(result.archivePath, result.messageCount, result.agentCount, code);
      console.log(
        pc.green(
          `✓ Cleared #${code}: ${result.messageCount} msg(s) · ${result.agentCount} agent(s)`
        )
      );
      console.log(pc.dim(`  Archive: ${result.archivePath}`));
    } catch (err: any) {
      console.error(pc.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

channelCommand
  .command('archives')
  .description('List archives (human / only if asked)')
  .option('-C, --channel <code>', 'Filter by channel code')
  .option('--json', 'Output as JSON')
  .action((opts) => {
    const archives = channelStore.listArchives(opts.channel);
    if (opts.json) {
      console.log(JSON.stringify(archives, null, 2));
      return;
    }
    if (archives.length === 0) {
      console.log(pc.yellow('No archives yet.'));
      return;
    }
    for (const a of archives) {
      const tag = a.channelDeleted ? 'deleted-channel' : a.cleared ? 'cleared' : 'snapshot';
      const ch = a.channelCode ? `#${a.channelCode}  ` : '';
      console.log(`${ch}${pc.cyan(a.filename)}  ${a.messageCount} msgs  ${tag}  ${a.archivedAt}`);
      console.log(pc.dim(`  ${a.path}`));
    }
  });

channelCommand
  .command('archive-show <filename>')
  .description('Show one archive (only if human asks)')
  .option('-C, --channel <code>', 'Channel code hint', MAIN_CHANNEL_CODE)
  .option('--json', 'Output as JSON')
  .action((filename, opts) => {
    try {
      const archive = channelStore.getArchive(filename, chCode(opts));
      if (opts.json) {
        console.log(JSON.stringify(archive, null, 2));
        return;
      }
      console.log(pc.cyan(`Archive: ${archive.filename}`) + (archive.channelCode ? pc.dim(` #${archive.channelCode}`) : ''));
      console.log(`  At: ${archive.archivedAt}  msgs: ${archive.messageCount}`);
      for (const m of archive.messages) {
        const ts = m.createdAt.replace('T', ' ').replace(/\.\d+Z$/, 'Z');
        console.log(pc.dim(`[${ts}]`) + ` ${pc.cyan(m.from)}: ${m.body}`);
      }
    } catch (err: any) {
      console.error(pc.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

channelCommand
  .command('archive-delete <filename>')
  .description('Delete one archive file (human-only unless asked)')
  .option('-C, --channel <code>', 'Channel code hint', MAIN_CHANNEL_CODE)
  .action((filename, opts) => {
    try {
      const result = channelStore.deleteArchive(filename, chCode(opts));
      console.log(pc.green(`✓ Deleted archive ${result.filename}`));
    } catch (err: any) {
      console.error(pc.red(`✗ ${err.message}`));
      process.exit(1);
    }
  });

// Command: memory
const memoryCommand = program
  .command('memory')
  .description('Manage persistent agent memory (markdown-based)');

memoryCommand
  .command('show')
  .description('Display current persistent memory contents')
  .action(() => {
    const mem = loadMemory();
    console.log(pc.cyan(`Memory file: ${getMemoryFilePath()}`));
    console.log(pc.dim('----------------------------------------'));
    console.log(mem);
  });

memoryCommand
  .command('add <note...>')
  .description('Append a persistent memory note')
  .action((notes) => {
    const noteStr = notes.join(' ');
    const entry = appendMemory(noteStr);
    console.log(pc.green(`✓ Added to memory: ${entry}`));
  });

memoryCommand
  .command('path')
  .description('Print memory.md file path')
  .action(() => {
    console.log(getMemoryFilePath());
  });

// Command: prompt
const promptCommand = program
  .command('prompt')
  .description('Manage system prompt template and preview effective prompt with memory');

promptCommand
  .command('show')
  .description('Show compiled system prompt with memory injected')
  .action(() => {
    const effective = getEffectiveSystemPrompt();
    console.log(pc.cyan(`System Prompt file: ${getSystemPromptFilePath()}`));
    console.log(pc.dim('----------------------------------------'));
    console.log(effective);
  });

promptCommand
  .command('path')
  .description('Print system_prompt.md file path')
  .action(() => {
    console.log(getSystemPromptFilePath());
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
