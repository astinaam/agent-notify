// agent-notify Web Dashboard — Messages & System Metrics Controller

const state = {
  activeView: 'messages', // 'messages' | 'channel' | 'archives' | 'system'
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
  channel: {
    activeCode: 'main',
    channels: [],
    status: { exists: false, agentCount: 0, messageCount: 0 },
    agents: [],
    messages: [],
    archives: [],
    filterAgent: '',
    humanName: 'Human',
  },
  archives: {
    list: [],
    selected: null, // filename
    detail: null,
  },
};

// DOM Elements
const dom = {
  body: document.body,
  tabMessages: document.getElementById('tabMessages'),
  tabChannel: document.getElementById('tabChannel'),
  tabArchives: document.getElementById('tabArchives'),
  tabSystem: document.getElementById('tabSystem'),
  messagesView: document.getElementById('messagesView'),
  channelView: document.getElementById('channelView'),
  archivesView: document.getElementById('archivesView'),
  systemView: document.getElementById('systemView'),
  sidebar: document.getElementById('sidebar'),
  searchContainer: document.getElementById('searchHeaderContainer'),
  channelAgentCount: document.getElementById('channelAgentCount'),
  channelListCount: document.getElementById('channelListCount'),
  channelCodeList: document.getElementById('channelCodeList'),
  channelListSidebar: document.getElementById('channelListSidebar'),
  channelListToggleBtn: document.getElementById('channelListToggleBtn'),
  channelListCloseBtn: document.getElementById('channelListCloseBtn'),
  channelStatusPill: document.getElementById('channelStatusPill'),
  channelAgentList: document.getElementById('channelAgentList'),
  channelMessages: document.getElementById('channelMessages'),
  channelEmpty: document.getElementById('channelEmpty'),
  channelChatTitle: document.getElementById('channelChatTitle'),
  channelChatSub: document.getElementById('channelChatSub'),
  channelRefreshBtn: document.getElementById('channelRefreshBtn'),
  channelMoreMenu: document.getElementById('channelMoreMenu'),
  channelMoreBtn: document.getElementById('channelMoreBtn'),
  channelMoreDropdown: document.getElementById('channelMoreDropdown'),
  channelComposeForm: document.getElementById('channelComposeForm'),
  channelComposeInput: document.getElementById('channelComposeInput'),
  channelComposeBtn: document.getElementById('channelComposeBtn'),
  channelRoster: document.getElementById('channelRoster'),
  channelRosterToggleBtn: document.getElementById('channelRosterToggleBtn'),
  channelRosterCloseBtn: document.getElementById('channelRosterCloseBtn'),
  archivesCount: document.getElementById('archivesCount'),
  archivesList: document.getElementById('archivesList'),
  archivesMessages: document.getElementById('archivesMessages'),
  archivesDetailTitle: document.getElementById('archivesDetailTitle'),
  archivesDetailSub: document.getElementById('archivesDetailSub'),
  archivesRefreshBtn: document.getElementById('archivesRefreshBtn'),
  archivesDeleteBtn: document.getElementById('archivesDeleteBtn'),
  agentProfileOverlay: document.getElementById('agentProfileOverlay'),
  agentProfilePopup: document.getElementById('agentProfilePopup'),
  agentProfileClose: document.getElementById('agentProfileClose'),
  agentProfileHead: document.getElementById('agentProfileHead'),
  agentProfileName: document.getElementById('agentProfileName'),
  agentProfileModel: document.getElementById('agentProfileModel'),
  agentProfilePresence: document.getElementById('agentProfilePresence'),
  agentProfileBio: document.getElementById('agentProfileBio'),
  agentProfileDir: document.getElementById('agentProfileDir'),
  filtersToggleBtn: document.getElementById('filtersToggleBtn'),
  mobileOverlay: document.getElementById('mobileOverlay'),
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
  lanChip: document.getElementById('lanChip'),
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

function closeMobileDrawers() {
  document.body.classList.remove('drawer-open');
  if (dom.sidebar) dom.sidebar.classList.remove('mobile-open');
  if (dom.channelRoster) dom.channelRoster.classList.remove('mobile-open');
  if (dom.channelListSidebar) dom.channelListSidebar.classList.remove('mobile-open');
  if (dom.filtersToggleBtn) dom.filtersToggleBtn.setAttribute('aria-expanded', 'false');
  if (dom.channelRosterToggleBtn) dom.channelRosterToggleBtn.setAttribute('aria-expanded', 'false');
  if (dom.channelListToggleBtn) dom.channelListToggleBtn.setAttribute('aria-expanded', 'false');
  if (dom.mobileOverlay) dom.mobileOverlay.hidden = true;
}

function openFiltersDrawer() {
  if (!dom.sidebar || state.activeView !== 'messages') return;
  closeMobileDrawers();
  dom.sidebar.classList.add('mobile-open');
  document.body.classList.add('drawer-open');
  if (dom.mobileOverlay) dom.mobileOverlay.hidden = false;
  if (dom.filtersToggleBtn) dom.filtersToggleBtn.setAttribute('aria-expanded', 'true');
}

function openChannelRosterDrawer() {
  if (!dom.channelRoster || state.activeView !== 'channel') return;
  closeMobileDrawers();
  dom.channelRoster.classList.add('mobile-open');
  document.body.classList.add('drawer-open');
  if (dom.mobileOverlay) dom.mobileOverlay.hidden = false;
  if (dom.channelRosterToggleBtn) dom.channelRosterToggleBtn.setAttribute('aria-expanded', 'true');
}

function openChannelListDrawer() {
  if (!dom.channelListSidebar || state.activeView !== 'channel') return;
  closeMobileDrawers();
  dom.channelListSidebar.classList.add('mobile-open');
  document.body.classList.add('drawer-open');
  if (dom.mobileOverlay) dom.mobileOverlay.hidden = false;
  if (dom.channelListToggleBtn) dom.channelListToggleBtn.setAttribute('aria-expanded', 'true');
}

// Switch View (Messages / Channel / Archives / System)
function switchView(viewName) {
  state.activeView = viewName;
  closeMobileDrawers();
  closeChannelMenu();

  dom.tabMessages.classList.toggle('active', viewName === 'messages');
  if (dom.tabChannel) dom.tabChannel.classList.toggle('active', viewName === 'channel');
  if (dom.tabArchives) dom.tabArchives.classList.toggle('active', viewName === 'archives');
  dom.tabSystem.classList.toggle('active', viewName === 'system');

  dom.messagesView.style.display = viewName === 'messages' ? 'flex' : 'none';
  if (dom.channelView) dom.channelView.style.display = viewName === 'channel' ? 'flex' : 'none';
  if (dom.archivesView) dom.archivesView.style.display = viewName === 'archives' ? 'flex' : 'none';
  dom.systemView.style.display = viewName === 'system' ? 'flex' : 'none';

  if (viewName === 'messages') {
    dom.sidebar.classList.remove('hidden');
    dom.searchContainer.style.display = 'flex';
    fetchMessages();
  } else if (viewName === 'channel') {
    dom.sidebar.classList.add('hidden');
    dom.searchContainer.style.display = 'none';
    fetchChannel();
  } else if (viewName === 'archives') {
    dom.sidebar.classList.add('hidden');
    dom.searchContainer.style.display = 'none';
    fetchArchivesPage();
  } else {
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

  // Tooltip interaction & touch scrubbing
  const tooltip = container.querySelector('.chart-tooltip');
  const pointsElements = container.querySelectorAll('.chart-point');

  function showTooltip(pt) {
    if (!pt || !tooltip) return;
    const rect = container.getBoundingClientRect();
    const scaleX = rect.width / width;
    const scaleY = rect.height / height;

    tooltip.innerHTML = `
      <div class="tooltip-val">${pt.val}${unit}</div>
      <div class="tooltip-time">${formatFullTime(new Date(pt.t).toISOString())}</div>
    `;
    const rawX = pt.x * scaleX;
    const rawY = pt.y * scaleY;
    // Clamp tooltip within container so it never overflows offscreen on phones
    const clampedX = Math.max(50, Math.min(rect.width - 50, rawX));
    tooltip.style.left = `${clampedX}px`;
    tooltip.style.top = `${Math.max(28, rawY)}px`;
    tooltip.style.display = 'block';
  }

  function hideTooltip() {
    if (tooltip) tooltip.style.display = 'none';
  }

  pointsElements.forEach((ptEl) => {
    ptEl.addEventListener('mouseenter', () => {
      const idx = Number.parseInt(ptEl.getAttribute('data-idx'), 10);
      showTooltip(coords[idx]);
    });

    ptEl.addEventListener('mouseleave', hideTooltip);
  });

  // Mobile Touch Scrubbing
  let touchTimer = null;
  const handleTouch = (e) => {
    if (!coords || coords.length === 0) return;
    const touch = e.touches ? e.touches[0] : e;
    if (!touch) return;
    const rect = container.getBoundingClientRect();
    const touchX = touch.clientX - rect.left;
    const relX = (touchX / rect.width) * width;

    let closest = coords[0];
    let minDiff = Math.abs(coords[0].x - relX);
    for (let i = 1; i < coords.length; i++) {
      const diff = Math.abs(coords[i].x - relX);
      if (diff < minDiff) {
        minDiff = diff;
        closest = coords[i];
      }
    }
    if (closest) {
      showTooltip(closest);
      if (touchTimer) clearTimeout(touchTimer);
      touchTimer = setTimeout(hideTooltip, 2800);
    }
  };

  container.addEventListener('touchstart', handleTouch, { passive: true });
  container.addEventListener('touchmove', handleTouch, { passive: true });
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

    state.messages = Array.isArray(data.items) ? data.items : Array.isArray(data.messages) ? data.messages : [];
    state.total = data.total ?? state.messages.length;

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

  const totalCount = state.stats?.totalMessages || state.total || 0;
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
        <span class="nav-badge">${a.messageCount || 0}</span>
      </button>
    `;
  });

  dom.agentsList.innerHTML = html;
}

function renderStatsBadges() {
  if (!state.stats) return;
  if (dom.statTotal) dom.statTotal.textContent = state.stats.totalMessages || state.total || 0;
  if (dom.statAgents) dom.statAgents.textContent = state.stats.totalAgents || (state.agents ? state.agents.length : 0);
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
    if (dom.tailscaleChip) {
      dom.tailscaleChip.onclick = () => copyToClipboard(network.tailscaleUrl, 'Tailscale URL copied!');
    }
  }
  if (dom.lanLabel && network.localLanUrl) {
    dom.lanLabel.textContent = 'LAN';
    if (dom.lanChip) {
      dom.lanChip.onclick = () => copyToClipboard(network.localLanUrl, 'Local LAN URL copied!');
    }
  }
}

function renderMessagesFeed() {
  if (!dom.feedContainer) return;

  if (!state.messages || state.messages.length === 0) {
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
    if (msg) {
      html += buildMessageCardHtml(msg);
    }
  });

  dom.feedContainer.innerHTML = html;
  attachFeedEventListeners();
  checkUrlAnchorHighlight();
}

function buildMessageCardHtml(msg) {
  const msgId = msg.id || ('msg_' + Math.random().toString(36).slice(2, 10));
  const levelClass = `level-${msg.level || 'info'}`;
  const relativeTime = formatRelativeTime(msg.createdAt);
  const fullTime = formatFullTime(msg.createdAt);
  const idTag = msg.id ? `#${msg.id.slice(-8)}` : '';

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
            <button class="btn-ask-option" data-msg-id="${msgId}" data-response="${escapeHtml(opt)}">
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
            <input type="text" class="input-custom-reply" placeholder="Or type a custom reply..." id="reply-input-${msgId}" />
            <button class="btn-send-reply" data-msg-id="${msgId}">Reply</button>
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
        <a href="/api/files/${msgId}" class="btn-download" target="_blank" download="${escapeHtml(filename)}">
          ⬇ Download
        </a>
      </div>
    `;
  }

  return `
    <article class="msg-card" id="msg-${msgId}" data-id="${msgId}">
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
        <div class="msg-content">${escapeHtml(msg.content || '')}</div>
        ${askHtml}
        ${fileHtml}
      </div>

      <footer class="msg-footer">
        <div class="actions-left">
          <button class="btn-action btn-copy-text" data-text="${escapeHtml(msg.content || '')}" title="Copy message text">
            📋 Copy Text
          </button>
          <button class="btn-action btn-copy-link" data-id="${msgId}" title="Copy direct link">
            🔗 Copy Link
          </button>
        </div>
        <span class="msg-id-tag">${idTag}</span>
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

function formatArchiveLabel(archive) {
  if (archive.label) return archive.label;
  const raw = archive.archivedAt || '';
  const d = raw ? new Date(raw) : null;
  if (d && !Number.isNaN(d.getTime())) {
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  return (archive.filename || 'Archive').replace(/^channel-archive-/, '').replace(/\.json$/, '').slice(0, 24);
}

function applyChannelSnapshot(data) {
  if (data.activeCode) state.channel.activeCode = data.activeCode;
  if (Array.isArray(data.channels)) state.channel.channels = data.channels;
  if (data.status) state.channel.status = data.status;
  if (Array.isArray(data.agents)) state.channel.agents = data.agents;
  if (Array.isArray(data.messages)) state.channel.messages = data.messages;
  if (data.humanName) state.channel.humanName = data.humanName;
  if (Array.isArray(data.archives)) {
    state.channel.archives = data.archives;
  }
}

function closeChannelMenu() {
  if (dom.channelMoreDropdown) {
    dom.channelMoreDropdown.classList.remove('is-open');
    dom.channelMoreDropdown.hidden = true;
  }
  if (dom.channelMoreBtn) dom.channelMoreBtn.setAttribute('aria-expanded', 'false');
}

function toggleChannelMenu() {
  if (!dom.channelMoreDropdown || !dom.channelMoreBtn) return;
  const willOpen = !dom.channelMoreDropdown.classList.contains('is-open');
  closeChannelMenu();
  if (willOpen) {
    dom.channelMoreDropdown.hidden = false;
    dom.channelMoreDropdown.classList.add('is-open');
    dom.channelMoreBtn.setAttribute('aria-expanded', 'true');
  }
}

function monogramFromName(name) {
  const parts = String(name || '?')
    .trim()
    .split(/[\s_\-./]+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function chatheadHue(name) {
  const s = String(name || '');
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return hash % 360;
}

function findAgentProfile(name) {
  const key = String(name || '').toLowerCase();
  const human = (state.channel.humanName || 'Human').toLowerCase();
  if (key === human || key === 'human') {
    return {
      name: state.channel.humanName || 'Human',
      model: 'Human',
      bio: 'You — channel human participant',
      dir: '—',
      isHuman: true,
    };
  }
  // Prefer archived roster when viewing an archive (live roster was reset)
  const archiveAgents =
    state.activeView === 'archives' && Array.isArray(state.archives.detail?.agents)
      ? state.archives.detail.agents
      : [];
  const archived = archiveAgents.find((a) => (a.name || '').toLowerCase() === key);
  if (archived) return { ...archived, isHuman: false };

  const agents = state.channel.agents || [];
  const hit = agents.find((a) => (a.name || '').toLowerCase() === key);
  if (hit) return { ...hit, isHuman: false };
  return {
    name: name || 'Unknown',
    model: 'unknown',
    bio: 'Not currently registered on the channel',
    dir: '—',
    isHuman: false,
  };
}

const PRESENCE_ACTIVE_MS = 3 * 60 * 1000;
const PRESENCE_AWAY_MS = 10 * 60 * 1000;

function agentPresence(lastSeenAt) {
  const t = lastSeenAt ? Date.parse(lastSeenAt) : NaN;
  if (!Number.isFinite(t)) return { presence: 'offline', label: 'Offline' };
  const age = Date.now() - t;
  if (age <= PRESENCE_ACTIVE_MS) return { presence: 'active', label: 'Active now' };
  if (age <= PRESENCE_AWAY_MS) return { presence: 'away', label: 'Away' };
  return { presence: 'offline', label: 'Offline' };
}

function presenceMarkup(lastSeenAt) {
  const p = agentPresence(lastSeenAt);
  return `<span class="presence presence-${p.presence}" data-last-seen="${escapeHtml(lastSeenAt || '')}">
    <span class="presence-dot" aria-hidden="true"></span>
    <span class="presence-label">${p.label}</span>
  </span>`;
}

function refreshPresenceBadges() {
  document.querySelectorAll('[data-last-seen]').forEach((el) => {
    const p = agentPresence(el.getAttribute('data-last-seen'));
    el.classList.remove('presence-active', 'presence-away', 'presence-offline');
    el.classList.add('presence', `presence-${p.presence}`);
    const label = el.querySelector('.presence-label');
    if (label) label.textContent = p.label;
  });
}

function renderChatheadButton(name, { large = false } = {}) {
  const mono = monogramFromName(name);
  const hue = chatheadHue(name);
  const sizeClass = large ? 'chathead-lg' : '';
  return `<button type="button" class="chathead ${sizeClass}" data-agent-profile="${escapeHtml(name)}" style="--chathead-hue: ${hue}" title="${escapeHtml(name)}" aria-label="Profile: ${escapeHtml(name)}">${escapeHtml(mono)}</button>`;
}

function openAgentProfile(name) {
  const profile = findAgentProfile(name);
  if (dom.agentProfileHead) {
    dom.agentProfileHead.textContent = monogramFromName(profile.name);
    dom.agentProfileHead.style.setProperty('--chathead-hue', String(chatheadHue(profile.name)));
  }
  if (dom.agentProfileName) dom.agentProfileName.textContent = profile.name || 'Agent';
  if (dom.agentProfileModel) dom.agentProfileModel.textContent = profile.model || '—';
  if (dom.agentProfilePresence) {
    const p = agentPresence(profile.lastSeenAt);
    dom.agentProfilePresence.className = `presence presence-${p.presence}`;
    dom.agentProfilePresence.setAttribute('data-last-seen', profile.lastSeenAt || '');
    const label = dom.agentProfilePresence.querySelector('.presence-label');
    if (label) label.textContent = profile.lastSeenAt ? p.label : 'Offline';
  }
  if (dom.agentProfileBio) dom.agentProfileBio.textContent = profile.bio || '—';
  if (dom.agentProfileDir) dom.agentProfileDir.textContent = profile.dir || '—';
  if (dom.agentProfileOverlay) {
    dom.agentProfileOverlay.hidden = false;
    document.body.classList.add('agent-profile-open');
  }
}

function closeAgentProfile() {
  if (dom.agentProfileOverlay) dom.agentProfileOverlay.hidden = true;
  document.body.classList.remove('agent-profile-open');
}

function renderMessageBubbles(messages, humanLabel) {
  return messages
    .map((m) => {
      const isHuman = (m.from || '').toLowerCase() === humanLabel.toLowerCase();
      const isDm = m.kind === 'dm';
      const portalOnly = m.telegramRelay === false;
      const ts = (m.createdAt || '').replace('T', ' ').replace(/\.\d+Z$/, 'Z');
      const head = renderChatheadButton(m.from);
      return `
        <div class="channel-msg-row ${isHuman ? 'is-human' : ''}">
          ${isHuman ? '' : head}
          <div class="channel-bubble ${isHuman ? 'is-human' : ''} ${isDm ? 'is-dm' : ''} ${portalOnly ? 'is-portal-only' : ''}">
            <div class="channel-bubble-meta">
              <span class="channel-bubble-from">${escapeHtml(m.from)}${isDm ? ` → ${escapeHtml(m.to || '?')}` : ''}</span>
              ${isDm ? '<span class="channel-dm-badge">DM</span>' : ''}
              ${portalOnly ? '<span class="channel-portal-badge" title="Not relayed to Telegram">Portal</span>' : ''}
              <span>${escapeHtml(ts)}</span>
            </div>
            <div class="channel-bubble-body">${escapeHtml(m.body || '')}</div>
          </div>
          ${isHuman ? head : ''}
        </div>
      `;
    })
    .join('');
}

async function fetchChannel(code) {
  const active = code || state.channel.activeCode || 'main';
  try {
    const res = await fetch(`/api/channel?code=${encodeURIComponent(active)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    applyChannelSnapshot(data);
    state.channel.activeCode = data.activeCode || active;
    renderChannel();
  } catch (err) {
    if (dom.channelMessages) {
      dom.channelMessages.innerHTML = `<div class="channel-empty"><div class="empty-title">Failed to load channel</div><div class="empty-desc">${escapeHtml(err.message)}</div></div>`;
    }
  }
}

function selectChannel(code) {
  if (!code || code === state.channel.activeCode) return;
  state.channel.activeCode = code;
  state.channel.filterAgent = '';
  fetchChannel(code);
  if (window.matchMedia('(max-width: 768px)').matches) closeMobileDrawers();
}

function renderChannelList() {
  if (!dom.channelCodeList) return;
  const channels = state.channel.channels || [];
  const active = state.channel.activeCode || 'main';
  if (dom.channelListCount) dom.channelListCount.textContent = String(channels.length);
  if (!channels.length) {
    dom.channelCodeList.innerHTML = '<div class="channel-empty-roster">No channels</div>';
    return;
  }
  dom.channelCodeList.innerHTML = channels
    .map((c) => {
      const isActive = c.code === active;
      const lock = c.deletable === false ? '<span class="channel-lock" title="Protected">🔒</span>' : '';
      return `
        <button type="button" class="channel-code-card ${isActive ? 'active' : ''}" data-channel-code="${escapeHtml(c.code)}">
          <span class="channel-code-name">#${escapeHtml(c.code)} ${lock}</span>
          <span class="channel-code-purpose">${escapeHtml(c.purpose || '')}</span>
          <span class="channel-code-meta">${c.agentCount || 0} agents · ${c.messageCount || 0} msgs</span>
        </button>`;
    })
    .join('');
}

function renderChannel() {
  if (!dom.channelMessages) return;
  const { status, agents, messages, filterAgent, humanName, activeCode } = state.channel;
  const humanLabel = humanName || 'Human';
  const code = activeCode || status.code || 'main';

  renderChannelList();

  if (dom.channelComposeInput) {
    dom.channelComposeInput.placeholder = `Message #${code} as ${humanLabel}…`;
  }
  document.querySelectorAll('#channelMoreDropdown [data-archive-action]').forEach((btn) => {
    btn.disabled = !status.exists;
  });
  if (dom.channelRosterToggleBtn) {
    dom.channelRosterToggleBtn.textContent = `Agents (${agents.length})`;
  }
  if (dom.channelChatTitle) {
    dom.channelChatTitle.textContent = `#${code}`;
  }

  if (dom.channelAgentCount) dom.channelAgentCount.textContent = String(agents.length);
  if (dom.channelStatusPill) {
    if (status.exists) {
      dom.channelStatusPill.classList.add('active');
      dom.channelStatusPill.textContent = `#${code} · ${status.agentCount} agents · ${status.messageCount} msgs`;
    } else {
      dom.channelStatusPill.classList.remove('active');
      dom.channelStatusPill.textContent = `No channel #${code}`;
    }
  }
  if (dom.channelChatSub) {
    dom.channelChatSub.textContent = status.exists
      ? `${status.purpose || ''} · you post as ${humanLabel}`
      : 'Select or create a channel';
  }

  if (dom.channelAgentList) {
    if (!agents.length) {
      dom.channelAgentList.innerHTML = '<div class="channel-empty-roster">No agents registered</div>';
    } else {
      dom.channelAgentList.innerHTML = [
        `<button class="channel-agent-card ${!filterAgent ? 'active' : ''}" data-agent="">
          <span class="channel-agent-name">All agents</span>
          <span class="channel-agent-bio">Show full channel history</span>
        </button>`,
        ...agents.map((a) => `
          <div class="channel-agent-card ${filterAgent === a.name ? 'active' : ''}">
            ${renderChatheadButton(a.name)}
            <button type="button" class="channel-agent-card-body" data-agent="${escapeHtml(a.name)}">
              <span class="channel-agent-name">${escapeHtml(a.name)}</span>
              ${presenceMarkup(a.lastSeenAt)}
              <span class="channel-agent-bio">${escapeHtml(a.bio || '')}</span>
              <span class="channel-agent-meta">
                <span>${escapeHtml(a.model || 'unknown')}</span>
                <span title="${escapeHtml(a.dir || '')}">${escapeHtml(a.dir || '')}</span>
              </span>
            </button>
          </div>
        `),
      ].join('');
    }
  }

  if (!status.exists) {
    dom.channelMessages.innerHTML = `<div class="channel-empty"><div class="empty-title">No channel #${escapeHtml(code)}</div><div class="empty-desc">Create with <code>agent-notify channel create --code ${escapeHtml(code)} --purpose "…"</code></div></div>`;
    return;
  }

  let visible = messages;
  if (filterAgent) {
    const f = filterAgent.toLowerCase();
    visible = visible.filter(
      (m) =>
        m.from.toLowerCase() === f ||
        (m.to && m.to.toLowerCase() === f)
    );
  }

  if (!visible.length) {
    dom.channelMessages.innerHTML = `<div class="channel-empty"><div class="empty-title">No messages yet</div><div class="empty-desc">Agents: <code>channel say -C ${escapeHtml(code)} -f Name --no-telegram "…"</code>. You post here as ${escapeHtml(humanLabel)}.</div></div>`;
    return;
  }

  const wasNearBottom =
    dom.channelMessages.scrollHeight - dom.channelMessages.scrollTop - dom.channelMessages.clientHeight < 80;

  dom.channelMessages.innerHTML = renderMessageBubbles(visible, humanLabel);

  if (wasNearBottom) {
    dom.channelMessages.scrollTop = dom.channelMessages.scrollHeight;
  }
}

async function postChannelMessage(text) {
  const code = state.channel.activeCode || 'main';
  const res = await fetch('/api/channel/say', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, code }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  if (data.snapshot) applyChannelSnapshot(data.snapshot);
  else await fetchChannel(code);
  renderChannel();
}

async function archiveChannelHistory(clearAfter) {
  const code = state.channel.activeCode || 'main';
  const endpoint = clearAfter ? '/api/channel/clear' : '/api/channel/archive';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  if (data.snapshot) applyChannelSnapshot(data.snapshot);
  else await fetchChannel(code);
  renderChannel();
  showToast(
    clearAfter
      ? `Cleared #${code}: ${data.messageCount || 0} msg(s) · ${data.agentCount || 0} agent(s)`
      : `Archived #${code}: ${data.messageCount || 0} msg(s) · ${data.agentCount || 0} agent(s) (roster reset)`
  );
  if (data.filename) {
    state.archives.selected = data.filename;
  }
}

async function fetchArchivesPage() {
  try {
    const res = await fetch('/api/channel/archives');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.archives.list = data.archives || [];
    state.channel.humanName = data.humanName || state.channel.humanName;
    if (
      state.archives.selected &&
      !state.archives.list.some((a) => a.filename === state.archives.selected)
    ) {
      state.archives.selected = null;
      state.archives.detail = null;
    }
    renderArchivesPage();
    if (state.archives.selected) {
      const meta = state.archives.list.find((a) => a.filename === state.archives.selected);
      await loadArchiveDetail(state.archives.selected, meta?.channelCode);
    }
  } catch (err) {
    if (dom.archivesMessages) {
      dom.archivesMessages.innerHTML = `<div class="channel-empty"><div class="empty-title">Failed to load archives</div><div class="empty-desc">${escapeHtml(err.message)}</div></div>`;
    }
  }
}

async function loadArchiveDetail(filename, channelCode) {
  try {
    const code =
      channelCode ||
      state.archives.list.find((a) => a.filename === filename)?.channelCode ||
      'main';
    const res = await fetch(
      `/api/channel/archives/${encodeURIComponent(filename)}?code=${encodeURIComponent(code)}`
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    state.archives.selected = filename;
    state.archives.detail = data;
    renderArchivesPage();
  } catch (err) {
    showToast(err.message || 'Failed to open archive');
    state.archives.selected = null;
    state.archives.detail = null;
    renderArchivesPage();
  }
}

async function deleteSelectedArchive() {
  const filename = state.archives.selected;
  if (!filename) return;
  if (!confirm(`Delete archive permanently?\n${filename}`)) return;
  const code =
    state.archives.list.find((a) => a.filename === filename)?.channelCode ||
    state.archives.detail?.channelCode ||
    'main';
  const res = await fetch(
    `/api/channel/archives/${encodeURIComponent(filename)}?code=${encodeURIComponent(code)}`,
    { method: 'DELETE' }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  state.archives.selected = null;
  state.archives.detail = null;
  if (Array.isArray(data.archives)) {
    state.archives.list = data.archives;
  } else {
    await fetchArchivesPage();
    return;
  }
  showToast('Archive deleted');
  renderArchivesPage();
}

function renderArchivesPage() {
  const list = state.archives.list || [];
  const humanLabel = state.channel.humanName || 'Human';
  if (dom.archivesCount) dom.archivesCount.textContent = String(list.length);

  if (dom.archivesList) {
    if (!list.length) {
      dom.archivesList.innerHTML = '<div class="archives-empty-list">No archives yet — use Archive on the Channel tab</div>';
    } else {
      dom.archivesList.innerHTML = list
        .map((a) => {
          const active = state.archives.selected === a.filename;
          const tag = a.channelDeleted ? 'deleted' : a.cleared ? 'cleared' : 'snap';
          const ch = a.channelCode ? `#${a.channelCode}` : '';
          return `
            <button type="button" class="archives-item nav-item ${active ? 'active' : ''}" data-archive="${escapeHtml(a.filename)}" data-channel-code="${escapeHtml(a.channelCode || 'main')}">
              <span class="nav-icon" aria-hidden="true">📦</span>
              <span class="archives-item-title nav-text" title="${escapeHtml(a.filename)}">${escapeHtml(ch ? ch + ' · ' : '')}${escapeHtml(formatArchiveLabel(a))}</span>
              <span class="archives-item-meta nav-badge">${a.messageCount} · ${tag}</span>
            </button>
          `;
        })
        .join('');
    }
  }

  if (dom.archivesDeleteBtn) {
    dom.archivesDeleteBtn.disabled = !state.archives.selected;
  }

  if (!state.archives.detail || !state.archives.selected) {
    if (dom.archivesDetailTitle) dom.archivesDetailTitle.textContent = 'Select an archive';
    if (dom.archivesDetailSub) dom.archivesDetailSub.textContent = 'Saved channel conversations (human view)';
    if (dom.archivesMessages) {
      dom.archivesMessages.innerHTML = `<div class="channel-empty"><div class="empty-title">No archive selected</div><div class="empty-desc">Pick an archive from the list, or create one from the Channel tab.</div></div>`;
    }
    return;
  }

  const detail = state.archives.detail;
  if (dom.archivesDetailTitle) {
    dom.archivesDetailTitle.textContent = formatArchiveLabel(detail);
  }
  if (dom.archivesDetailSub) {
    const tag = detail.cleared ? 'after clear' : 'snapshot';
    dom.archivesDetailSub.textContent = `${detail.messageCount || 0} msgs · ${tag} · ${detail.archivedAt || ''}`;
  }

  const msgs = detail.messages || [];
  if (!msgs.length) {
    dom.archivesMessages.innerHTML = `<div class="channel-empty"><div class="empty-title">Empty archive</div><div class="empty-desc">This archive has no messages.</div></div>`;
    return;
  }
  dom.archivesMessages.innerHTML = renderMessageBubbles(msgs, humanLabel);
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

  eventSource.addEventListener('channel_changed', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (Array.isArray(data.channels)) state.channel.channels = data.channels;
      if (data.humanName) state.channel.humanName = data.humanName;
    } catch {
      /* ignore parse errors */
    }
    if (state.activeView === 'channel') fetchChannel();
    if (state.activeView === 'archives') fetchArchivesPage();
  });
}

// Event Listeners
function initEventListeners() {
  // Tabs
  dom.tabMessages.addEventListener('click', () => switchView('messages'));
  if (dom.tabChannel) dom.tabChannel.addEventListener('click', () => switchView('channel'));
  if (dom.tabArchives) dom.tabArchives.addEventListener('click', () => switchView('archives'));
  dom.tabSystem.addEventListener('click', () => switchView('system'));

  if (dom.filtersToggleBtn) {
    dom.filtersToggleBtn.addEventListener('click', () => {
      if (dom.sidebar?.classList.contains('mobile-open')) closeMobileDrawers();
      else openFiltersDrawer();
    });
  }

  if (dom.channelListToggleBtn) {
    dom.channelListToggleBtn.addEventListener('click', () => {
      if (!window.matchMedia('(max-width: 768px)').matches) return;
      closeChannelMenu();
      if (dom.channelListSidebar?.classList.contains('mobile-open')) closeMobileDrawers();
      else openChannelListDrawer();
    });
  }

  if (dom.channelRosterCloseBtn) {
    dom.channelRosterCloseBtn.addEventListener('click', () => closeMobileDrawers());
  }

  if (dom.channelListCloseBtn) {
    dom.channelListCloseBtn.addEventListener('click', () => closeMobileDrawers());
  }

  if (dom.channelCodeList) {
    dom.channelCodeList.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-channel-code]');
      if (!btn) return;
      selectChannel(btn.getAttribute('data-channel-code'));
    });
  }

  if (dom.mobileOverlay) {
    dom.mobileOverlay.addEventListener('click', () => closeMobileDrawers());
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAgentProfile();
      closeChannelMenu();
      closeMobileDrawers();
    }
  });

  document.addEventListener('click', (e) => {
    if (!dom.channelMoreMenu?.contains(e.target)) closeChannelMenu();
  });

  if (dom.channelMoreBtn && dom.channelMoreDropdown) {
    dom.channelMoreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleChannelMenu();
    });
    dom.channelMoreDropdown.addEventListener('click', async (e) => {
      e.stopPropagation();
      const refresh = e.target.closest('#channelRefreshBtn');
      if (refresh) {
        closeChannelMenu();
        fetchChannel();
        return;
      }
      const agentsBtn = e.target.closest('#channelRosterToggleBtn');
      if (agentsBtn) {
        closeChannelMenu();
        if (window.matchMedia('(max-width: 768px)').matches) {
          if (dom.channelRoster?.classList.contains('mobile-open')) closeMobileDrawers();
          else openChannelRosterDrawer();
        } else {
          dom.channelRoster?.classList.toggle('roster-collapsed');
        }
        return;
      }
      const btn = e.target.closest('[data-archive-action]');
      if (!btn || btn.disabled) return;
      const action = btn.getAttribute('data-archive-action');
      closeChannelMenu();
      const clearAfter = action === 'clear';
      const ok = clearAfter
        ? confirm('Archive then CLEAR live conversation? Live chat will be emptied; open Archives tab to view.')
        : confirm('Archive the current live conversation? Live chat will be kept.');
      if (!ok) return;
      try {
        document.querySelectorAll('#channelMoreDropdown [data-archive-action]').forEach((el) => {
          el.disabled = true;
        });
        await archiveChannelHistory(clearAfter);
      } catch (err) {
        showToast(err.message || 'Archive failed');
      } finally {
        const enabled = Boolean(state.channel.status.exists);
        document.querySelectorAll('#channelMoreDropdown [data-archive-action]').forEach((el) => {
          el.disabled = !enabled;
        });
      }
    });
  }

  if (dom.archivesRefreshBtn) {
    dom.archivesRefreshBtn.addEventListener('click', () => fetchArchivesPage());
  }

  if (dom.archivesDeleteBtn) {
    dom.archivesDeleteBtn.addEventListener('click', async () => {
      try {
        await deleteSelectedArchive();
      } catch (err) {
        showToast(err.message || 'Delete failed');
      }
    });
  }

  if (dom.archivesList) {
    dom.archivesList.addEventListener('click', (e) => {
      const item = e.target.closest('[data-archive]');
      if (!item) return;
      loadArchiveDetail(
        item.getAttribute('data-archive'),
        item.getAttribute('data-channel-code') || undefined
      );
    });
  }

  if (dom.channelAgentList) {
    dom.channelAgentList.addEventListener('click', (e) => {
      const profileBtn = e.target.closest('[data-agent-profile]');
      if (profileBtn) {
        e.stopPropagation();
        openAgentProfile(profileBtn.getAttribute('data-agent-profile'));
        return;
      }
      const body = e.target.closest('[data-agent]');
      if (!body) return;
      state.channel.filterAgent = body.getAttribute('data-agent') || '';
      renderChannel();
      if (window.matchMedia('(max-width: 768px)').matches) closeMobileDrawers();
    });
  }

  document.addEventListener('click', (e) => {
    const profileBtn = e.target.closest('[data-agent-profile]');
    if (profileBtn && !dom.channelAgentList?.contains(profileBtn)) {
      e.preventDefault();
      openAgentProfile(profileBtn.getAttribute('data-agent-profile'));
    }
  });

  if (dom.agentProfileClose) {
    dom.agentProfileClose.addEventListener('click', () => closeAgentProfile());
  }
  if (dom.agentProfileOverlay) {
    dom.agentProfileOverlay.addEventListener('click', (e) => {
      if (e.target === dom.agentProfileOverlay) closeAgentProfile();
    });
  }

  if (dom.channelComposeForm) {
    dom.channelComposeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = (dom.channelComposeInput?.value || '').trim();
      if (!text) return;
      try {
        if (dom.channelComposeBtn) dom.channelComposeBtn.disabled = true;
        await postChannelMessage(text);
        if (dom.channelComposeInput) dom.channelComposeInput.value = '';
        showToast('Posted to channel');
      } catch (err) {
        showToast(err.message || 'Failed to post');
      } finally {
        if (dom.channelComposeBtn) dom.channelComposeBtn.disabled = false;
      }
    });
  }

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
      if (window.matchMedia('(max-width: 768px)').matches) closeMobileDrawers();
    });
  });

  // Sidebar Type Filters
  document.querySelectorAll('#typesList .nav-item').forEach((item) => {
    item.addEventListener('click', () => {
      document.querySelectorAll('#typesList .nav-item').forEach((i) => i.classList.remove('active'));
      item.classList.add('active');
      state.activeFilter.type = item.getAttribute('data-filter-type') || '';
      fetchMessages();
      if (window.matchMedia('(max-width: 768px)').matches) closeMobileDrawers();
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
    if (window.matchMedia('(max-width: 768px)').matches) closeMobileDrawers();
  });

  // Periodic polling for system metrics if on system view
  setInterval(() => {
    if (state.activeView === 'system') {
      fetchSystemMetrics();
      fetchSystemHistory();
    }
    refreshPresenceBadges();
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
