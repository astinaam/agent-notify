// State
const state = {
  messages: [],
  agents: [],
  stats: null,
  network: null,
  filters: {
    agent: '',
    level: '',
    type: '',
    search: '',
  },
  theme: localStorage.getItem('agent_notify_theme') || 'dark',
};

// DOM Elements
const feedContainer = document.getElementById('feedContainer');
const agentsList = document.getElementById('agentsList');
const searchInput = document.getElementById('searchInput');
const clearSearchBtn = document.getElementById('clearSearch');
const totalMsgBadge = document.getElementById('totalMsgBadge');
const activeFilterLabel = document.getElementById('activeFilterLabel');
const clearFiltersBtn = document.getElementById('clearFiltersBtn');
const refreshBtn = document.getElementById('refreshBtn');
const toastContainer = document.getElementById('toastContainer');
const themeToggle = document.getElementById('themeToggle');
const themeIcon = document.getElementById('themeIcon');
const liveStatus = document.getElementById('liveStatus');
const tailscaleChip = document.getElementById('tailscaleChip');
const lanChip = document.getElementById('lanChip');
const tailscaleLabel = document.getElementById('tailscaleLabel');
const lanLabel = document.getElementById('lanLabel');

// Toast helper
function showToast(message, icon = '✓') {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// Copy to clipboard
async function copyToClipboard(text, successMsg = 'Copied to clipboard!') {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMsg);
    return true;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showToast(successMsg);
    return true;
  }
}

// Formatting utilities
function formatTimeAgo(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffSec < 5) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Submit 2-way response from Web UI
async function submitQuestionResponse(msgId, answerText) {
  try {
    const res = await fetch(`/api/messages/${msgId}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response: answerText, answeredBy: 'Web Dashboard' }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to submit response');
    }
    showToast(`Answered: "${answerText}"`, '✅');
  } catch (err) {
    showToast(err.message, '🚨');
  }
}

// Render message card
function renderMessageCard(msg) {
  const card = document.createElement('div');
  card.className = 'msg-card';
  card.id = `msg-${msg.id}`;
  card.dataset.id = msg.id;

  const levelClass = `level-${msg.level || 'info'}`;
  const timeFormatted = formatTimeAgo(msg.createdAt);
  const fullDate = new Date(msg.createdAt).toLocaleString();

  // 2-Way Interactive Ask Box Rendering
  let askHtml = '';
  if (msg.type === 'ask') {
    if (msg.status === 'delivered') {
      // Pending response: render interactive buttons & custom input
      const buttonsHtml = msg.options && msg.options.length > 0
        ? `<div class="interactive-btn-group">
            ${msg.options.map(opt => `<button class="btn-ask-option" data-val="${escapeHtml(opt)}">${escapeHtml(opt)}</button>`).join('')}
          </div>`
        : '';

      askHtml = `
        <div class="ask-box interactive">
          <div class="ask-header">
            <span class="ask-badge">⏳ Human Decision Required</span>
          </div>
          ${buttonsHtml}
          <div class="custom-reply-box">
            <input type="text" class="input-custom-reply" placeholder="Or type a custom reply..." />
            <button class="btn-send-reply">Reply</button>
          </div>
        </div>
      `;
    } else if (msg.status === 'answered') {
      askHtml = `
        <div class="ask-box">
          <div class="answer-status status-answered">
            <b>Answered:</b> <code>${escapeHtml(msg.response || '')}</code> ${msg.answeredBy ? `by ${escapeHtml(msg.answeredBy)}` : ''} ✅
          </div>
        </div>
      `;
    } else if (msg.status === 'timed_out') {
      askHtml = `
        <div class="ask-box">
          <div class="answer-status status-timed_out">
            ⌛ <b>Timed out</b> without response
          </div>
        </div>
      `;
    }
  }

  // Attachment rendering
  let attachmentHtml = '';
  if (msg.type === 'file' && msg.fileName) {
    attachmentHtml = `
      <div class="attachment-card">
        <span class="attachment-icon">📎</span>
        <div class="attachment-info">
          <span class="attachment-name">${escapeHtml(msg.fileName)}</span>
          <span class="attachment-size">${formatBytes(msg.fileSize)}</span>
        </div>
        <a href="/api/files/${msg.id}" target="_blank" class="btn-download" download="${escapeHtml(msg.fileName)}">Download</a>
      </div>
    `;
  }

  card.innerHTML = `
    <div class="msg-header">
      <div class="msg-header-left">
        <span class="agent-badge"><span class="agent-icon">🤖</span> ${escapeHtml(msg.agent)}</span>
        <span class="level-badge ${levelClass}">${escapeHtml(msg.level)}</span>
        <span class="type-pill">${escapeHtml(msg.type)}</span>
      </div>
      <div class="msg-header-right">
        <span class="time-label" title="${fullDate}">${timeFormatted}</span>
      </div>
    </div>

    <div class="msg-body">
      <div class="msg-content">${escapeHtml(msg.content)}</div>
      ${askHtml}
      ${attachmentHtml}
    </div>

    <div class="msg-footer">
      <div class="actions-left">
        <button class="btn-action btn-copy-text" title="Copy message text">
          <span>📋</span> Copy Text
        </button>
        <button class="btn-action btn-copy-link" title="Copy direct link to this message">
          <span>🔗</span> Copy Link
        </button>
      </div>
      <span class="msg-id-tag">#${escapeHtml(msg.id)}</span>
    </div>
  `;

  // Attach button events
  const copyTextBtn = card.querySelector('.btn-copy-text');
  copyTextBtn.addEventListener('click', async () => {
    let textToCopy = msg.content;
    if (msg.response) textToCopy += `\nAnswer: ${msg.response}`;
    await copyToClipboard(textToCopy, 'Message text copied!');
    copyTextBtn.classList.add('copied');
    setTimeout(() => copyTextBtn.classList.remove('copied'), 1500);
  });

  const copyLinkBtn = card.querySelector('.btn-copy-link');
  copyLinkBtn.addEventListener('click', async () => {
    const link = `${window.location.origin}/#msg-${msg.id}`;
    await copyToClipboard(link, 'Direct message link copied!');
  });

  // Attach 2-way option button clicks
  card.querySelectorAll('.btn-ask-option').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const val = e.target.dataset.val;
      await submitQuestionResponse(msg.id, val);
    });
  });

  // Attach 2-way text reply
  const sendReplyBtn = card.querySelector('.btn-send-reply');
  const inputCustomReply = card.querySelector('.input-custom-reply');
  if (sendReplyBtn && inputCustomReply) {
    const submitCustom = async () => {
      const val = inputCustomReply.value.trim();
      if (!val) return;
      await submitQuestionResponse(msg.id, val);
    };
    sendReplyBtn.addEventListener('click', submitCustom);
    inputCustomReply.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitCustom();
    });
  }

  return card;
}

// Render Feed
function renderFeed() {
  feedContainer.innerHTML = '';

  if (state.messages.length === 0) {
    feedContainer.innerHTML = `
      <div class="feed-empty">
        <span class="empty-icon">📭</span>
        <h3 class="empty-title">No messages found</h3>
        <p class="empty-desc">Messages sent by AI agents via CLI or MCP server will automatically appear here in real-time.</p>
        <div class="empty-code">agent-notify send "Hello from terminal"</div>
      </div>
    `;
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const msg of state.messages) {
    fragment.appendChild(renderMessageCard(msg));
  }
  feedContainer.appendChild(fragment);

  checkHashHighlight();
}

// Render Sidebar Agents
function renderSidebarAgents() {
  const currentActiveAgent = state.filters.agent;
  agentsList.innerHTML = '';

  const allBtn = document.createElement('button');
  allBtn.className = `nav-item ${!currentActiveAgent ? 'active' : ''}`;
  allBtn.dataset.filterAgent = '';
  allBtn.innerHTML = `
    <span class="nav-icon">🤖</span>
    <span class="nav-text">All Agents</span>
    <span class="nav-badge">${state.stats?.total || 0}</span>
  `;
  allBtn.addEventListener('click', () => setAgentFilter(''));
  agentsList.appendChild(allBtn);

  for (const agent of state.agents) {
    const btn = document.createElement('button');
    btn.className = `nav-item ${currentActiveAgent === agent.name ? 'active' : ''}`;
    btn.dataset.filterAgent = agent.name;
    btn.innerHTML = `
      <span class="nav-icon">⚡</span>
      <span class="nav-text">${escapeHtml(agent.name)}</span>
      <span class="nav-badge">${agent.count}</span>
    `;
    btn.addEventListener('click', () => setAgentFilter(agent.name));
    agentsList.appendChild(btn);
  }

  document.getElementById('agentsCount').textContent = state.agents.length;
}

// Update stats in UI
function updateStatsUI() {
  if (!state.stats) return;
  document.getElementById('statTotal').textContent = state.stats.total || 0;
  document.getElementById('statAgents').textContent = state.stats.agentCount || 0;
  document.getElementById('statAnswered').textContent = state.stats.byType?.ask || 0;

  document.getElementById('badge-info').textContent = state.stats.byLevel?.info || 0;
  document.getElementById('badge-success').textContent = state.stats.byLevel?.success || 0;
  document.getElementById('badge-warn').textContent = state.stats.byLevel?.warn || 0;
  document.getElementById('badge-error').textContent = state.stats.byLevel?.error || 0;

  totalMsgBadge.textContent = state.stats.total || 0;
}

// Filter setters
function setAgentFilter(agentName) {
  state.filters.agent = agentName;
  updateFilterSummary();
  loadMessages();
  renderSidebarAgents();
}

function setLevelFilter(level) {
  state.filters.level = level;
  document.querySelectorAll('#levelsList .nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.filterLevel === level);
  });
  updateFilterSummary();
  loadMessages();
}

function setTypeFilter(type) {
  state.filters.type = type;
  document.querySelectorAll('#typesList .nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.filterType === type);
  });
  updateFilterSummary();
  loadMessages();
}

function updateFilterSummary() {
  const parts = [];
  if (state.filters.agent) parts.push(`agent <strong>${escapeHtml(state.filters.agent)}</strong>`);
  if (state.filters.level) parts.push(`severity <strong>${escapeHtml(state.filters.level)}</strong>`);
  if (state.filters.type) parts.push(`type <strong>${escapeHtml(state.filters.type)}</strong>`);
  if (state.filters.search) parts.push(`matching <strong>"${escapeHtml(state.filters.search)}"</strong>`);

  if (parts.length > 0) {
    activeFilterLabel.innerHTML = parts.join(', ');
    clearFiltersBtn.style.display = 'inline-block';
  } else {
    activeFilterLabel.textContent = 'all messages';
    clearFiltersBtn.style.display = 'none';
  }
}

// API Data Fetchers
async function loadMessages() {
  try {
    const params = new URLSearchParams();
    if (state.filters.agent) params.set('agent', state.filters.agent);
    if (state.filters.level) params.set('level', state.filters.level);
    if (state.filters.type) params.set('type', state.filters.type);
    if (state.filters.search) params.set('search', state.filters.search);

    const res = await fetch(`/api/messages?${params.toString()}`);
    const data = await res.json();
    state.messages = data.items || [];
    renderFeed();
  } catch (err) {
    console.error('Failed to fetch messages:', err);
  }
}

async function loadAgents() {
  try {
    const res = await fetch('/api/agents');
    state.agents = await res.json();
    renderSidebarAgents();
  } catch (err) {
    console.error('Failed to fetch agents:', err);
  }
}

async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    state.stats = await res.json();
    updateStatsUI();
  } catch (err) {
    console.error('Failed to fetch stats:', err);
  }
}

async function loadNetwork() {
  try {
    const res = await fetch('/api/network');
    state.network = await res.json();

    if (state.network.tailscaleUrl) {
      tailscaleLabel.textContent = state.network.tailscaleDns || state.network.tailscaleIp;
      tailscaleChip.style.display = 'inline-flex';
      tailscaleChip.onclick = () => copyToClipboard(state.network.tailscaleUrl, 'Tailscale link copied!');
    } else {
      tailscaleChip.style.display = 'none';
    }

    if (state.network.localLanUrl) {
      lanLabel.textContent = state.network.localLanIp;
      lanChip.onclick = () => copyToClipboard(state.network.localLanUrl, 'Local LAN link copied!');
    }
  } catch (err) {
    console.error('Failed to fetch network info:', err);
  }
}

// Real-Time SSE Listener
function initSSE() {
  const evtSource = new EventSource('/api/events');

  evtSource.onopen = () => {
    liveStatus.querySelector('.status-label').textContent = 'Live';
    liveStatus.querySelector('.status-dot').style.backgroundColor = 'var(--accent-emerald)';
  };

  evtSource.addEventListener('message_added', (e) => {
    try {
      const msg = JSON.parse(e.data);
      const matchesAgent = !state.filters.agent || state.filters.agent.toLowerCase() === msg.agent.toLowerCase();
      const matchesLevel = !state.filters.level || state.filters.level.toLowerCase() === msg.level.toLowerCase();
      const matchesType = !state.filters.type || state.filters.type.toLowerCase() === msg.type.toLowerCase();

      if (matchesAgent && matchesLevel && matchesType) {
        state.messages.unshift(msg);
        renderFeed();
        showToast(`New message from ${msg.agent}`, '🔔');
      }

      loadAgents();
      loadStats();
    } catch {}
  });

  evtSource.addEventListener('message_updated', (e) => {
    try {
      const updatedMsg = JSON.parse(e.data);
      const idx = state.messages.findIndex(m => m.id === updatedMsg.id);
      if (idx !== -1) {
        state.messages[idx] = updatedMsg;
        renderFeed();
      }
      loadStats();
    } catch {}
  });

  evtSource.onerror = () => {
    liveStatus.querySelector('.status-label').textContent = 'Connecting...';
    liveStatus.querySelector('.status-dot').style.backgroundColor = 'var(--accent-amber)';
  };
}

// Hash scroll / highlight
function checkHashHighlight() {
  const hash = window.location.hash;
  if (hash && hash.startsWith('#msg-')) {
    const el = document.querySelector(hash);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('highlighted');
      setTimeout(() => el.classList.remove('highlighted'), 2500);
    }
  }
}

// Event Listeners setup
function initEvents() {
  themeToggle.addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    document.body.className = `theme-${state.theme}`;
    themeIcon.textContent = state.theme === 'dark' ? '🌙' : '☀️';
    localStorage.setItem('agent_notify_theme', state.theme);
  });

  let searchTimer;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const val = e.target.value.trim();
    clearSearchBtn.style.display = val ? 'block' : 'none';
    searchTimer = setTimeout(() => {
      state.filters.search = val;
      updateFilterSummary();
      loadMessages();
    }, 250);
  });

  clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    clearSearchBtn.style.display = 'none';
    state.filters.search = '';
    updateFilterSummary();
    loadMessages();
  });

  document.querySelectorAll('#levelsList .nav-item').forEach(btn => {
    btn.addEventListener('click', () => setLevelFilter(btn.dataset.filterLevel));
  });

  document.querySelectorAll('#typesList .nav-item').forEach(btn => {
    btn.addEventListener('click', () => setTypeFilter(btn.dataset.filterType));
  });

  clearFiltersBtn.addEventListener('click', () => {
    state.filters = { agent: '', level: '', type: '', search: '' };
    searchInput.value = '';
    clearSearchBtn.style.display = 'none';
    document.querySelectorAll('#levelsList .nav-item').forEach(el => el.classList.toggle('active', el.dataset.filterLevel === ''));
    document.querySelectorAll('#typesList .nav-item').forEach(el => el.classList.toggle('active', el.dataset.filterType === ''));
    updateFilterSummary();
    loadMessages();
    renderSidebarAgents();
  });

  refreshBtn.addEventListener('click', () => {
    loadMessages();
    loadAgents();
    loadStats();
    showToast('Feed refreshed', '🔄');
  });

  window.addEventListener('hashchange', checkHashHighlight);
}

// Initialize
function init() {
  document.body.className = `theme-${state.theme}`;
  themeIcon.textContent = state.theme === 'dark' ? '🌙' : '☀️';

  initEvents();
  initSSE();

  loadMessages();
  loadAgents();
  loadStats();
  loadNetwork();
}

document.addEventListener('DOMContentLoaded', init);
