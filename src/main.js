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
            showView('success');
            await fetchQuota();
            if (pendingIssue) {
                pendingIssue = false;
                await issueCode();
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
            showView('success');
            fetchNetworkStats();
            fetchQuota();
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
            showView('success');
            fetchNetworkStats();
            fetchQuota();
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
document.getElementById('btn-done').addEventListener('click', () => invoke('close_setup_window'));
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
    showView('success');
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
