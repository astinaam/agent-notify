import os from 'node:os';
import { execSync } from 'node:child_process';
import type { NetworkAddresses, TelegramConfig } from './types.js';

let cachedAddresses: NetworkAddresses | null = null;
let lastCheckTime = 0;

export function detectTailscaleInfo(): { ip?: string; dnsName?: string } {
  try {
    const output = execSync('tailscale status --json', {
      timeout: 1500,
      stdio: ['pipe', 'pipe', 'ignore'],
    }).toString('utf8');
    const status = JSON.parse(output);

    const ip = status.TailscaleIPs?.[0] || status.Self?.TailscaleIPs?.[0];
    let dnsName = status.Self?.DNSName;
    if (dnsName && dnsName.endsWith('.')) {
      dnsName = dnsName.slice(0, -1);
    }
    return { ip, dnsName };
  } catch {
    // Fallback: check network interfaces
    const interfaces = os.networkInterfaces();
    for (const [name, addrs] of Object.entries(interfaces)) {
      if (name.toLowerCase().includes('tailscale') && addrs) {
        for (const addr of addrs) {
          if (addr.family === 'IPv4' && !addr.internal) {
            return { ip: addr.address };
          }
        }
      }
    }

    // Secondary fallback: check any 100.64.0.0/10 address
    for (const addrs of Object.values(interfaces)) {
      if (addrs) {
        for (const addr of addrs) {
          if (addr.family === 'IPv4' && !addr.internal && addr.address.startsWith('100.')) {
            return { ip: addr.address };
          }
        }
      }
    }

    return {};
  }
}

export function detectLocalLanIp(): string {
  const interfaces = os.networkInterfaces();
  const candidates: string[] = [];

  // Preferred interface names
  const preferred = ['eth0', 'wlan0', 'en0', 'en1', 'wlan', 'eth'];

  for (const pref of preferred) {
    const addrs = interfaces[pref];
    if (addrs) {
      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal) {
          return addr.address;
        }
      }
    }
  }

  // Scan all non-internal IPv4
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (name.toLowerCase().includes('docker') || name.toLowerCase().includes('br-') || name.toLowerCase().includes('veth')) {
      continue;
    }
    if (addrs) {
      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal) {
          // Standard private network ranges
          if (
            addr.address.startsWith('192.168.') ||
            addr.address.startsWith('10.') ||
            /^172\.(1[6-9]|2\d|3[0-1])\./.test(addr.address)
          ) {
            return addr.address;
          }
          candidates.push(addr.address);
        }
      }
    }
  }

  return candidates[0] || '127.0.0.1';
}

export function getNetworkAddresses(port = 4173, config?: Partial<TelegramConfig>): NetworkAddresses {
  const now = Date.now();
  if (cachedAddresses && now - lastCheckTime < 10000 && cachedAddresses.port === port) {
    return cachedAddresses;
  }

  const lanIp = config?.lanHost || detectLocalLanIp();
  const tailscaleInfo = detectTailscaleInfo();
  const tailscaleIp = config?.tailscaleHost || tailscaleInfo.ip;
  const tailscaleDns = tailscaleInfo.dnsName;

  const localLanUrl = `http://${lanIp}:${port}`;
  const localhostUrl = `http://localhost:${port}`;
  const tailscaleUrl = tailscaleDns
    ? `http://${tailscaleDns}:${port}`
    : tailscaleIp
    ? `http://${tailscaleIp}:${port}`
    : undefined;

  cachedAddresses = {
    port,
    localLanIp: lanIp,
    localLanUrl,
    tailscaleIp,
    tailscaleDns,
    tailscaleUrl,
    localhostUrl,
  };
  lastCheckTime = now;

  return cachedAddresses;
}

export function getMessageLinks(
  messageId: string,
  port = 4173,
  config?: Partial<TelegramConfig>
): { tailscale: string; lan: string; local: string } {
  const addrs = getNetworkAddresses(port, config);
  const tailscaleBase = addrs.tailscaleUrl || addrs.localLanUrl;

  return {
    tailscale: `${tailscaleBase}/#msg-${messageId}`,
    lan: `${addrs.localLanUrl}/#msg-${messageId}`,
    local: `${addrs.localhostUrl}/#msg-${messageId}`,
  };
}
