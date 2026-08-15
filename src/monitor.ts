import fs from 'node:fs';
import os from 'node:os';
import type { SystemMetrics, MonitorConfig } from './types.js';
import { TelegramClient } from './telegram.js';
import { resolveConfig } from './config.js';
import { metricsStore } from './metrics_store.js';

let lastCpuTimes: { idle: number; total: number } | null = null;

export function getSystemMetrics(diskPath = '/'): SystemMetrics {
  const hostname = os.hostname();
  const uptimeSec = Math.floor(os.uptime());
  const cpus = os.cpus();
  const cores = cpus.length || 1;
  const loadAvg = os.loadavg();

  // CPU Usage calculation
  let totalIdle = 0;
  let totalTick = 0;
  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += (cpu.times as any)[type];
    }
    totalIdle += cpu.times.idle;
  }

  let usagePct = 0;
  if (lastCpuTimes) {
    const idleDelta = totalIdle - lastCpuTimes.idle;
    const totalDelta = totalTick - lastCpuTimes.total;
    if (totalDelta > 0) {
      usagePct = Math.max(0, Math.min(100, Math.round(((totalDelta - idleDelta) / totalDelta) * 100)));
    }
  } else {
    // Fallback: estimate from 1-min load avg vs cores
    usagePct = Math.max(0, Math.min(100, Math.round((loadAvg[0] / cores) * 100)));
  }
  lastCpuTimes = { idle: totalIdle, total: totalTick };

  // RAM Calculation (Prefer /proc/meminfo on Linux for accurate available memory)
  let totalMb = Math.round(os.totalmem() / (1024 * 1024));
  let freeMb = Math.round(os.freemem() / (1024 * 1024));

  if (process.platform === 'linux' && fs.existsSync('/proc/meminfo')) {
    try {
      const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
      let memTotalKb = 0;
      let memAvailKb = 0;
      for (const line of meminfo.split('\n')) {
        if (line.startsWith('MemTotal:')) memTotalKb = Number.parseInt(line.replace(/\D/g, ''), 10);
        if (line.startsWith('MemAvailable:')) memAvailKb = Number.parseInt(line.replace(/\D/g, ''), 10);
      }
      if (memTotalKb > 0 && memAvailKb > 0) {
        totalMb = Math.round(memTotalKb / 1024);
        freeMb = Math.round(memAvailKb / 1024);
      }
    } catch {}
  }

  const usedMb = Math.max(0, totalMb - freeMb);
  const ramUsedPct = totalMb > 0 ? Math.round((usedMb / totalMb) * 100) : 0;

  // Disk Calculation (Fast native statfs)
  let diskUsedPct = 0;
  let diskUsedGb = 0;
  let diskFreeGb = 0;
  let diskTotalGb = 0;

  try {
    const targetPath = fs.existsSync(diskPath) ? diskPath : '/';
    const stat = fs.statfsSync(targetPath);
    const totalBytes = stat.bsize * stat.blocks;
    const freeBytes = stat.bsize * stat.bavail;
    const usedBytes = totalBytes - freeBytes;

    diskTotalGb = Math.round(totalBytes / (1024 * 1024 * 1024));
    diskFreeGb = Math.round(freeBytes / (1024 * 1024 * 1024));
    diskUsedGb = Math.round(usedBytes / (1024 * 1024 * 1024));
    diskUsedPct = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;
  } catch {}

  // CPU Temperature Calculation
  let tempC: number | undefined;
  const tempFiles = [
    '/sys/class/thermal/thermal_zone0/temp',
    '/sys/class/hwmon/hwmon0/temp1_input',
  ];

  for (const file of tempFiles) {
    if (fs.existsSync(file)) {
      try {
        const raw = fs.readFileSync(file, 'utf8').trim();
        const val = Number.parseInt(raw, 10);
        if (!Number.isNaN(val)) {
          tempC = Math.round((val / 1000) * 10) / 10;
          break;
        }
      } catch {}
    }
  }

  return {
    hostname,
    uptimeSec,
    cpu: {
      usagePct,
      loadAvg: loadAvg.map((l) => Math.round(l * 100) / 100),
      cores,
    },
    ram: {
      usedPct: ramUsedPct,
      usedMb,
      freeMb,
      totalMb,
    },
    disk: {
      usedPct: diskUsedPct,
      usedGb: diskUsedGb,
      freeGb: diskFreeGb,
      totalGb: diskTotalGb,
      path: diskPath,
    },
    tempC,
    timestamp: new Date().toISOString(),
  };
}

// Alert State Tracker (persisted in-memory with cooldowns)
interface AlertState {
  isAlerting: boolean;
  lastAlertTime: number;
  lastAlertValue: string;
}

const alertStates: Record<string, AlertState> = {
  ram: { isAlerting: false, lastAlertTime: 0, lastAlertValue: '' },
  disk: { isAlerting: false, lastAlertTime: 0, lastAlertValue: '' },
  cpu: { isAlerting: false, lastAlertTime: 0, lastAlertValue: '' },
  temp: { isAlerting: false, lastAlertTime: 0, lastAlertValue: '' },
};

export async function checkAndEvaluateAlerts(
  configOverride?: MonitorConfig
): Promise<{ triggeredAlerts: string[]; recoveredAlerts: string[] }> {
  const fullConfig = resolveConfig();
  const monitor = configOverride || fullConfig.monitor;

  if (!monitor || !monitor.enabled) {
    return { triggeredAlerts: [], recoveredAlerts: [] };
  }

  const cpuThresh = monitor.cpuThresholdPct ?? 90;
  const ramThresh = monitor.ramThresholdPct ?? 90;
  const diskThresh = monitor.diskThresholdPct ?? 90;
  const tempThresh = monitor.tempThresholdC ?? 80;
  const cooldownMs = (monitor.cooldownSec ?? 1800) * 1000;
  const alertOnRecovery = monitor.alertOnRecovery !== false;

  const metrics = getSystemMetrics();
  
  // Record snapshot in 7-day rolling history store
  metricsStore.recordMetrics(metrics);

  const now = Date.now();
  const issues: string[] = [];
  const recovered: string[] = [];

  // Check RAM
  const ramState = alertStates.ram;
  if (metrics.ram.usedPct >= ramThresh) {
    if (!ramState.isAlerting || now - ramState.lastAlertTime >= cooldownMs) {
      issues.push(`⚠️ <b>High RAM Usage:</b> ${metrics.ram.usedPct}% (Free: ${metrics.ram.freeMb} MB / ${metrics.ram.totalMb} MB)`);
      ramState.isAlerting = true;
      ramState.lastAlertTime = now;
      ramState.lastAlertValue = `${metrics.ram.usedPct}%`;
    }
  } else if (ramState.isAlerting) {
    ramState.isAlerting = false;
    recovered.push(`RAM usage dropped to ${metrics.ram.usedPct}% (Free: ${metrics.ram.freeMb} MB)`);
  }

  // Check Disk
  const diskState = alertStates.disk;
  if (metrics.disk.usedPct >= diskThresh) {
    if (!diskState.isAlerting || now - diskState.lastAlertTime >= cooldownMs) {
      issues.push(`⚠️ <b>High Disk Usage (/):</b> ${metrics.disk.usedPct}% (Free: ${metrics.disk.freeGb} GB / ${metrics.disk.totalGb} GB)`);
      diskState.isAlerting = true;
      diskState.lastAlertTime = now;
      diskState.lastAlertValue = `${metrics.disk.usedPct}%`;
    }
  } else if (diskState.isAlerting) {
    diskState.isAlerting = false;
    recovered.push(`Disk usage dropped to ${metrics.disk.usedPct}% (Free: ${metrics.disk.freeGb} GB)`);
  }

  // Check CPU
  const cpuState = alertStates.cpu;
  if (metrics.cpu.usagePct >= cpuThresh) {
    if (!cpuState.isAlerting || now - cpuState.lastAlertTime >= cooldownMs) {
      issues.push(`⚠️ <b>High CPU Usage:</b> ${metrics.cpu.usagePct}% (Load: ${metrics.cpu.loadAvg.join(', ')})`);
      cpuState.isAlerting = true;
      cpuState.lastAlertTime = now;
      cpuState.lastAlertValue = `${metrics.cpu.usagePct}%`;
    }
  } else if (cpuState.isAlerting) {
    cpuState.isAlerting = false;
    recovered.push(`CPU usage normalized to ${metrics.cpu.usagePct}%`);
  }

  // Check Temperature
  const tempState = alertStates.temp;
  if (metrics.tempC !== undefined && metrics.tempC >= tempThresh) {
    if (!tempState.isAlerting || now - tempState.lastAlertTime >= cooldownMs) {
      issues.push(`⚠️ <b>High CPU Temperature:</b> ${metrics.tempC}°C (Threshold: ${tempThresh}°C)`);
      tempState.isAlerting = true;
      tempState.lastAlertTime = now;
      tempState.lastAlertValue = `${metrics.tempC}°C`;
    }
  } else if (tempState.isAlerting) {
    tempState.isAlerting = false;
    recovered.push(`CPU temperature dropped to ${metrics.tempC}°C`);
  }

  // Send Alert Notification if issues detected
  if (issues.length > 0) {
    try {
      const client = new TelegramClient(fullConfig);
      const messageText =
        `🚨 <b>SYSTEM RESOURCE ALERT</b> [Host: <code>${metrics.hostname}</code>]\n\n` +
        issues.join('\n') +
        `\n\n📊 <b>System Snapshot:</b>\n` +
        `• CPU: ${metrics.cpu.usagePct}% (Load: ${metrics.cpu.loadAvg.join(', ')})\n` +
        `• RAM: ${metrics.ram.usedPct}% (${metrics.ram.usedMb}MB / ${metrics.ram.totalMb}MB)\n` +
        `• Disk: ${metrics.disk.usedPct}% (${metrics.disk.usedGb}GB / ${metrics.disk.totalGb}GB)\n` +
        (metrics.tempC !== undefined ? `• Temp: ${metrics.tempC}°C\n` : '') +
        `• Uptime: ${Math.floor(metrics.uptimeSec / 3600)}h ${Math.floor((metrics.uptimeSec % 3600) / 60)}m`;

      await client.sendMessage({
        text: messageText,
        agent: 'SystemMonitor',
        level: 'error',
        parseMode: 'HTML',
      });
    } catch (err: any) {
      console.error(`[SystemMonitor] Failed to send alert: ${err.message}`);
    }
  }

  // Send Recovery Notification if alertOnRecovery is true
  if (recovered.length > 0 && alertOnRecovery) {
    try {
      const client = new TelegramClient(fullConfig);
      const messageText =
        `✅ <b>SYSTEM RESOURCE RECOVERED</b> [Host: <code>${metrics.hostname}</code>]\n\n` +
        recovered.map((r) => `• ${r}`).join('\n');

      await client.sendMessage({
        text: messageText,
        agent: 'SystemMonitor',
        level: 'success',
        parseMode: 'HTML',
      });
    } catch (err: any) {
      console.error(`[SystemMonitor] Failed to send recovery: ${err.message}`);
    }
  }

  return { triggeredAlerts: issues, recoveredAlerts: recovered };
}

let monitorTimer: NodeJS.Timeout | null = null;

export function startMonitorService(): void {
  const config = resolveConfig();
  if (!config.monitor || !config.monitor.enabled) {
    return;
  }

  if (monitorTimer) {
    clearInterval(monitorTimer);
  }

  const intervalSec = Math.max(15, config.monitor.checkIntervalSec || 60);

  // Initial check
  checkAndEvaluateAlerts().catch(() => {});

  monitorTimer = setInterval(() => {
    checkAndEvaluateAlerts().catch(() => {});
  }, intervalSec * 1000);

  monitorTimer.unref(); // Ensure it doesn't prevent Node process exits
}

export function stopMonitorService(): void {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
}
