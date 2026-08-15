// agent-notify Web Dashboard — Messages & System Metrics Controller

const state = {
  activeView: 'messages', // 'messages' | 'system'
  messages: [],
  agents: [],
  stats: null,
  activeFilter: {
    agent: '',
    level: '',
    type: '',
    search: '',
  },
  systemMetrics: null,
  historyRange: '24h',
  historyData: null,
  theme: localStorage.getItem('agent_notify_theme') || 'dark',
};

// DOM Elements
const dom = {
  body: document.body,
  tabMessages: document.getElementById('tabMessages'),
  tabSystem: document.getElementById('tabSystem'),
  messagesView: document.getElementById('messagesView'),
  systemView: document.getElementById('systemView'),
  sidebar: document.getElementById('sidebar'),
  searchContainer: document.getElementById('searchHeaderContainer'),
  themeToggle: document.getElementById('themeToggle'),
  themeIcon: document.getElementById('themeIcon'),
  feedContainer: document.getElementById('feedContainer'),
  feedLoading: document.getElementById('feedLoading'),
  searchInput: document.getElementById('searchInput'),
  clearSearch: document.getElementById('clearSearch'),
  agentsList: document.getElementById('agentsList'),
  agentsCount: document.getElementById('agentsCount'),
  totalMsgBadge: document.getElementById('totalMsgBadge'),
  statTotal: document.getElementById('statTotal'),
  statAgents: document.getElementById('statAgents'),
  statAnswered: document.getElementById('statAnswered'),
  activeFilterLabel: document.getElementById('activeFilterLabel'),
  clearFiltersBtn: document.getElementById('clearFiltersBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
  tailscaleChip: document.getElementById('tailscaleChip'),
  lanChip: document.getElementById('tailscaleChip'),
  tailscaleLabel: document.getElementById('tailscaleLabel'),
  lanLabel: document.getElementById('lanLabel'),
  toastContainer: document.getElementById('toastContainer'),

  // System Metrics DOM Elements
  metricsHostPill: document.getElementById('metricsHostPill'),
  metricsUptimePill: document.getElementById('metricsUptimePill'),
  metricsMonitorPill: document.getElementById('metricsMonitorPill'),
  rangeBtnGroup: document.getElementById('rangeBtnGroup'),
  refreshMetricsBtn: document.getElementById('refreshMetricsBtn'),
  liveCpuVal: document.getElementById('liveCpuVal'),
  liveCpuLoad: document.getElementById('liveCpuLoad'),
  liveCpuCores: document.getElementById('liveCpuCores'),
  barCpu: document.getElementById('barCpu'),
  liveRamVal: document.getElementById('liveRamVal'),
  liveRamDetails: document.getElementById('liveRamDetails'),
  liveRamTotal: document.getElementById('liveRamTotal'),
  barRam: document.getElementById('barRam'),
  liveDiskVal: document.getElementById('liveDiskVal'),
  liveDiskDetails: document.getElementById('liveDiskDetails'),
  liveDiskTotal: document.getElementById('liveDiskTotal'),
  barDisk: document.getElementById('barDisk'),
  liveTempVal: document.getElementById('liveTempVal'),
  liveTempDetails: document.getElementById('liveTempDetails'),
  liveTempStatus: document.getElementById('liveTempStatus'),
  barTemp: document.getElementById('barTemp'),
  cpuChartContainer: document.getElementById('cpuChartContainer'),
  ramChartContainer: document.getElementById('ramChartContainer'),
  diskChartContainer: document.getElementById('diskChartContainer'),
  tempChartContainer: document.getElementById('tempChartContainer'),
  cpuChartSub: document.getElementById('cpuChartSub'),
  ramChartSub: document.getElementById('ramChartSub'),
  diskChartSub: document.getElementById('diskChartSub'),
  tempChartSub: document.getElementById('tempChartSub'),
};

// Apply Initial Theme
function initTheme() {
  if (state.theme === 'light') {
    dom.body.classList.remove('theme-dark');
    dom.body.classList.add('theme-light');
    if (dom.themeIcon) dom.themeIcon.textContent = '☀️';
  } else {
    dom.body.classList.remove('theme-light');
    dom.body.classList.add('theme-dark');
    if (dom.themeIcon) dom.themeIcon.textContent = '🌙';
  }
}

// Switch View (Messages <-> System)
function switchView(viewName) {
  state.activeView = viewName;

  if (viewName === 'messages') {
    dom.tabMessages.classList.add('active');
    dom.tabSystem.classList.remove('active');
    dom.messagesView.style.display = 'flex';
    dom.systemView.style.display = 'none';
    dom.sidebar.classList.remove('hidden');
    dom.searchContainer.style.display = 'flex';
    fetchMessages();
  } else {
    dom.tabMessages.classList.remove('active');
    dom.tabSystem.classList.add('active');
    dom.messagesView.style.display = 'none';
    dom.systemView.style.display = 'flex';
    dom.sidebar.classList.add('hidden');
    dom.searchContainer.style.display = 'none';
    fetchSystemMetrics();
    fetchSystemHistory();
  }
}

// Toast Notifications
function showToast(message, duration = 2500) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span>✓</span> <span>${escapeHtml(message)}</span>`;
  dom.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 200);
  }, duration);
}

// Clipboard copy helper
function copyToClipboard(text, successMsg = 'Copied to clipboard!') {
  navigator.clipboard.writeText(text).then(() => {
    showToast(successMsg);
  }).catch(() => {
    const input = document.createElement('textarea');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
    showToast(successMsg);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatRelativeTime(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSec < 45) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatFullTime(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

// ============================================================================
// SYSTEM METRICS & 7-DAY CHARTS LOGIC
// ============================================================================

async function fetchSystemMetrics() {
  try {
    const res = await fetch('/api/system');
    if (!res.ok) return;
    const data = await res.json();
    state.systemMetrics = data.metrics;
    renderLiveMetrics(data.metrics, data.monitor);
  } catch (err) {
    console.error('Failed to fetch live system metrics:', err);
  }
}

async function fetchSystemHistory() {
  try {
    const res = await fetch(`/api/system/history?range=${state.historyRange}`);
    if (!res.ok) return;
    const history = await res.json();
    state.historyData = history;
    renderAllCharts(history);
  } catch (err) {
    console.error('Failed to fetch system history:', err);
  }
}

function renderLiveMetrics(m, monitor) {
  if (!m) return;

  // Host & Uptime
  if (dom.metricsHostPill) {
    dom.metricsHostPill.textContent = `🖥️ Host: ${m.hostname}`;
  }
  if (dom.metricsUptimePill) {
    const hours = Math.floor(m.uptimeSec / 3600);
    const mins = Math.floor((m.uptimeSec % 3600) / 60);
    dom.metricsUptimePill.textContent = `⏱️ Uptime: ${hours}h ${mins}m`;
  }
  if (dom.metricsMonitorPill) {
    if (monitor && monitor.enabled) {
      dom.metricsMonitorPill.textContent = `🟢 Monitoring Active (Every ${monitor.checkIntervalSec || 60}s)`;
      dom.metricsMonitorPill.className = 'monitor-status-pill';
    } else {
      dom.metricsMonitorPill.textContent = '⚪ Monitoring Inactive';
      dom.metricsMonitorPill.className = 'host-pill';
    }
  }

  // CPU Card
  if (dom.liveCpuVal) dom.liveCpuVal.textContent = `${m.cpu.usagePct}%`;
  if (dom.liveCpuLoad) dom.liveCpuLoad.textContent = `Load: ${m.cpu.loadAvg.join(', ')}`;
  if (dom.liveCpuCores) dom.liveCpuCores.textContent = `${m.cpu.cores} Cores`;
  if (dom.barCpu) dom.barCpu.style.width = `${m.cpu.usagePct}%`;

  // RAM Card
  if (dom.liveRamVal) dom.liveRamVal.textContent = `${m.ram.usedPct}%`;
  if (dom.liveRamDetails) dom.liveRamDetails.textContent = `Free: ${m.ram.freeMb} MB / Used: ${m.ram.usedMb} MB`;
  if (dom.liveRamTotal) dom.liveRamTotal.textContent = `${m.ram.totalMb} MB Total`;
  if (dom.barRam) dom.barRam.style.width = `${m.ram.usedPct}%`;

  // Disk Card
  if (dom.liveDiskVal) dom.liveDiskVal.textContent = `${m.disk.usedPct}%`;
  if (dom.liveDiskDetails) dom.liveDiskDetails.textContent = `Free: ${m.disk.freeGb} GB / Used: ${m.disk.usedGb} GB`;
  if (dom.liveDiskTotal) dom.liveDiskTotal.textContent = `${m.disk.totalGb} GB Total`;
  if (dom.barDisk) dom.barDisk.style.width = `${m.disk.usedPct}%`;

  // Temp Card
  if (m.tempC !== undefined) {
    if (dom.liveTempVal) dom.liveTempVal.textContent = `${m.tempC}°C`;
    if (dom.liveTempDetails) dom.liveTempDetails.textContent = m.tempC > 75 ? '⚠️ High Temperature' : 'Normal Operating Temp';
    if (dom.barTemp) dom.barTemp.style.width = `${Math.min(100, Math.round((m.tempC / 90) * 100))}%`;
  } else {
    if (dom.liveTempVal) dom.liveTempVal.textContent = 'N/A';
    if (dom.liveTempDetails) dom.liveTempDetails.textContent = 'Sensor not available';
  }
}

function renderAllCharts(history) {
  const points = history.points || [];
  const rangeLabel = state.historyRange === '1h' ? '1-hour window' : state.historyRange === '6h' ? '6-hour window' : state.historyRange === '7d' ? '7-day window' : '24-hour window';

  if (dom.cpuChartSub) dom.cpuChartSub.textContent = `${rangeLabel} (${history.totalSamples || points.length} samples)`;
  if (dom.ramChartSub) dom.ramChartSub.textContent = `${rangeLabel} (${history.totalSamples || points.length} samples)`;
  if (dom.diskChartSub) dom.diskChartSub.textContent = `${rangeLabel} (${history.totalSamples || points.length} samples)`;
  if (dom.tempChartSub) dom.tempChartSub.textContent = `${rangeLabel} (${history.totalSamples || points.length} samples)`;

  renderSvgChart(dom.cpuChartContainer, points, 'c', '%', '#38bdf8', 'rgba(56, 189, 248, 0.15)', 'cpu');
  renderSvgChart(dom.ramChartContainer, points, 'r', '%', '#818cf8', 'rgba(129, 140, 248, 0.15)', 'ram');
  renderSvgChart(dom.diskChartContainer, points, 'd', '%', '#10b981', 'rgba(16, 185, 129, 0.15)', 'disk');
  renderSvgChart(dom.tempChartContainer, points, 'k', '°C', '#f59e0b', 'rgba(245, 158, 11, 0.15)', 'temp');
}

// Native Ultra-Smooth SVG Time-Series Chart Generator
function renderSvgChart(container, points, field, unit, strokeColor, fillColor, chartKey) {
  if (!container) return;

  if (!points || points.length === 0) {
    container.innerHTML = `<div class="chart-empty">No historical data recorded yet for this range</div>`;
    return;
  }

  // Filter valid points for this metric
  const valid = points.filter((p) => p[field] !== undefined && p[field] !== null);
  if (valid.length === 0) {
    container.innerHTML = `<div class="chart-empty">No ${unit} sensor metrics recorded</div>`;
    return;
  }

  const width = 560;
  const height = 180;
  const padLeft = 40;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 30;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  // Determine Y domain
  let maxVal = 100;
  let minVal = 0;
  if (unit === '°C') {
    const temps = valid.map((p) => p[field]);
    maxVal = Math.max(90, Math.ceil(Math.max(...temps) / 10) * 10);
    minVal = Math.min(30, Math.floor(Math.min(...temps) / 10) * 10);
  }

  // Determine X domain
  const startTime = state.historyData?.startTime || valid[0].t;
  const endTime = state.historyData?.endTime || valid[valid.length - 1].t;
  const timeSpan = Math.max(1, endTime - startTime);

  // Map data to SVG coordinates
  const coords = valid.map((p) => {
    const x = padLeft + ((p.t - startTime) / timeSpan) * chartW;
    const normY = Math.max(0, Math.min(1, (p[field] - minVal) / (maxVal - minVal)));
    const y = padTop + chartH - normY * chartH;
    return { x, y, val: p[field], t: p.t };
  });

  // Build SVG Path
  let linePath = `M ${coords[0].x} ${coords[0].y}`;
  for (let i = 1; i < coords.length; i++) {
    linePath += ` L ${coords[i].x} ${coords[i].y}`;
  }

  const areaPath = `${linePath} L ${coords[coords.length - 1].x} ${padTop + chartH} L ${coords[0].x} ${padTop + chartH} Z`;

  // Build Y Gridlines and Labels
  const gridCount = 4;
  let gridSvg = '';
  for (let i = 0; i <= gridCount; i++) {
    const y = padTop + (chartH / gridCount) * i;
    const val = Math.round(maxVal - (i / gridCount) * (maxVal - minVal));
    gridSvg += `
      <line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" class="grid-line" />
      <text x="${padLeft - 6}" y="${y + 3}" class="axis-text" text-anchor="end">${val}${unit}</text>
    `;
  }

  // Build X Time Axis Labels
  const xLabelsCount = 4;
  let xLabelsSvg = '';
  for (let i = 0; i <= xLabelsCount; i++) {
    const x = padLeft + (chartW / xLabelsCount) * i;
    const t = startTime + (timeSpan / xLabelsCount) * i;
    const timeStr = formatChartTime(t, state.historyRange);
    xLabelsSvg += `
      <text x="${x}" y="${height - 8}" class="axis-text" text-anchor="${i === 0 ? 'start' : i === xLabelsCount ? 'end' : 'middle'}">${timeStr}</text>
    `;
  }

  const gradId = `grad_${chartKey}`;

  const svgHtml = `
    <svg viewBox="0 0 ${width} ${height}" class="chart-svg" preserveAspectRatio="none">
      <defs>
        <linearGradient id="${gradId}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="${strokeColor}" stop-opacity="0.35" />
          <stop offset="100%" stop-color="${strokeColor}" stop-opacity="0.0" />
        </linearGradient>
      </defs>

      <!-- Gridlines -->
      ${gridSvg}
      ${xLabelsSvg}

      <!-- Filled Area -->
      <path d="${areaPath}" fill="url(#${gradId})" class="chart-area" />

      <!-- Stroke Line -->
      <path d="${linePath}" stroke="${strokeColor}" class="chart-line" />

      <!-- Interactive Points -->
      ${coords.map((pt, idx) => `
        <circle cx="${pt.x}" cy="${pt.y}" r="3" class="chart-point" stroke="${strokeColor}" data-idx="${idx}" />
      `).join('')}
    </svg>
    <div class="chart-tooltip" style="display: none;"></div>
  `;

  container.innerHTML = svgHtml;

  // Tooltip interaction
  const tooltip = container.querySelector('.chart-tooltip');
  const pointsElements = container.querySelectorAll('.chart-point');

  pointsElements.forEach((ptEl) => {
    ptEl.addEventListener('mouseenter', (e) => {
      const idx = Number.parseInt(ptEl.getAttribute('data-idx'), 10);
      const pt = coords[idx];
      if (!pt || !tooltip) return;

      const rect = container.getBoundingClientRect();
      const scaleX = rect.width / width;
      const scaleY = rect.height / height;

      tooltip.innerHTML = `
        <div class="tooltip-val">${pt.val}${unit}</div>
        <div class="tooltip-time">${formatFullTime(new Date(pt.t).toISOString())}</div>
      `;
      tooltip.style.left = `${pt.x * scaleX}px`;
      tooltip.style.top = `${pt.y * scaleY}px`;
      tooltip.style.display = 'block';
    });

    ptEl.addEventListener('mouseleave', () => {
      if (tooltip) tooltip.style.display = 'none';
    });
  });
}

function formatChartTime(ts, range) {
  const d = new Date(ts);
  if (range === '1h' || range === '6h') {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (range === '24h') {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ============================================================================
// MESSAGES FEED CONTROLLER
// ============================================================================

async function fetchMessages() {
  try {
    const params = new URLSearchParams();
    if (state.activeFilter.agent) params.set('agent', state.activeFilter.agent);
    if (state.activeFilter.level) params.set('level', state.activeFilter.level);
    if (state.activeFilter.type) params.set('type', state.activeFilter.type);
    if (state.activeFilter.search) params.set('search', state.activeFilter.search);

    const res = await fetch(`/api/messages?${params.toString()}`);
    const data = await res.json();

    state.messages = data.messages || [];
    state.total = data.total || 0;

    renderMessagesFeed();
    updateFilterSummary();
  } catch (err) {
    console.error('Failed to fetch messages:', err);
    if (dom.feedContainer) {
      dom.feedContainer.innerHTML = `
        <div class="feed-empty">
          <span class="empty-icon">⚠️</span>
          <span class="empty-title">Failed to load message feed</span>
          <span class="empty-desc">${escapeHtml(err.message)}</span>
        </div>
      `;
    }
  }
}

async function fetchSidebarData() {
  try {
    const [agentsRes, statsRes, netRes] = await Promise.all([
      fetch('/api/agents'),
      fetch('/api/stats'),
      fetch('/api/network'),
    ]);

    const agents = await agentsRes.json();
    const stats = await statsRes.json();
    const network = await netRes.json();

    state.agents = agents || [];
    state.stats = stats || {};

    renderSidebarAgents();
    renderStatsBadges();
    renderNetworkChips(network);
  } catch (err) {
    console.error('Failed to fetch sidebar metadata:', err);
  }
}

function renderSidebarAgents() {
  if (!dom.agentsList) return;

  const totalCount = state.stats?.totalMessages || 0;
  if (dom.agentsCount) dom.agentsCount.textContent = state.agents.length;
  if (dom.totalMsgBadge) dom.totalMsgBadge.textContent = totalCount;

  let html = `
    <button class="nav-item ${state.activeFilter.agent === '' ? 'active' : ''}" data-filter-agent="">
      <span class="nav-icon">🤖</span>
      <span class="nav-text">All Agents</span>
      <span class="nav-badge">${totalCount}</span>
    </button>
  `;

  state.agents.forEach((a) => {
    const isActive = state.activeFilter.agent === a.name;
    html += `
      <button class="nav-item ${isActive ? 'active' : ''}" data-filter-agent="${escapeHtml(a.name)}">
        <span class="nav-icon">🤖</span>
        <span class="nav-text" title="${escapeHtml(a.name)}">${escapeHtml(a.name)}</span>
        <span class="nav-badge">${a.messageCount}</span>
      </button>
    `;
  });

  dom.agentsList.innerHTML = html;
}

function renderStatsBadges() {
  if (!state.stats) return;
  if (dom.statTotal) dom.statTotal.textContent = state.stats.totalMessages || 0;
  if (dom.statAgents) dom.statAgents.textContent = state.stats.totalAgents || 0;
  if (dom.statAnswered) dom.statAnswered.textContent = state.stats.byStatus?.answered || 0;

  const levels = state.stats.byLevel || {};
  const bInfo = document.getElementById('badge-info');
  const bSuccess = document.getElementById('badge-success');
  const bWarn = document.getElementById('badge-warn');
  const bError = document.getElementById('badge-error');

  if (bInfo) bInfo.textContent = levels.info || 0;
  if (bSuccess) bSuccess.textContent = levels.success || 0;
  if (bWarn) bWarn.textContent = levels.warn || 0;
  if (bError) bError.textContent = levels.error || 0;
}

function renderNetworkChips(network) {
  if (!network) return;
  if (dom.tailscaleLabel && network.tailscaleUrl) {
    dom.tailscaleLabel.textContent = 'Tailscale';
    dom.tailscaleChip.onclick = () => copyToClipboard(network.tailscaleUrl, 'Tailscale URL copied!');
  }
  if (dom.lanLabel && network.localLanUrl) {
    dom.lanLabel.textContent = 'LAN';
    dom.lanChip.onclick = () => copyToClipboard(network.localLanUrl, 'Local LAN URL copied!');
  }
}

function renderMessagesFeed() {
  if (!dom.feedContainer) return;

  if (state.messages.length === 0) {
    dom.feedContainer.innerHTML = `
      <div class="feed-empty">
        <span class="empty-icon">📭</span>
        <span class="empty-title">No messages found</span>
        <span class="empty-desc">Send your first agent notification or approval prompt using the CLI:</span>
        <span class="empty-code">agent-notify send "Hello from AI!" --agent "Antigravity"</span>
      </div>
    `;
    return;
  }

  let html = '';
  state.messages.forEach((msg) => {
    html += buildMessageCardHtml(msg);
  });

  dom.feedContainer.innerHTML = html;
  attachFeedEventListeners();
  checkUrlAnchorHighlight();
}

function buildMessageCardHtml(msg) {
  const levelClass = `level-${msg.level || 'info'}`;
  const relativeTime = formatRelativeTime(msg.createdAt);
  const fullTime = formatFullTime(msg.createdAt);

  let typeIcon = '💬';
  let typeLabel = 'Notification';
  if (msg.type === 'file') {
    typeIcon = '📎';
    typeLabel = 'File Attachment';
  } else if (msg.type === 'ask') {
    typeIcon = '❓';
    typeLabel = 'Human Approval';
  }

  // Interactive 2-Way Ask section
  let askHtml = '';
  if (msg.type === 'ask') {
    if (msg.status === 'delivered') {
      const optionsHtml = (msg.options && msg.options.length > 0)
        ? msg.options.map((opt) => `
            <button class="btn-ask-option" data-msg-id="${msg.id}" data-response="${escapeHtml(opt)}">
              ${escapeHtml(opt)}
            </button>
          `).join('')
        : '';

      askHtml = `
        <div class="ask-box interactive">
          <div class="ask-header">
            <span class="ask-badge">⚡ Action Required (Waiting for your reply)</span>
          </div>
          <div class="interactive-btn-group">
            ${optionsHtml}
          </div>
          <div class="custom-reply-box">
            <input type="text" class="input-custom-reply" placeholder="Or type a custom reply..." id="reply-input-${msg.id}" />
            <button class="btn-send-reply" data-msg-id="${msg.id}">Reply</button>
          </div>
        </div>
      `;
    } else if (msg.status === 'answered') {
      askHtml = `
        <div class="answer-status status-answered">
          <span>✓ Answered:</span>
          <strong>${escapeHtml(msg.response || '')}</strong>
          <span style="font-size: 0.75rem; color: var(--text-muted);">(${escapeHtml(msg.answeredBy || 'User')})</span>
        </div>
      `;
    } else if (msg.status === 'timed_out') {
      askHtml = `
        <div class="answer-status status-timed_out">
          <span>⚠ Request timed out without a response</span>
        </div>
      `;
    }
  }

  // File Attachment section
  let fileHtml = '';
  if (msg.type === 'file' && msg.filePath) {
    const filename = msg.fileName || 'Attached File';
    const sizeStr = formatBytes(msg.fileSize);
    fileHtml = `
      <div class="attachment-card">
        <span class="attachment-icon">📄</span>
        <div class="attachment-info">
          <span class="attachment-name">${escapeHtml(filename)}</span>
          <span class="attachment-size">${sizeStr}</span>
        </div>
        <a href="/api/files/${msg.id}" class="btn-download" target="_blank" download="${escapeHtml(filename)}">
          ⬇ Download
        </a>
      </div>
    `;
  }

  return `
    <article class="msg-card" id="msg-${msg.id}" data-id="${msg.id}">
      <header class="msg-header">
        <div class="msg-header-left">
          <span class="agent-badge">
            <span class="agent-icon">🤖</span>
            <span>${escapeHtml(msg.agent || 'Agent')}</span>
          </span>
          <span class="level-badge ${levelClass}">${escapeHtml(msg.level || 'info')}</span>
          <span class="type-pill">${typeIcon} ${typeLabel}</span>
        </div>
        <div class="msg-header-right">
          <time class="time-label" title="${fullTime}">${relativeTime}</time>
        </div>
      </header>

      <div class="msg-body">
        <div class="msg-content">${escapeHtml(msg.content)}</div>
        ${askHtml}
        ${fileHtml}
      </div>

      <footer class="msg-footer">
        <div class="actions-left">
          <button class="btn-action btn-copy-text" data-text="${escapeHtml(msg.content)}" title="Copy message text">
            📋 Copy Text
          </button>
          <button class="btn-action btn-copy-link" data-id="${msg.id}" title="Copy direct link">
            🔗 Copy Link
          </button>
        </div>
        <span class="msg-id-tag">#${msg.id.slice(-8)}</span>
      </footer>
    </article>
  `;
}

function attachFeedEventListeners() {
  // Option click
  document.querySelectorAll('.btn-ask-option').forEach((btn) => {
    btn.onclick = async (e) => {
      const id = btn.getAttribute('data-msg-id');
      const response = btn.getAttribute('data-response');
      await submitApprovalResponse(id, response);
    };
  });

  // Custom text reply click
  document.querySelectorAll('.btn-send-reply').forEach((btn) => {
    btn.onclick = async (e) => {
      const id = btn.getAttribute('data-msg-id');
      const input = document.getElementById(`reply-input-${id}`);
      if (!input || !input.value.trim()) return;
      await submitApprovalResponse(id, input.value.trim());
    };
  });

  // Copy text button
  document.querySelectorAll('.btn-copy-text').forEach((btn) => {
    btn.onclick = () => {
      const text = btn.getAttribute('data-text');
      copyToClipboard(text, 'Message text copied!');
      btn.classList.add('copied');
      btn.textContent = '✓ Copied';
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = '📋 Copy Text';
      }, 1500);
    };
  });

  // Copy link button
  document.querySelectorAll('.btn-copy-link').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-id');
      const directUrl = `${window.location.origin}/#msg-${id}`;
      copyToClipboard(directUrl, 'Direct message link copied!');
      btn.classList.add('copied');
      btn.textContent = '✓ Link Copied';
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = '🔗 Copy Link';
      }, 1500);
    };
  });
}

async function submitApprovalResponse(messageId, responseText) {
  try {
    const res = await fetch(`/api/messages/${messageId}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response: responseText, answeredBy: 'Web Dashboard' }),
    });

    if (!res.ok) {
      const err = await res.json();
      alert(`Error: ${err.error || 'Failed to submit response'}`);
      return;
    }

    showToast(`✓ Answer submitted: "${responseText}"`);
    fetchMessages();
    fetchSidebarData();
  } catch (err) {
    alert(`Network error: ${err.message}`);
  }
}

function updateFilterSummary() {
  if (!dom.activeFilterLabel) return;
  const parts = [];
  if (state.activeFilter.agent) parts.push(`agent: <strong>${escapeHtml(state.activeFilter.agent)}</strong>`);
  if (state.activeFilter.level) parts.push(`level: <strong>${escapeHtml(state.activeFilter.level)}</strong>`);
  if (state.activeFilter.type) parts.push(`type: <strong>${escapeHtml(state.activeFilter.type)}</strong>`);
  if (state.activeFilter.search) parts.push(`search: "<strong>${escapeHtml(state.activeFilter.search)}</strong>"`);

  if (parts.length > 0) {
    dom.activeFilterLabel.innerHTML = parts.join(', ');
    dom.clearFiltersBtn.style.display = 'inline-block';
  } else {
    dom.activeFilterLabel.innerHTML = 'all messages';
    dom.clearFiltersBtn.style.display = 'none';
  }
}

function checkUrlAnchorHighlight() {
  const hash = window.location.hash;
  if (hash && hash.startsWith('#msg-')) {
    const el = document.querySelector(hash);
    if (el) {
      el.classList.add('highlighted');
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

// Server-Sent Events (SSE) Live Feed Subscription
function initSSE() {
  const eventSource = new EventSource('/api/events');

  eventSource.onmessage = (e) => {};

  eventSource.addEventListener('message_added', (e) => {
    const msg = JSON.parse(e.data);
    showToast(`🔔 New message from ${msg.agent || 'Agent'}`);
    fetchMessages();
    fetchSidebarData();
  });

  eventSource.addEventListener('message_updated', (e) => {
    fetchMessages();
    fetchSidebarData();
  });
}

// Event Listeners
function initEventListeners() {
  // Tabs
  dom.tabMessages.addEventListener('click', () => switchView('messages'));
  dom.tabSystem.addEventListener('click', () => switchView('system'));

  // Theme Toggle
  dom.themeToggle.addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('agent_notify_theme', state.theme);
    initTheme();
    if (state.activeView === 'system') renderAllCharts(state.historyData || { points: [] });
  });

  // Range Selector for System Metrics
  dom.rangeBtnGroup.querySelectorAll('.btn-range').forEach((btn) => {
    btn.addEventListener('click', () => {
      dom.rangeBtnGroup.querySelectorAll('.btn-range').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.historyRange = btn.getAttribute('data-range');
      fetchSystemHistory();
    });
  });

  // Refresh Buttons
  dom.refreshBtn.addEventListener('click', () => {
    fetchMessages();
    fetchSidebarData();
  });
  dom.refreshMetricsBtn.addEventListener('click', () => {
    fetchSystemMetrics();
    fetchSystemHistory();
  });

  // Search Bar
  let searchTimeout = null;
  dom.searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    dom.clearSearch.style.display = e.target.value ? 'block' : 'none';
    searchTimeout = setTimeout(() => {
      state.activeFilter.search = e.target.value.trim();
      fetchMessages();
    }, 250);
  });

  dom.clearSearch.addEventListener('click', () => {
    dom.searchInput.value = '';
    dom.clearSearch.style.display = 'none';
    state.activeFilter.search = '';
    fetchMessages();
  });

  // Sidebar Level Filters
  document.querySelectorAll('#levelsList .nav-item').forEach((item) => {
    item.addEventListener('click', () => {
      document.querySelectorAll('#levelsList .nav-item').forEach((i) => i.classList.remove('active'));
      item.classList.add('active');
      state.activeFilter.level = item.getAttribute('data-filter-level') || '';
      fetchMessages();
    });
  });

  // Sidebar Type Filters
  document.querySelectorAll('#typesList .nav-item').forEach((item) => {
    item.addEventListener('click', () => {
      document.querySelectorAll('#typesList .nav-item').forEach((i) => i.classList.remove('active'));
      item.classList.add('active');
      state.activeFilter.type = item.getAttribute('data-filter-type') || '';
      fetchMessages();
    });
  });

  // Clear Filters
  dom.clearFiltersBtn.addEventListener('click', () => {
    state.activeFilter = { agent: '', level: '', type: '', search: '' };
    dom.searchInput.value = '';
    dom.clearSearch.style.display = 'none';
    document.querySelectorAll('.nav-item').forEach((i) => i.classList.remove('active'));
    document.querySelectorAll('.nav-item[data-filter-agent=""]').forEach((i) => i.classList.add('active'));
    document.querySelectorAll('.nav-item[data-filter-level=""]').forEach((i) => i.classList.add('active'));
    document.querySelectorAll('.nav-item[data-filter-type=""]').forEach((i) => i.classList.add('active'));
    fetchMessages();
  });

  // Agent item click delegation
  dom.agentsList.addEventListener('click', (e) => {
    const item = e.target.closest('.nav-item');
    if (!item) return;
    document.querySelectorAll('#agentsList .nav-item').forEach((i) => i.classList.remove('active'));
    item.classList.add('active');
    state.activeFilter.agent = item.getAttribute('data-filter-agent') || '';
    fetchMessages();
  });

  // Periodic polling for system metrics if on system view
  setInterval(() => {
    if (state.activeView === 'system') {
      fetchSystemMetrics();
      fetchSystemHistory();
    }
  }, 20000);
}

// Initial Boot
function init() {
  initTheme();
  initEventListeners();
  initSSE();
  fetchSidebarData();
  fetchMessages();
}

window.addEventListener('DOMContentLoaded', init);
