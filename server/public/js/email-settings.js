const emailSettingsController = createEmailSettingsController({
    showMessage(type, message) {
        const container = document.getElementById('statusMessage');
        const messageClass = type === 'success' ? 'success' : type === 'warning' ? 'warning' : 'error';

        container.innerHTML = `<div class="status-message ${messageClass}" role="${messageClass === 'error' ? 'alert' : 'status'}">${emailSettingsController.escapeHtml(message)}</div>`;
        container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        setTimeout(() => {
            container.innerHTML = '';
        }, 5000);
    }
});

window.switchTab = (tabName) => emailSettingsController.switchTab(tabName);
window.toggleAuthType = () => emailSettingsController.toggleAuthType();
window.startOAuthLogin = (provider) => emailSettingsController.startOAuthLogin(provider);
window.saveEmailSettings = () => emailSettingsController.saveEmailSettings();
window.testEmail = () => emailSettingsController.testEmail();
window.loadTemplate = () => emailSettingsController.loadTemplate();
window.saveTemplate = () => emailSettingsController.saveTemplate();
window.resetTemplate = () => emailSettingsController.resetTemplate();

document.addEventListener('DOMContentLoaded', async () => {
    await emailSettingsController.initialize();
});
