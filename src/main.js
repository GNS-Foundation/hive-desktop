const { invoke } = window.__TAURI__.core;

const BACKEND = 'https://gns-browser-production.up.railway.app';
const INVITE_BASE = 'https://hive.geiant.com/invite';

const views = {
    welcome: document.getElementById('view-welcome'),
    detecting: document.getElementById('view-detecting'),
    preview: document.getElementById('view-preview'),
    code: document.getElementById('view-code'),
    redeeming: document.getElementById('view-redeeming'),
    success: document.getElementById('view-success'),
    error: document.getElementById('view-error'),
    'name-prompt': document.getElementById('view-name-prompt'),
    chat: document.getElementById('view-chat'),
};

let previewData = null;
let currentDeviceId = null;
let currentDisplayName = null;
let currentQuotaRemaining = 0;
let pendingIssue = false;  // user clicked Invite before name was set

function showView(name) {
    Object.entries(views).forEach(([k, el]) => {
        if (el) el.classList.toggle('active', k === name);
    });
    document.body.classList.toggle('chat-mode', name === 'chat');
    // Belt-and-suspenders: directly hide the page-level brand header
    // when on chat (the chat-header-bar inside view-chat replaces it).
    const pageBrand = document.querySelector('main > header.brand');
    if (pageBrand) {
        pageBrand.style.display = (name === 'chat') ? 'none' : '';
    }
}
function fmtRam(mb) { return `${(mb / 1024).toFixed(1)} GB`; }
function shortPk(pk) { return `${pk.slice(0, 12)}\u2026${pk.slice(-8)}`; }

async function fetchNetworkStats() {
    const el = document.getElementById('success-network');
    if (!el) return;
    el.textContent = 'checking\u2026';
    try {
        const r = await fetch(`${BACKEND}/hive/stats`);
        const data = await r.json();
        if (data.success) {
            const s = data.data;
            const t = s.devices.total;
            const on = s.devices.online;
            const p = s.pods.total;
            el.textContent = `${t} ${t === 1 ? 'bee' : 'bees'} \u00b7 ${on} online \u00b7 ${p} active ${p === 1 ? 'pod' : 'pods'}`;
        } else {
            el.textContent = 'unavailable';
        }
    } catch (e) {
        el.textContent = 'offline';
    }
}

async function fetchQuota() {
    const qEl = document.getElementById('invite-quota-text');
    const btnEl = document.getElementById('btn-invite-friend');
    if (!qEl || !btnEl) return;
    qEl.textContent = 'checking\u2026';
    try {
        const q = await invoke('get_quota');
        if (q && q.success) {
            currentDisplayName = q.display_name || null;
            currentQuotaRemaining = q.remaining || 0;
            const remaining = q.remaining || 0;
            const total = q.quota_total || 0;
            qEl.textContent = `${remaining} / ${total} remaining`;
            if (remaining <= 0) {
                btnEl.disabled = true;
                btnEl.textContent = 'No invitations remaining';
                btnEl.style.opacity = '0.5';
            } else {
                btnEl.disabled = false;
                btnEl.style.opacity = '1';
                btnEl.textContent = currentDisplayName
                    ? 'Generate invitation code'
                    : 'Set name & generate code';
            }
        } else {
            qEl.textContent = 'unavailable';
        }
    } catch (e) {
        qEl.textContent = 'offline';
        console.warn('fetchQuota:', e);
    }
}

async function handleInviteFriend() {
    if (!currentDisplayName) {
        pendingIssue = true;
        const input = document.getElementById('display-name-input');
        if (input) input.value = '';
        const err = document.getElementById('name-error');
        if (err) err.textContent = '';
        showView('name-prompt');
        setTimeout(() => input && input.focus(), 50);
        return;
    }
    await issueCode();
}

function generateInviteMessage(code, url, inviterName) {
    const sig = inviterName ? `\u2014 ${inviterName}` : '';
    const lines = [
        'Hi!',
        '',
        "I'd like to invite you to GEIANT Hive \u2014 a decentralized AI compute network.",
        '',
        'Today the swarm runs TinyLlama 1.1B on a handful of devices in alpha. As more join, capacity grows: 7B \u2192 13B \u2192 and eventually Llama 70B class, all served by real hardware in a sovereign swarm. No cloud servers; every response is cryptographically signed.',
        '',
        'Your invite (expires in 7 days):',
        url,
        '',
        "The link has the desktop app download \u2014 install, paste the code, you're in.",
        '',
        'One note on how the network works: Hive routes inference by H3 geographic proximity \u2014 closer workers serve faster. When your turn comes to invite others, picking nearby people builds the fastest local swarm.',
        '',
        'Learn more: https://hive.geiant.com',
        '',
    ];
    if (sig) lines.push(sig);
    return lines.join('\n');
}

async function issueCode() {
    const btn = document.getElementById('btn-invite-friend');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Generating\u2026';
    }
    try {
        const resp = await invoke('issue_invitation');
        if (resp && resp.success && resp.invitation) {
            const code = resp.invitation.code;
            const url = resp.invite_url || `${INVITE_BASE}/${code}`;
            document.getElementById('invite-code-text').textContent = code;
            const urlEl = document.getElementById('invite-url-text');
            urlEl.textContent = url;
            urlEl.dataset.url = url;
            // v0.4.1: populate the pre-filled invitation message
            const composeEl = document.getElementById('compose-message-text');
            if (composeEl) {
                composeEl.value = generateInviteMessage(code, url, currentDisplayName);
            }
            document.getElementById('invite-result').style.display = 'block';
            await fetchQuota();
        } else {
            const errMsg = (resp && resp.error) || 'unknown';
            alert(`Could not generate code: ${errMsg}`);
            await fetchQuota();
        }
    } catch (e) {
        alert(`Could not generate code: ${e}`);
        if (btn) btn.disabled = false;
    }
}

async function saveDisplayName() {
    const input = document.getElementById('display-name-input');
    const errEl = document.getElementById('name-error');
    const name = (input && input.value || '').trim();
    if (name.length === 0) {
        if (errEl) errEl.textContent = 'Name cannot be empty';
        return;
    }
    if (name.length > 60) {
        if (errEl) errEl.textContent = 'Name too long (max 60 characters)';
        return;
    }
    if (errEl) errEl.textContent = '';
    const saveBtn = document.getElementById('btn-name-save');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving\u2026';
    }
    try {
        const resp = await invoke('set_display_name', { name });
        if (resp && resp.success) {
            currentDisplayName = resp.display_name || name;
            updateChatWelcomeName();
            if (pendingIssue) {
                pendingIssue = false;
                showView('success');
                await fetchQuota();
                await issueCode();
            } else {
                showView('chat');
                await fetchQuota();
                await updateChatStatsStrip();
            }
        } else {
            if (errEl) errEl.textContent = (resp && resp.error) || 'Failed to save name';
        }
    } catch (e) {
        if (errEl) errEl.textContent = `Save failed: ${e}`;
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save and continue';
        }
    }
}

function copyToClipboard(text, btnEl) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
        const orig = btnEl.textContent;
        btnEl.textContent = 'Copied \u2713';
        setTimeout(() => { btnEl.textContent = orig; }, 1200);
    }).catch(e => console.warn('clipboard:', e));
}

async function runOnboardingPreview() {
    showView('detecting');
    try {
        previewData = await invoke('onboarding_preview');
        document.getElementById('preview-pk').textContent = shortPk(previewData.identity_pk);
        document.getElementById('preview-platform').textContent = previewData.hardware.platform;
        document.getElementById('preview-cpu').textContent =
            `${previewData.hardware.cpu_model} (${previewData.hardware.cpu_cores} cores)`;
        document.getElementById('preview-ram').textContent = fmtRam(previewData.hardware.ram_total_mb);
        const gpuName = previewData.hardware.gpu_name || 'none detected';
        document.getElementById('preview-gpu').textContent = `${gpuName} \u00b7 ${previewData.hardware.gpu}`;
        document.getElementById('preview-loc').textContent = `${previewData.geo.city}, ${previewData.geo.country}`;
        document.getElementById('preview-h3').textContent = previewData.geo.h3_cell_r7;
        showView('preview');
    } catch (e) {
        showError(`Detection failed: ${e}`);
    }
}

async function redeemCode() {
    const code = document.getElementById('invitation-code').value.trim().toUpperCase();
    if (!code) {
        document.getElementById('code-error').textContent = 'Code cannot be empty';
        return;
    }
    document.getElementById('code-error').textContent = '';
    showView('redeeming');
    try {
        const result = await invoke('redeem_invitation', { invitationCode: code });
        if (result.success) {
            currentDeviceId = result.device_id || null;
            document.getElementById('success-tier').textContent = result.tier || '\u2014';
            document.getElementById('success-device-id').textContent = result.device_id || '\u2014';
            document.getElementById('success-pk').textContent = previewData ? shortPk(previewData.identity_pk) : '\u2014';
            await enterChat();
        } else {
            const msg = result.error
                ? `${result.error}${result.detail ? ': ' + result.detail : ''}`
                : 'Unknown error';
            showError(msg);
        }
    } catch (e) {
        showError(`Request failed: ${e}`);
    }
}

function showError(msg) {
    document.getElementById('error-detail').textContent = msg;
    showView('error');
}

async function checkExistingRegistration() {
    try {
        const reg = await invoke('get_existing_registration');
        if (reg) {
            currentDeviceId = reg.device_id || null;
            document.getElementById('success-tier').textContent = reg.tier || '\u2014';
            document.getElementById('success-device-id').textContent = reg.device_id || '\u2014';
            document.getElementById('success-pk').textContent = shortPk(reg.device_pk);
            await enterChat();
            return true;
        }
    } catch (e) {
        console.warn('checkExistingRegistration:', e);
    }
    return false;
}

async function openDashboard() {
    if (!currentDeviceId) return;
    try {
        await invoke('open_dashboard', { deviceId: currentDeviceId });
    } catch (e) {
        console.error('open_dashboard:', e);
    }
}

document.getElementById('btn-begin').addEventListener('click', runOnboardingPreview);
document.getElementById('btn-to-code').addEventListener('click', () => showView('code'));
document.getElementById('btn-back-to-preview').addEventListener('click', () => showView('preview'));
document.getElementById('btn-redeem').addEventListener('click', redeemCode);
document.getElementById('btn-done').addEventListener('click', () => showView('chat'));
document.getElementById('btn-open-dashboard').addEventListener('click', openDashboard);
document.getElementById('btn-back-from-error').addEventListener('click', () => {
    showView(previewData ? 'code' : 'welcome');
});

// v0.3 viral chain handlers
const btnInvite = document.getElementById('btn-invite-friend');
if (btnInvite) btnInvite.addEventListener('click', handleInviteFriend);

const btnNameSave = document.getElementById('btn-name-save');
if (btnNameSave) btnNameSave.addEventListener('click', saveDisplayName);

const btnNameCancel = document.getElementById('btn-name-cancel');
if (btnNameCancel) btnNameCancel.addEventListener('click', () => {
    pendingIssue = false;
    showView('chat');
});

const btnCopyCode = document.getElementById('btn-copy-code');
if (btnCopyCode) btnCopyCode.addEventListener('click', (e) => {
    const code = document.getElementById('invite-code-text').textContent;
    copyToClipboard(code, e.target);
});

const btnCopyUrl = document.getElementById('btn-copy-url');
if (btnCopyUrl) btnCopyUrl.addEventListener('click', (e) => {
    const urlEl = document.getElementById('invite-url-text');
    const url = (urlEl && urlEl.dataset.url) || (urlEl && urlEl.textContent) || '';
    copyToClipboard(url, e.target);
});

// On launch: skip wizard if already registered
checkExistingRegistration();


// === v0.4.0 chat ===

const CHAT_HISTORY_KEY = 'gh-chat-history';
const CHAT_MAX_TURNS = 20;
const CHAT_SYSTEM_PROMPT = `You are GEIANT Hive, a privacy-first AI assistant running on real people's hardware via the GEIANT Hive distributed inference network. No cloud servers, no data collection. Be helpful, concise, and knowledgeable. Use markdown when it helps. Keep responses focused.`;

let chatHistory = [];   // [{role, content, ts?, hive?}]
let chatSending = false;

function loadChatHistory() {
    try {
        const raw = localStorage.getItem(CHAT_HISTORY_KEY);
        if (raw) chatHistory = JSON.parse(raw) || [];
    } catch (e) {
        console.warn('chat: load history', e);
        chatHistory = [];
    }
}

function saveChatHistory() {
    try {
        // Cap stored history at last 2*CHAT_MAX_TURNS messages
        const trimmed = chatHistory.slice(-CHAT_MAX_TURNS * 2);
        localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(trimmed));
    } catch (e) {
        console.warn('chat: save history', e);
    }
}

function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function renderMarkdown(text) {
    // Minimal: escape, then convert ```code blocks``` and `inline code` and **bold**.
    let html = escapeHtml(text);
    html = html.replace(/```([\s\S]*?)```/g, (m, code) =>
        `<pre class="code-block">${code.replace(/^\n/, '')}</pre>`
    );
    html = html.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');
    html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\n/g, '<br>');
    return html;
}

function formatTs(d) {
    try {
        return new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
        return '';
    }
}

function cellToCity(h3) {
    if (!h3) return '';
    const c = String(h3).toLowerCase();
    if (c.startsWith('871e9a')) return 'Rome';
    if (c.startsWith('861e80')) return 'Italy';
    return c.slice(0, 8);
}

function formatProvenance(hive, model) {
    if (!hive) return `🐝 swarm · ${escapeHtml(model || 'tinyllama')}`;
    const city = cellToCity(hive.h3_cell);
    const tps = hive.tokens_per_second
        ? `${hive.tokens_per_second.toFixed(1)} tok/s · `
        : '';
    return `🐝 ${escapeHtml(city)} · ${escapeHtml(model || 'tinyllama')} · ${tps}<span class="mono small">${escapeHtml((hive.job_id || '').slice(0, 8))}</span>`;
}

function appendMessageEl(role, content, meta) {
    const list = document.getElementById('chat-messages');
    if (!list) return;
    // Hide the welcome placeholder once a real message exists
    const welcomeEl = document.getElementById('chat-welcome');
    if (welcomeEl && chatHistory.length > 0) welcomeEl.style.display = 'none';

    const wrap = document.createElement('div');
    wrap.className = `msg msg-${role}`;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = role === 'assistant' ? renderMarkdown(content) : escapeHtml(content);
    wrap.appendChild(bubble);
    if (meta) {
        const metaEl = document.createElement('div');
        metaEl.className = 'msg-meta';
        metaEl.innerHTML = meta;
        wrap.appendChild(metaEl);
    }
    list.appendChild(wrap);
    list.scrollTop = list.scrollHeight;
    return wrap;
}

function renderChatHistory() {
    const list = document.getElementById('chat-messages');
    if (!list) return;
    // Keep the welcome element, clear messages
    const welcomeEl = document.getElementById('chat-welcome');
    list.innerHTML = '';
    if (welcomeEl) {
        welcomeEl.style.display = chatHistory.length === 0 ? '' : 'none';
        list.appendChild(welcomeEl);
    }
    for (const m of chatHistory) {
        const meta = m.role === 'assistant'
            ? formatProvenance(m.hive, m.model)
            : `You · ${formatTs(m.ts)}`;
        appendMessageEl(m.role, m.content, meta);
    }
}

function clearChat() {
    chatHistory = [];
    saveChatHistory();
    renderChatHistory();
}

function updateChatWelcomeName() {
    const el = document.getElementById('chat-welcome-name');
    if (!el) return;
    if (currentDisplayName) {
        const first = currentDisplayName.split(/\s+/)[0] || currentDisplayName;
        el.textContent = `Welcome, ${first}.`;
    } else {
        el.textContent = 'Welcome.';
    }
}

async function updateChatStatsStrip() {
    const beesEl = document.getElementById('chat-stats-bees');
    const invitesEl = document.getElementById('chat-stats-invites');
    const welcomeStatsEl = document.getElementById('chat-welcome-stats');
    if (!beesEl || !invitesEl) return;

    // Bees / online
    let bees = 0, online = 0, pods = 0;
    try {
        const r = await fetch(`${BACKEND}/hive/stats`);
        const d = await r.json();
        if (d.success) {
            bees = d.data.devices.total || 0;
            online = d.data.devices.online || 0;
            pods = d.data.pods.total || 0;
            beesEl.textContent = `${bees} ${bees === 1 ? 'bee' : 'bees'} \u00b7 ${online} online`;
        } else {
            beesEl.textContent = 'network: unavailable';
        }
    } catch (e) {
        beesEl.textContent = 'network: offline';
    }

    // Invites remaining (only if we already have currentQuotaRemaining)
    if (currentQuotaRemaining !== null && currentQuotaRemaining !== undefined) {
        const n = currentQuotaRemaining;
        invitesEl.textContent = `${n} ${n === 1 ? 'invite' : 'invites'} left`;
    } else {
        invitesEl.textContent = '';
    }

    if (welcomeStatsEl) {
        const inviteStr = (currentQuotaRemaining > 0)
            ? ` · ${currentQuotaRemaining} ${currentQuotaRemaining === 1 ? 'invite' : 'invites'} left`
            : '';
        if (bees > 0) {
            welcomeStatsEl.textContent = `${bees} ${bees === 1 ? 'bee' : 'bees'} \u00b7 ${online} online${inviteStr}.`;
        } else {
            welcomeStatsEl.textContent = `Connected to GEIANT Hive${inviteStr}.`;
        }
    }
}

async function enterChat() {
    // First load history, then render, then refresh metadata.
    loadChatHistory();
    showView('chat');
    updateChatWelcomeName();
    renderChatHistory();
    // Fetch quota first so the stats strip can show invite count
    await fetchQuota();
    await updateChatStatsStrip();
    // Focus the input
    const input = document.getElementById('chat-input');
    if (input) setTimeout(() => input.focus(), 50);
}

function handleChatCommand(text) {
    const cmd = text.trim().toLowerCase();
    if (cmd === '/clear') {
        clearChat();
        return true;
    }
    if (cmd === '/help') {
        appendMessageEl('assistant', [
            '**Commands**',
            '`/clear` — reset conversation memory',
            '`/help` — this list',
            '',
            'Use the ⋮ menu (top right) for: invite a friend, open dashboard, change display name, about.',
            '',
            'Every response is served by a real device in the swarm — the line under each reply shows where, which model, and the speed.',
        ].join('\n'), '🐝 system');
        return true;
    }
    return false;
}

function cleanResponse(text) {
    if (!text) return text;
    let cleaned = text;

    // Strategy: llama.cpp echoes the prompt. The model's actual generation
    // starts after the last "\nAssistant:" that follows the last "\nUser:"
    // in the prompt portion.
    const lastUserIdx = cleaned.lastIndexOf('\nUser:');
    if (lastUserIdx !== -1) {
        const afterUser = cleaned.indexOf('\nAssistant:', lastUserIdx);
        if (afterUser !== -1) {
            cleaned = cleaned.slice(afterUser + '\nAssistant:'.length);
        }
    }

    // Some models self-prefix their reply with "Assistant:" — strip it.
    cleaned = cleaned.replace(/^\s*Assistant\s*:\s*/i, '');

    // The model often continues past its turn, generating more turns.
    // Stop at the first "\nUser:" or "\nAssistant:".
    const stopIdx = cleaned.search(/\n\s*(User|Assistant)\s*:/i);
    if (stopIdx !== -1) {
        cleaned = cleaned.slice(0, stopIdx);
    }

    cleaned = cleaned.trim();
    return cleaned || '(empty response)';
}

async function sendChatMessage() {
    if (chatSending) return;
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('btn-send');
    if (!input) return;
    const text = (input.value || '').trim();
    if (!text) return;

    // Inline commands handled client-side
    if (text.startsWith('/') && handleChatCommand(text)) {
        input.value = '';
        autosize(input);
        return;
    }

    chatSending = true;
    if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.textContent = '…';
    }
    input.disabled = true;

    const now = Date.now();
    chatHistory.push({ role: 'user', content: text, ts: now });
    saveChatHistory();
    appendMessageEl('user', text, `You \u00b7 ${formatTs(now)}`);

    input.value = '';
    autosize(input);

    // Typing indicator
    const typingEl = appendMessageEl('assistant', '…', '🐝 thinking');
    if (typingEl) typingEl.classList.add('typing');

    // Build the message array (system + last CHAT_MAX_TURNS turns)
    const recent = chatHistory.slice(-CHAT_MAX_TURNS * 2);
    const messages = [
        { role: 'system', content: CHAT_SYSTEM_PROMPT },
        ...recent.map(m => ({ role: m.role, content: m.content })),
    ];

    let assistantText = '';
    let hiveMeta = null;
    let modelUsed = 'tinyllama';
    let errorMsg = null;

    try {
        const resp = await invoke('chat_completion', { messages });
        if (resp && resp.choices && resp.choices.length > 0) {
            assistantText = cleanResponse(resp.choices[0].message?.content || '');
            hiveMeta = resp.hive || null;
            modelUsed = resp.model || modelUsed;
        } else {
            errorMsg = 'Empty response from swarm';
        }
    } catch (e) {
        errorMsg = String(e);
    }

    // Remove the typing placeholder
    if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);

    if (errorMsg) {
        appendMessageEl(
            'assistant',
            `⚠️ The swarm could not answer right now.\n\n${errorMsg}`,
            '🐝 error',
        );
    } else {
        chatHistory.push({
            role: 'assistant',
            content: assistantText,
            ts: Date.now(),
            hive: hiveMeta,
            model: modelUsed,
        });
        saveChatHistory();
        appendMessageEl('assistant', assistantText, formatProvenance(hiveMeta, modelUsed));
    }

    chatSending = false;
    if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send';
    }
    input.disabled = false;
    input.focus();
}

function autosize(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}

// === Kebab menu ===

function toggleKebab(force) {
    const menu = document.getElementById('kebab-menu');
    const btn = document.getElementById('btn-kebab');
    if (!menu || !btn) return;
    const open = (typeof force === 'boolean') ? force : menu.classList.contains('hidden');
    if (open) {
        menu.classList.remove('hidden');
        btn.setAttribute('aria-expanded', 'true');
    } else {
        menu.classList.add('hidden');
        btn.setAttribute('aria-expanded', 'false');
    }
}

function handleKebabAction(action) {
    toggleKebab(false);
    switch (action) {
        case 'dashboard':
            openDashboard();
            break;
        case 'invite':
            // Reuse the v0.3 invite UI (view-success contains the invite card)
            if (!currentDisplayName) {
                pendingIssue = true;
                const input = document.getElementById('display-name-input');
                if (input) input.value = '';
                const err = document.getElementById('name-error');
                if (err) err.textContent = '';
                showView('name-prompt');
                setTimeout(() => input && input.focus(), 50);
            } else {
                showView('success');
                fetchNetworkStats();
                fetchQuota();
            }
            break;
        case 'name':
            pendingIssue = false;
            const input = document.getElementById('display-name-input');
            if (input) input.value = currentDisplayName || '';
            const err = document.getElementById('name-error');
            if (err) err.textContent = '';
            showView('name-prompt');
            setTimeout(() => input && input.focus(), 50);
            break;
        case 'clear':
            clearChat();
            break;
        case 'about':
            appendMessageEl(
                'assistant',
                [
                    '**GEIANT Hive Desktop \u00b7 v0.4.2**',
                    '',
                    'You are connected to a decentralized AI compute network.',
                    'Your device is part of the swarm. No cloud servers, no data collection.',
                    'Every response is served by real hardware and cryptographically signed.',
                    '',
                    'Learn more: hive.geiant.com',
                ].join('\n'),
                '\ud83d\udc1d about',
            );
            break;
        case 'close':
            invoke('close_setup_window');
            break;
    }
}

// === v0.4.0 wiring ===

(function wireChat() {
    // Send button
    const sendBtn = document.getElementById('btn-send');
    if (sendBtn) sendBtn.addEventListener('click', sendChatMessage);

    // Textarea: Enter to send, Shift+Enter for newline; autosize
    const input = document.getElementById('chat-input');
    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                sendChatMessage();
            }
        });
        input.addEventListener('input', () => autosize(input));
    }

    // Kebab toggle
    const kebabBtn = document.getElementById('btn-kebab');
    if (kebabBtn) kebabBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleKebab();
    });

    // Kebab item clicks
    document.querySelectorAll('[data-kebab]').forEach(el => {
        el.addEventListener('click', () => {
            const action = el.getAttribute('data-kebab');
            handleKebabAction(action);
        });
    });

    // Click outside closes kebab
    document.addEventListener('click', (e) => {
        const menu = document.getElementById('kebab-menu');
        const btn = document.getElementById('btn-kebab');
        if (!menu || menu.classList.contains('hidden')) return;
        if (!menu.contains(e.target) && e.target !== btn) {
            toggleKebab(false);
        }
    });

    // Escape closes kebab
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') toggleKebab(false);
    });
})();
// v0.4.1: Copy invitation message
const btnComposeCopy = document.getElementById('btn-compose-copy');
if (btnComposeCopy) btnComposeCopy.addEventListener('click', (e) => {
    const ta = document.getElementById('compose-message-text');
    const text = ta ? ta.value : '';
    copyToClipboard(text, e.target);
});
