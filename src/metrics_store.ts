import fs from 'node:fs';
import path from 'node:path';
import { getConfigDir } from './config.js';
import type { SystemMetrics } from './types.js';

export interface MetricDataPoint {
  t: number; // timestamp in ms
  c: number; // CPU usage %
  r: number; // RAM usage %
  d: number; // Disk usage %
  k?: number; // CPU Temp in °C
  l: number; // 1-min load avg
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

class MetricsStore {
  private filePath: string;
  private points: MetricDataPoint[] = [];
  private loaded = false;

  constructor() {
    this.filePath = path.join(getConfigDir(), 'metrics_history.json');
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;

    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const data: MetricDataPoint[] = JSON.parse(raw);
        if (Array.isArray(data)) {
          const cutoff = Date.now() - SEVEN_DAYS_MS;
          this.points = data.filter((p) => p && p.t && p.t >= cutoff);
        }
      } catch {
        this.points = [];
      }
    }
  }

  private persist(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.filePath, JSON.stringify(this.points), 'utf8');
  }

  recordMetrics(metrics: SystemMetrics): void {
    this.ensureLoaded();

    const now = Date.now();
    const point: MetricDataPoint = {
      t: now,
      c: metrics.cpu.usagePct,
      r: metrics.ram.usedPct,
      d: metrics.disk.usedPct,
      k: metrics.tempC,
      l: metrics.cpu.loadAvg[0] ?? 0,
    };

    this.points.push(point);

    // Prune data older than 7 days
    const cutoff = now - SEVEN_DAYS_MS;
    while (this.points.length > 0 && this.points[0].t < cutoff) {
      this.points.shift();
    }

    this.persist();
  }

  getHistory(range: '1h' | '6h' | '24h' | '7d' = '24h', maxPoints = 120): {
    points: MetricDataPoint[];
    range: string;
    totalSamples: number;
    startTime: number;
    endTime: number;
  } {
    this.ensureLoaded();

    const now = Date.now();
    let durationMs: number;

    switch (range) {
      case '1h':
        durationMs = 60 * 60 * 1000;
        break;
      case '6h':
        durationMs = 6 * 60 * 60 * 1000;
        break;
      case '7d':
        durationMs = 7 * 24 * 60 * 60 * 1000;
        break;
      case '24h':
      default:
        durationMs = 24 * 60 * 60 * 1000;
        break;
    }

    const cutoff = now - durationMs;
    const filtered = this.points.filter((p) => p.t >= cutoff);

    if (filtered.length <= maxPoints) {
      return {
        points: filtered,
        range,
        totalSamples: filtered.length,
        startTime: cutoff,
        endTime: now,
      };
    }

    // Downsample evenly to maxPoints for clean & fast SVG charts
    const step = filtered.length / maxPoints;
    const downsampled: MetricDataPoint[] = [];

    for (let i = 0; i < maxPoints; i++) {
      const idx = Math.min(filtered.length - 1, Math.floor(i * step));
      downsampled.push(filtered[idx]);
    }

    // Always include the most recent point
    if (filtered.length > 0) {
      downsampled[downsampled.length - 1] = filtered[filtered.length - 1];
    }

    return {
      points: downsampled,
      range,
      totalSamples: filtered.length,
      startTime: cutoff,
      endTime: now,
    };
  }

  clearHistory(): void {
    this.points = [];
    this.persist();
  }
}

export const metricsStore = new MetricsStore();
