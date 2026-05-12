const { invoke } = window.__TAURI__.core;

const views = {
    welcome: document.getElementById('view-welcome'),
    detecting: document.getElementById('view-detecting'),
    preview: document.getElementById('view-preview'),
    code: document.getElementById('view-code'),
    redeeming: document.getElementById('view-redeeming'),
    success: document.getElementById('view-success'),
    error: document.getElementById('view-error'),
};

let previewData = null;

function showView(name) {
    Object.entries(views).forEach(([k, el]) => {
        el.classList.toggle('active', k === name);
    });
}

function fmtRam(mb) {
    return `${(mb / 1024).toFixed(1)} GB`;
}

function shortPk(pk) {
    return `${pk.slice(0, 12)}…${pk.slice(-8)}`;
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
        document.getElementById('preview-gpu').textContent =
            `${gpuName} · ${previewData.hardware.gpu}`;
        document.getElementById('preview-loc').textContent =
            `${previewData.geo.city}, ${previewData.geo.country}`;
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
            document.getElementById('success-tier').textContent = result.tier || '—';
            document.getElementById('success-device-id').textContent = result.device_id || '—';
            document.getElementById('success-pk').textContent = previewData ? shortPk(previewData.identity_pk) : '—';
            showView('success');
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

document.getElementById('btn-begin').addEventListener('click', runOnboardingPreview);
document.getElementById('btn-to-code').addEventListener('click', () => showView('code'));
document.getElementById('btn-back-to-preview').addEventListener('click', () => showView('preview'));
document.getElementById('btn-redeem').addEventListener('click', redeemCode);
document.getElementById('btn-done').addEventListener('click', () => invoke('close_setup_window'));
document.getElementById('btn-back-from-error').addEventListener('click', () => {
    showView(previewData ? 'code' : 'welcome');
});
