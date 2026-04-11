export const HTML_JS = `

const DOMAINS_API = '/api/domains';
const CONFIG_API = '/api/config';
const ITEMS_PER_PAGE = 12;
let allDomains = [];
let currentFilteredDomains = [];
let currentPage = 1;
let currentGroup = '全部';
let currentSearchTerm = '';
let currentStatusFilter = '';
let globalConfig = { daysThreshold: 30 };
let lastOperatedDomain = null;

function formatDate(date) {
    const d = new Date(date);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const year = d.getFullYear();
    return [year, month, day].join('-');
}

function isValidDomainFormat(domain) {
    const domainRegex = /^(?!-)(?!.*--)([a-zA-Z0-9-]{1,63}\\.)+[a-zA-Z]{2,}$/;
    return domainRegex.test(domain.toLowerCase());
}

function getDomainLevel(domain) {
    const parts = domain.split('.');
    if (parts.length <= 2) return '一级域名';
    return '二级域名';
}

function isPrimaryDomain(domain) {
    return getDomainLevel(domain) === '一级域名';
}

function calculateExpirationDate() {
    const registrationDateEl = document.getElementById('registrationDate');
    const renewalPeriodEl = document.getElementById('renewalPeriod');
    const renewalUnitEl = document.getElementById('renewalUnit');
    const expirationDateEl = document.getElementById('expirationDate');
    const regDateStr = registrationDateEl.value;
    const period = parseInt(renewalPeriodEl.value);
    const unit = renewalUnitEl.value;

    if (regDateStr && period > 0 && unit) {
        const regDate = new Date(regDateStr);
        let calculatedExpirationDate = new Date(regDateStr);

        if (unit === 'year') {
            calculatedExpirationDate.setFullYear(regDate.getFullYear() + period);
        } else if (unit === 'month') {
            calculatedExpirationDate.setMonth(regDate.getMonth() + period);
        }
        expirationDateEl.value = formatDate(calculatedExpirationDate);
    }
}

async function fetchConfig() {
    try {
        const response = await fetch(CONFIG_API);
        if (response.ok) {
            const config = await response.json();
            globalConfig = {
                ...globalConfig,
                ...config,
                daysThreshold: config.days || globalConfig.daysThreshold
            };
        }
    } catch (error) {
        console.error('获取配置信息失败:', error);
    }
}

async function exportData() {
    try {
        const response = await fetch(DOMAINS_API);
        if (!response.ok) throw new Error('获取数据失败');

        const data = await response.json();
        const jsonString = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const date = new Date().toISOString().split('T')[0];
        a.download = 'domain_list_backup_' + date + '.json';
        
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        alert('域名数据已成功导出为 JSON 文件！');
    } catch (error) {
        console.error('导出数据失败:', error);
        alert('导出数据失败：' + error.message);
    }
}

function importData() {
    const fileInput = document.getElementById('importFileInput');
    if (!fileInput) return;
    fileInput.click();
    
    fileInput.onchange = async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        if (!confirm('确定要导入文件 ' + file.name + ' 吗？\\n警告：这将替换所有现有域名数据!')) {
            fileInput.value = '';
            return;
        }

        try {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const jsonContent = e.target.result;
                    const domainsToImport = JSON.parse(jsonContent);
                    if (!Array.isArray(domainsToImport)) { throw new Error('JSON 文件格式错误，须为域名数组'); }

                    const response = await fetch(DOMAINS_API, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(domainsToImport),
                    });

                    if (!response.ok) {
                        const errorData = await response.json().catch(() => ({ error: '服务器错误' }));
                        throw new Error(errorData.error || response.statusText);
                    }
                    
                    const result = await response.json();
                    alert('数据导入成功！共导入 ' + result.count + ' 个域名');
                    await fetchDomains();
                } catch (jsonError) {
                    console.error('导入文件处理失败:', jsonError);
                    alert('导入文件处理失败：' + jsonError.message);
                } finally {
                    fileInput.value = '';
                }
            };
            reader.readAsText(file);
        } catch (error) {
            console.error('读取文件失败:', error);
            alert('读取文件失败：' + error.message);
            fileInput.value = '';
        }
    };
}

function getDomainStatus(expirationDateStr, isPermanent) {
    if (isPermanent === true) {
        return { statusText: '永久', statusColor: '#27ae60', daysRemaining: 'N/A' };
    }
    
    const now = new Date();
    const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const expirationTime = Date.parse(expirationDateStr);
    if (isNaN(expirationTime)) {
        return { statusText: '日期格式错误', statusColor: '#95a5a6', daysRemaining: 'N/A' };
    }
    
    const timeDiff = expirationTime - todayUTC;
    const daysRemaining = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
    let statusText = '正常';
    let statusColor = '#2ecc71';

    if (daysRemaining <= 0) {
        statusText = '已到期';
        statusColor = '#e74c3c';
    } else if (daysRemaining <= globalConfig.daysThreshold) {
        statusText = '将到期';
        statusColor = '#f39c12';
    }

    return { statusText, statusColor, daysRemaining };
}

function renderSummary(domainsList) {
    const summaryEl = document.getElementById('summary');
    if (!summaryEl) return;

    const total = domainsList.length;
    let normalCount = 0;
    let expiringCount = 0;
    let expiredCount = 0;
    let permanentCount = 0;

    domainsList.forEach(domain => {
        const isPermanent = domain.isPermanent || false;
        const { statusText } = getDomainStatus(domain.expirationDate, isPermanent);
        if (statusText === '正常') {
            normalCount++;
        } else if (statusText === '将到期') {
            expiringCount++;
        } else if (statusText === '已到期') {
            expiredCount++;
        } else if (statusText === '永久') {
            permanentCount++;
        }
    }); 

    const usableCount = normalCount + expiringCount;

    summaryEl.innerHTML = [
        '<div class="summary-card ' + (currentStatusFilter === '全部' ? 'active' : '') + '" style="--color: #186db3;" data-filter="全部"><h3><i class="fa fa-list-ol"></i> 全部</h3><p>' + total + '</p></div>',
        '<div class="summary-card ' + (currentStatusFilter === '正常' ? 'active' : '') + '" style="--color: #1dab58;" data-filter="正常"><h3><i class="fa fa-check"></i> 正常</h3><p>' + usableCount + '</p></div>',
        '<div class="summary-card ' + (currentStatusFilter === '将到期' ? 'active' : '') + '" style="--color: #f39c12;" data-filter="将到期"><h3><i class="fa fa-exclamation-triangle"></i> 将到期</h3><p>' + expiringCount + '</p></div>',
        '<div class="summary-card ' + (currentStatusFilter === '已到期' ? 'active' : '') + '" style="--color: #e74c3c;" data-filter="已到期"><h3><i class="fa fa-times"></i> 已到期</h3><p>' + expiredCount + '</p></div>',
        '<div class="summary-card ' + (currentStatusFilter === '永久' ? 'active' : '') + '" style="--color: #27ae60;" data-filter="永久"><h3><i class="fa fa-infinity"></i> 永久</h3><p>' + permanentCount + '</p></div>'
    ].join('');

    summaryEl.querySelectorAll('.summary-card').forEach(card => {
        card.addEventListener('click', handleSummaryClick);
    });
}

function handleSummaryClick(e) {
    const clickedCard = e.currentTarget;
    const filterValue = clickedCard.dataset.filter;

    document.querySelectorAll('#summary .summary-card').forEach(card => {
        card.classList.remove('active');
    });

    clickedCard.classList.add('active');
    currentStatusFilter = filterValue;
    currentGroup = '全部';

    document.querySelectorAll('#groupTabs .tab-btn').forEach(tab => {
        tab.classList.remove('active');
    });
    const allTab = document.querySelector('#groupTabs .tab-btn[data-group="全部"]');
    if (allTab) { allTab.classList.add('active'); }

    currentPage = 1;
    applyFiltersAndSearch();
}

function renderGroupTabs() {
    const tabsEl = document.getElementById('groupTabs');
    const existingGroups = ['全部', '一级域名', '二级域名', '未分组', '永久域名'];
    const customGroups = new Set();
    
    allDomains.forEach(d => {
        const groups = (d.groups || '').split(',').map(g => g.trim()).filter(g => g);
        groups.forEach(g => customGroups.add(g));
    });

    let html = '';
    existingGroups.forEach(g => {
        html += '<button class="tab-btn ' + (currentGroup === g ? 'active' : '') + '" data-group="' + g + '">' + g + '</button>';
    });

    customGroups.forEach(g => {
        if (!existingGroups.includes(g)) {
             html += '<button class="tab-btn ' + (currentGroup === g ? 'active' : '') + '" data-group="' + g + '">' + g + '</button>';
        }
    });

    tabsEl.innerHTML = html;
    tabsEl.querySelectorAll('.tab-btn').forEach(button => {
        button.addEventListener('click', handleTabClick);
    });
}

function handleTabClick(e) {
    const clickedTab = e.target;
    if (!clickedTab.classList.contains('tab-btn')) {
        return;
    }

    const allTabs = document.querySelectorAll('#groupTabs .tab-btn');
    allTabs.forEach(tab => {
        tab.classList.remove('active');
    });

    clickedTab.classList.add('active');

    currentStatusFilter = '';
    const allSummaryCards = document.querySelectorAll('#summary .summary-card');
    allSummaryCards.forEach(card => {
        card.classList.remove('active');
    });

    currentGroup = clickedTab.dataset.group;
    currentPage = 1;
    applyFiltersAndSearch();
}

function createDomainCard(info) {
    const isPermanent = info.isPermanent || false;
    const { statusText, statusColor, daysRemaining } = getDomainStatus(info.expirationDate, isPermanent);
    const registrationDate = new Date(info.registrationDate);
    const expirationDate = new Date(info.expirationDate);
    const today = new Date();
    
    let progressPercentage = 0;
    let totalDays = 0;
    let daysElapsed = 0;
    let remainingText = daysRemaining;
    let elapsedText = 'N/A';
    let progressPercentText = 'N/A';
    let permanentBadge = '';

    if (isPermanent) {
        permanentBadge = '<span class="card-permanent-badge" style="background-color: ' + statusColor + '"><i class="fa fa-infinity"></i> 永久</span>';
        remainingText = '永久';
        elapsedText = 'N/A';
        progressPercentText = 'N/A';
    } else if (info.registrationDate && info.expirationDate) {
         totalDays = (expirationDate - registrationDate) / (1000 * 60 * 60 * 24);
         daysElapsed = (today - registrationDate) / (1000 * 60 * 60 * 24);
         progressPercentage = Math.min(100, Math.max(0, (daysElapsed / totalDays) * 100));
         progressPercentText = progressPercentage.toFixed(1) + '%';
         const elapsedDays = Math.floor(daysElapsed);
         elapsedText = elapsedDays > 0 ? elapsedDays + ' 天' : '0 天';
         remainingText = daysRemaining > 0 ? daysRemaining + ' 天' : '已到期';
         if (daysRemaining <= 0) { elapsedText = Math.floor(totalDays) + ' 天'; }
    } else {
        progressPercentage = 0;
        remainingText = 'N/A';
        elapsedText = 'N/A';
        progressPercentText = 'N/A';
    }

    let borderColor = statusColor;
    var html = '';
    html += '<div class="domain-card" style="--status-color: ' + statusColor + '; --border-color: ' + borderColor + '">';
    html += '<div class="card-header">';
    html += '<span class="card-domain" data-domain="' + info.domain + '" title="点击即可复制">' + info.domain + '</span>';
    html += '<div class="card-header-right">';
    html += '<span class="card-status">' + statusText + '</span>';
    html += permanentBadge;
    html += '</div></div>';
    html += '<div class="card-info">';
    html += '<p><strong><i class="fa fa-registered"></i> 注册商： </strong> <a href="' + (info.systemURL || '') + '" target="_blank" title="点击直达">' + (info.system || 'N/A') + '</a></p>';
    html += '<p><strong><i class="fa fa-user"></i> 注册账号： </strong> ' + (info.registerAccount || 'N/A') + '</p>';
    html += '<p><strong><i class="fa fa-calendar"></i> 注册时间： </strong> ' + (info.registrationDate || 'N/A') + '</p>';
    if (isPermanent) {
        html += '<p><strong><i class="fa fa-calendar"></i> 到期时间： </strong> <span style="color: ' + statusColor + '; font-weight: bold;">永久</span></p>';
    } else {
        html += '<p><strong><i class="fa fa-calendar"></i> 到期时间： </strong> ' + (info.expirationDate || 'N/A') + '</p>';
    }
    html += '<p><strong><i class="fa fa-folder"></i> 所属分组： </strong> ' + (info.groups || '无') + '</p>';
    html += '</div>';
    html += '<div class="card-footer">';
    if (!isPermanent) {
        html += '<div class="progress-bar-container"><div class="progress-bar" style="width: ' + progressPercentage + '%;"></div><span class="progress-percent-display">' + progressPercentText + '</span></div>';
        html += '<div class="progress-text">已使用 ' + elapsedText + ' | 剩余 ' + remainingText + '</div>';
    } else {
        html += '<div class="progress-bar-container"><div class="progress-bar" style="width: 100%; background-color: ' + statusColor + ';"></div><span class="progress-percent-display" style="color: white;">永久</span></div>';
        html += '<div class="progress-text" style="color: ' + statusColor + '; font-weight: bold;"><i class="fa fa-infinity"></i> 永久域名</div>';
    }
    html += '<div style="text-align: right; margin-top: 10px;">';
    html += '<i class="fas fa-edit edit-icon" data-domain="' + info.domain + '" title="编辑"></i>';
    html += '<i class="fas fa-trash-alt delete-icon" data-domain="' + info.domain + '" title="删除"></i>';
    html += '</div></div></div>';
    return html;
}

function renderDomainCards() {
    const listEl = document.getElementById('domainList');
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const domainsToRender = currentFilteredDomains.slice(start, end);

    if (domainsToRender.length === 0) {
        listEl.innerHTML = '<p style="text-align: center; font-size: 1rem; color: #555;">没有符合条件的域名记录</p>';
    } else {
        listEl.innerHTML = domainsToRender.map(createDomainCard).join('');
    }
    
    listEl.querySelectorAll('.card-domain').forEach(el => {
        el.addEventListener('click', (e) => {
            navigator.clipboard.writeText(e.target.dataset.domain);
            alert('已复制域名：' + e.target.dataset.domain);
        });
    });
    
    listEl.querySelectorAll('.edit-icon').forEach(el => {
        el.addEventListener('click', (e) => {
            const domain = e.target.dataset.domain;
            const domainInfo = allDomains.find(d => d.domain === domain);
            if (domainInfo) openDomainForm(domainInfo);
        });
    });
    
    listEl.querySelectorAll('.delete-icon').forEach(el => {
        el.addEventListener('click', async (e) => {
            const domain = e.target.dataset.domain;
            if (confirm('确定要删除域名 ' + domain + ' 吗？')) {
                await deleteDomain(domain);
            }
        });
    });
    
    renderPagination();
}

function renderPagination() {
    const paginationEl = document.getElementById('pagination');
    const totalPages = Math.ceil(currentFilteredDomains.length / ITEMS_PER_PAGE);
    if (totalPages <= 1) { paginationEl.innerHTML = ''; return; }

    let html = '';
    html += '<button class="page-btn" ' + (currentPage === 1 ? 'disabled' : '') + ' data-page="' + (currentPage - 1) + '"><i class="fas fa-arrow-left"></i></button>';
    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, currentPage + 2);
    if (startPage > 1) {
        html += '<button class="page-btn" data-page="1">1</button>';
        if (startPage > 2) html += '<span class="page-dots">...</span>';
    }
    for (let i = startPage; i <= endPage; i++) {
        html += '<button class="page-btn ' + (currentPage === i ? 'active' : '') + '" data-page="' + i + '">' + i + '</button>';
    }
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) html += '<span class="page-dots">...</span>';
        html += '<button class="page-btn" data-page="' + totalPages + '">' + totalPages + '</button>';
    }
    html += '<button class="page-btn" ' + (currentPage === totalPages ? 'disabled' : '') + ' data-page="' + (currentPage + 1) + '"><i class="fas fa-arrow-right"></i></button>';

    paginationEl.innerHTML = html;
    paginationEl.querySelectorAll('.page-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const target = e.target.closest('.page-btn');
            if (!target) return;
            const page = parseInt(target.dataset.page);
            if (page && page >= 1 && page <= totalPages) {
                currentPage = page;
                renderDomainCards();
            }
        });
    });
}

function applyFiltersAndSearch() {
    const commonFilters = (domain) => {
        const domainGroups = (domain.groups || '').split(',').map(g => g.trim()).filter(g => g);
        const domainLevel = getDomainLevel(domain.domain);
        const isPermanent = domain.isPermanent || false;
        let groupMatch = true;

        if (currentGroup === '一级域名') {
            groupMatch = domainLevel === '一级域名';
        } else if (currentGroup === '二级域名') {
            groupMatch = domainLevel === '二级域名';
        } else if (currentGroup === '未分组') {
            groupMatch = domainGroups.length === 0;
        } else if (currentGroup === '永久域名') {
            groupMatch = isPermanent;
        } else if (currentGroup !== '全部') {
            groupMatch = domainGroups.includes(currentGroup);
        }
        if (!groupMatch) return false;

        const searchTerm = currentSearchTerm.toLowerCase();
        if (searchTerm) {
            return (
                domain.domain.toLowerCase().includes(searchTerm) ||
                (domain.system || '').toLowerCase().includes(searchTerm) ||
                (domain.registerAccount || '').toLowerCase().includes(searchTerm) ||
                (domain.groups || '').toLowerCase().includes(searchTerm) ||
                (isPermanent ? '永久'.includes(searchTerm) : false)
            );
        }
        return true;
    };
    
    const domainsForSummary = allDomains.filter(commonFilters);
    renderSummary(domainsForSummary);

    currentFilteredDomains = domainsForSummary.filter(domain => {
        const isPermanent = domain.isPermanent || false;
        const { statusText } = getDomainStatus(domain.expirationDate, isPermanent);
        
        if (currentStatusFilter === '' || currentStatusFilter === '全部') { return true; }
        
        if (isPermanent) {
            if (currentStatusFilter === '永久') { return true; }
            return false;
        }
        
        if (currentStatusFilter === '正常') {
            return (statusText === '正常' || statusText === '将到期');
        } else {
            return (statusText === currentStatusFilter);
        }
    });

    renderDomainCards();
}

async function fetchDomains() {
    try {
        const response = await fetch(DOMAINS_API);
        if (!response.ok) throw new Error('获取域名失败');
        const data = await response.json();

        allDomains = data.map(d => ({
            ...d,
        })).sort((a, b) => {
            if (lastOperatedDomain) { 
                if (a.domain === lastOperatedDomain) return -1;
                if (b.domain === lastOperatedDomain) return 1;
            }
            const statusA = getDomainStatus(a.expirationDate).statusText;
            const statusB = getDomainStatus(b.expirationDate).statusText;
            
            const getStatusPriority = (status) => {
                if (status === '已到期') return 1;
                if (status === '将到期') return 2;
                if (status === '正常') return 3;
                if (status === '永久') return 4;
                return 5;
            };
            
            const priorityA = getStatusPriority(statusA);
            const priorityB = getStatusPriority(statusB);
            if (priorityA !== priorityB) { return priorityA - priorityB; }
            if (priorityA === 3) {
                const isPrimaryA = isPrimaryDomain(a.domain);
                const isPrimaryB = isPrimaryDomain(b.domain);
                if (isPrimaryA && !isPrimaryB) return -1;
                if (!isPrimaryA && isPrimaryB) return 1;
            }
            const systemA = a.system || '';
            const systemB = b.system || '';
            return systemA.localeCompare(systemB);
        });

        lastOperatedDomain = null; 
        currentStatusFilter = '';
        currentGroup = '全部';
        renderGroupTabs();
        applyFiltersAndSearch();
        
    } catch (error) {
        console.error('获取域名失败:', error);
        alert('无法加载域名数据，请检查 API 连接或登录状态');
    }
}

async function submitDomainForm(e) {
    e.preventDefault();
    const modal = document.getElementById('domainFormModal');
    const domainValue = document.getElementById('domain').value.trim();
    
    if (!isValidDomainFormat(domainValue)) {
        alert('请输入有效的域名格式，例如：example.com 或 sub.example.com');
        return;
    }
    
    const isPrimary = isPrimaryDomain(domainValue);
    const isPermanent = document.getElementById('isPermanent').checked || false;
    let newDomainData = {
        originalDomain: document.getElementById('editOriginalDomain').value || domainValue,
        domain: domainValue,
        registrationDate: document.getElementById('registrationDate').value,
        system: document.getElementById('system').value,
        systemURL: document.getElementById('systemURL').value,
        registerAccount: document.getElementById('registerAccount').value,
        groups: document.getElementById('groups').value,
        renewalPeriod: document.getElementById('renewalPeriod').value ? parseInt(document.getElementById('renewalPeriod').value) : null,
        renewalUnit: document.getElementById('renewalUnit').value || null,
        isPermanent: isPermanent,
    };
    
    if (!isPermanent) {
        newDomainData.expirationDate = document.getElementById('expirationDate').value;
    } else {
        // 永久域名时，确保不包含到期时间字段
        delete newDomainData.expirationDate;
    }
    
    if (isPrimary) {
        ['registrationDate', 'system', 'systemURL'].forEach(key => {
            if (!newDomainData[key]) { newDomainData[key] = ""; }
        });
        if (!isPermanent && !newDomainData.expirationDate) {
            newDomainData.expirationDate = "";
        }
    }

    try {
        const response = await fetch(DOMAINS_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newDomainData),
        });

        let responseData = {};
        try {
            responseData = await response.json();
        } catch (e) {
        }
        
        if (response.status === 409) { throw new Error('域名已存在，请勿重复添加'); }
        if (response.status === 422) { throw new Error(responseData.error || '信息不完整，请检查必填项'); }
        if (!response.ok) { throw new Error(responseData.error || response.statusText || '保存失败'); }
        
        modal.style.display = 'none';
        alert('域名 ' + newDomainData.domain + ' 保存成功！');
        lastOperatedDomain = newDomainData.domain;
        await fetchDomains();
    } catch (error) {
        console.error('保存域名失败:', error);
        alert('保存域名失败：' + error.message);
    }
}

async function deleteDomain(domain) {
    const domainsToDelete = [domain]; 

    try {
        const response = await fetch(DOMAINS_API, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(domainsToDelete), 
        });

        let responseData = {};
        try {
            responseData = await response.json();
        } catch (e) {
        }

        if (response.status === 404) {
             alert('域名 ' + domain + ' 未找到或已被删除');
        } else if (!response.ok) {
            throw new Error(responseData.error || response.statusText || '删除失败');
        }
        
        const deletedCount = responseData.deletedCount || domainsToDelete.length;
        alert('域名 ' + domain + ' 已删除 (' + deletedCount + ' 个记录被移除)');

        currentPage = 1;
        await fetchDomains();
    } catch (error) {
        console.error('删除域名失败:', error);
        alert('删除域名失败：' + error.message);
    }
}

function openDomainForm(domainInfo = null) {
    const modal = document.getElementById('domainFormModal');
    const form = document.getElementById('domainForm');
    const title = modal.querySelector('h2');
    const warningEl = document.getElementById('domainFillWarning');
    const renewalPeriodEl = document.getElementById('renewalPeriod');
    const renewalUnitEl = document.getElementById('renewalUnit');
    const expirationDateEl = document.getElementById('expirationDate');
    const isPermanentCheckbox = document.getElementById('isPermanent');
    form.reset();
    isPermanentCheckbox.checked = false;

    if (warningEl) { warningEl.style.display = 'none'; }
    
    if (domainInfo) {
        title.textContent = '编辑域名';
        document.getElementById('editOriginalDomain').value = domainInfo.domain;
        document.getElementById('domain').value = domainInfo.domain;
        document.getElementById('registrationDate').value = domainInfo.registrationDate || '';
        document.getElementById('expirationDate').value = domainInfo.expirationDate || '';
        document.getElementById('system').value = domainInfo.system || '';
        document.getElementById('systemURL').value = domainInfo.systemURL || '';
        document.getElementById('registerAccount').value = domainInfo.registerAccount || '';
        document.getElementById('groups').value = domainInfo.groups || '';
        renewalPeriodEl.value = domainInfo.renewalPeriod || '';
        renewalUnitEl.value = domainInfo.renewalUnit || 'year';
        document.getElementById('domain').disabled = false;
        
        if (domainInfo.isPermanent) {
            isPermanentCheckbox.checked = true;
            // 永久域名时，隐藏到期时间字段
            expirationDateEl.style.display = 'none';
            const renewalGroup = document.querySelector('.renewal-group');
            if (renewalGroup) {
                renewalGroup.style.display = 'none';
            }
        }
    } else {
        title.textContent = '添加域名';
        document.getElementById('editOriginalDomain').value = '';
        document.getElementById('domain').disabled = false;
        renewalPeriodEl.value = '';
        renewalUnitEl.value = 'year';
        expirationDateEl.value = ''; 
    }
    
    updateFormRequiredStatus(document.getElementById('domain').value); 
    if (domainInfo && domainInfo.renewalPeriod && domainInfo.renewalUnit) { calculateExpirationDate(); }
    modal.style.display = 'block';
}

function updateFormRequiredStatus(domainValue) {
    const domainValueTrimmed = domainValue.trim();
    const isPrimary = isPrimaryDomain(domainValueTrimmed);
    const requiredFields = ['registrationDate', 'expirationDate', 'system', 'systemURL'];
    const warningEl = document.getElementById('domainFillWarning');
    const originalDomain = document.getElementById('editOriginalDomain').value;
    const domainExists = allDomains.some(d => d.domain === domainValueTrimmed && d.domain !== originalDomain);
    const isPermanent = document.getElementById('isPermanent').checked;

    if (isPermanent) {
        const expirationDateEl = document.getElementById('expirationDate');
        if (expirationDateEl) {
            expirationDateEl.style.display = 'none';
        }
        // 永久域名时，所有字段都不是必填的
        requiredFields.forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.required = false; }
        });
        if (warningEl) {
            warningEl.textContent = '永久域名无需填写到期时间';
            warningEl.style.color = '#2ecc71';
            warningEl.style.display = 'block';
        }
        return;
    }

    const expirationDateEl = document.getElementById('expirationDate');
    if (expirationDateEl) {
        expirationDateEl.style.display = 'block';
    }

    if (!domainValueTrimmed) {
        if (warningEl) { warningEl.style.display = 'none'; }
        requiredFields.forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.required = true; el.placeholder = '二级域名必填'; }
        });
        return;
    }
    
    if (domainExists) {
        if (warningEl) {
            warningEl.textContent = '域名已存在，请勿重复添加';
            warningEl.style.color = '#e74c3c'; 
            warningEl.style.display = 'block';
        }
        requiredFields.forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.required = false; el.placeholder = '已存在，无需填写'; }
        });
        return; 
    }

    if (warningEl) { warningEl.style.display = 'block'; }
    if (isPrimary) {
        if (warningEl) {
            warningEl.textContent = '检测为一级域名，可不填写日期和注册商，将使用 WHOIS API 自动获取';
            warningEl.style.color = '#f39c12';
        }
        requiredFields.forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.required = false; el.placeholder = '一级域名可留空'; }
        });
    } else {
        if (warningEl) {
            warningEl.textContent = '检测为二级域名，日期和注册商为必填项，无法使用 WHOIS API 自动获取';
            warningEl.style.color = '#e74c3c';
        }
        requiredFields.forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.required = true; el.placeholder = '二级域名必填'; }
        });
    }
}

function handlePermanentDomainChange(isPermanent) {
    const expirationDateEl = document.getElementById('expirationDate');
    const renewalPeriodEl = document.getElementById('renewalPeriod');
    const renewalUnitEl = document.getElementById('renewalUnit');
    const warningEl = document.getElementById('domainFillWarning');
    
    if (isPermanent) {
        if (expirationDateEl) {
            expirationDateEl.style.display = 'none';
        }
        if (renewalPeriodEl) renewalPeriodEl.value = '';
        if (renewalUnitEl) renewalUnitEl.value = 'year';
        const renewalGroup = document.querySelector('.renewal-group');
        if (renewalGroup) {
            renewalGroup.style.display = 'none';
        }
        if (warningEl) {
            warningEl.textContent = '永久域名无需填写到期时间';
            warningEl.style.color = '#2ecc71';
            warningEl.style.display = 'block';
        }
    } else {
        if (expirationDateEl) {
            expirationDateEl.style.display = 'block';
        }
        const renewalGroup = document.querySelector('.renewal-group');
        if (renewalGroup) {
            renewalGroup.style.display = 'flex';
        }
        updateFormRequiredStatus(document.getElementById('domain').value);
    }
}

window.addEventListener('load', async () => {
    await fetchConfig();
    await fetchDomains();

    document.getElementById('addDomainBtn').addEventListener('click', () => openDomainForm());
    document.getElementById('exportDataBtn').addEventListener('click', exportData);
    document.getElementById('importDataBtn').addEventListener('click', importData);

    const modal = document.getElementById('domainFormModal');
    modal.querySelector('.close-btn').addEventListener('click', () => modal.style.display = 'none');
    window.addEventListener('click', (event) => {
        if (event.target === modal) { modal.style.display = 'none'; }
    });
    document.getElementById('domainForm').addEventListener('submit', submitDomainForm);

    let searchTimeout;
    document.getElementById('searchBox').addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            currentSearchTerm = e.target.value.trim();
            currentPage = 1;
            applyFiltersAndSearch();
        }, 300);
    });

    document.getElementById('groupTabs').addEventListener('click', handleTabClick);

    const registrationDateEl = document.getElementById('registrationDate');
    const renewalPeriodEl = document.getElementById('renewalPeriod');
    const renewalUnitEl = document.getElementById('renewalUnit');
    const domainEl = document.getElementById('domain');
    const calculationElements = [registrationDateEl, renewalPeriodEl, renewalUnitEl];
    calculationElements.forEach(el => {
        el.addEventListener('change', calculateExpirationDate);
        el.addEventListener('input', calculateExpirationDate);
    });

    domainEl.addEventListener('input', (e) => {
        updateFormRequiredStatus(e.target.value);
    });
    
    const isPermanentCheckbox = document.getElementById('isPermanent');
    if (isPermanentCheckbox) {
        isPermanentCheckbox.addEventListener('change', function() {
            handlePermanentDomainChange(this.checked);
        });
    }
});

`;
