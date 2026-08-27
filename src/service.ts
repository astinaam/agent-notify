import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function getServiceFilePath(): string {
  return path.join(os.homedir(), '.config', 'systemd', 'user', 'agent-notify.service');
}

export function getServiceUnitContent(): string {
  const cliPath = path.join(__dirname, 'cli.js');
  const nodePath = process.execPath;
  const pathEnv = process.env.PATH || `${path.join(os.homedir(), '.local', 'bin')}:/usr/local/bin:/usr/bin:/bin`;

  return `[Unit]
Description=agent-notify Background Daemon (Telegram & Web Gateway)
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${nodePath} ${cliPath} serve
Restart=always
RestartSec=5s
Environment=NODE_ENV=production
Environment=PATH=${pathEnv}
WorkingDirectory=${os.homedir()}

[Install]
WantedBy=default.target
`;
}

export async function installSystemService(): Promise<{ success: boolean; message: string }> {
  try {
    const servicePath = getServiceFilePath();
    const serviceDir = path.dirname(servicePath);
    if (!fs.existsSync(serviceDir)) {
      fs.mkdirSync(serviceDir, { recursive: true });
    }

    const content = getServiceUnitContent();
    fs.writeFileSync(servicePath, content, 'utf8');

    // 1. Enable linger so service starts on boot without active login session
    try {
      await execAsync('loginctl enable-linger $USER');
    } catch {}

    // 2. Reload systemd user daemon
    await execAsync('systemctl --user daemon-reload');

    // 3. Enable & start service
    await execAsync('systemctl --user enable --now agent-notify.service');

    return {
      success: true,
      message: 'Systemd user service installed, enabled on boot, and started with auto-restart.',
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Failed to install systemd service: ${err.message}`,
    };
  }
}

export async function getSystemServiceStatus(): Promise<{ installed: boolean; running: boolean; statusText: string }> {
  const servicePath = getServiceFilePath();
  const installed = fs.existsSync(servicePath);
  if (!installed) {
    return {
      installed: false,
      running: false,
      statusText: 'Service is not installed.',
    };
  }

  try {
    const { stdout, stderr } = await execAsync('systemctl --user status agent-notify.service');
    const output = (stdout || stderr).trim();
    const running = output.includes('Active: active (running)');
    return { installed: true, running, statusText: output };
  } catch (err: any) {
    const output = (err.stdout || err.stderr || err.message).trim();
    const running = output.includes('Active: active (running)');
    return { installed: true, running, statusText: output };
  }
}

export async function restartSystemService(): Promise<{ success: boolean; message: string }> {
  try {
    await execAsync('systemctl --user restart agent-notify.service');
    return { success: true, message: 'Service restarted successfully.' };
  } catch (err: any) {
    return { success: false, message: `Failed to restart service: ${err.message}` };
  }
}

export async function stopSystemService(): Promise<{ success: boolean; message: string }> {
  try {
    await execAsync('systemctl --user stop agent-notify.service');
    return { success: true, message: 'Service stopped.' };
  } catch (err: any) {
    return { success: false, message: `Failed to stop service: ${err.message}` };
  }
}

export async function startSystemService(): Promise<{ success: boolean; message: string }> {
  try {
    await execAsync('systemctl --user start agent-notify.service');
    return { success: true, message: 'Service started.' };
  } catch (err: any) {
    return { success: false, message: `Failed to start service: ${err.message}` };
  }
}

export async function uninstallSystemService(): Promise<{ success: boolean; message: string }> {
  const servicePath = getServiceFilePath();
  try {
    await execAsync('systemctl --user disable --now agent-notify.service').catch(() => {});
    if (fs.existsSync(servicePath)) {
      fs.unlinkSync(servicePath);
    }
    await execAsync('systemctl --user daemon-reload').catch(() => {});
    return { success: true, message: 'Service uninstalled.' };
  } catch (err: any) {
    return { success: false, message: `Failed to uninstall service: ${err.message}` };
  }
}
