/**
 * Main Application Logic & UI State Management
 * Zunax IT Support Mobile App
 */

// Application State
let currentTab = 'tabTickets';
let currentTickets = [];
let currentFilterStage = 'all';
let currentSearchQuery = '';
let activeTicket = null;
let loggedEmployee = null;

// Initialize on DOM Loaded
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

async function initApp() {
  // Check stored credentials / session
  const storedUrl = localStorage.getItem('odoo_url');
  const storedDb = localStorage.getItem('odoo_db');
  const storedSid = localStorage.getItem('odoo_session_id');

  if (storedUrl) document.getElementById('odooUrl').value = storedUrl;
  if (storedDb) document.getElementById('odooDb').value = storedDb;
  document.getElementById('useDemoMode').checked = odooAPI.isDemoMode;

  if (odooAPI.isDemoMode) {
    document.getElementById('demoNoticeText').classList.remove('hidden');
  }

  // Auto-login check
  if (storedSid || odooAPI.isDemoMode) {
    try {
      hideLoginModal();
      await loadEmployeeProfile();
      await loadMetadata();
      await refreshTickets();
    } catch (err) {
      console.warn('Auto login session expired:', err);
      showLoginModal();
    }
  } else {
    showLoginModal();
  }
}

/* ==========================================================================
   LOGIN & AUTHENTICATION HANDLERS
   ========================================================================== */
function showLoginModal() {
  document.getElementById('loginModal').classList.add('active');
}

function hideLoginModal() {
  document.getElementById('loginModal').classList.remove('active');
}

function toggleDemoNotice(checkbox) {
  const notice = document.getElementById('demoNoticeText');
  if (checkbox.checked) {
    notice.classList.remove('hidden');
  } else {
    notice.classList.add('hidden');
  }
}

function fillStagingPreset() {
  document.getElementById('odooUrl').value = 'http://localhost:8068';
  document.getElementById('odooDb').value = 'zunax_test1';
  document.getElementById('useDemoMode').checked = false;
  toggleDemoNotice(document.getElementById('useDemoMode'));
  showToast('Staging URL & DB filled!', 'success');
}

async function handleLogin(e) {
  e.preventDefault();
  const url = document.getElementById('odooUrl').value;
  const db = document.getElementById('odooDb').value;
  const login = document.getElementById('odooLogin').value;
  const pass = document.getElementById('odooPassword').value;
  const isDemo = document.getElementById('useDemoMode').checked;

  const btnText = document.getElementById('loginBtnText');
  const spinner = document.getElementById('loginSpinner');
  const errAlert = document.getElementById('loginError');

  errAlert.classList.add('hidden');
  btnText.textContent = 'Connecting...';
  spinner.classList.remove('hidden');

  try {
    odooAPI.setServerConfig(url, db, isDemo);
    const authResult = await odooAPI.authenticate(login, pass);

    showToast('Login successful!', 'success');
    hideLoginModal();

    await loadEmployeeProfile();
    await loadMetadata();
    await refreshTickets();

  } catch (err) {
    errAlert.textContent = err.message || 'Failed to authenticate with Odoo.';
    errAlert.classList.remove('hidden');
  } finally {
    btnText.textContent = 'Sign In to Odoo';
    spinner.classList.add('hidden');
  }
}

function handleLogout() {
  odooAPI.clearSession();
  showToast('Logged out', 'info');
  showLoginModal();
}

/* ==========================================================================
   METADATA & EMPLOYEE PROFILE LOADING
   ========================================================================== */
async function loadEmployeeProfile() {
  try {
    loggedEmployee = await odooAPI.getLoggedEmployeeProfile();
    if (!loggedEmployee) {
      loggedEmployee = {
        name: 'Employee',
        work_email: 'employee@zunax.com',
        work_phone: '',
        job_title: 'Staff Member',
        department_id: false
      };
    }

    // Update Header
    document.getElementById('headerUserName').textContent = loggedEmployee.name.split(' ')[0];
    document.getElementById('headerAvatar').innerHTML = getInitials(loggedEmployee.name);

    // Update Profile Tab
    document.getElementById('profileName').textContent = loggedEmployee.name;
    document.getElementById('profileJob').textContent = loggedEmployee.job_title || 'Employee';
    document.getElementById('profileDept').textContent = loggedEmployee.department_id ? loggedEmployee.department_id[1] : 'General';
    document.getElementById('profileEmail').textContent = loggedEmployee.work_email || '--';
    document.getElementById('profilePhone').textContent = loggedEmployee.work_phone || loggedEmployee.mobile_phone || '--';
    document.getElementById('profileUid').textContent = `UID #${odooAPI.uid || '--'}`;
    document.getElementById('profileAvatar').innerHTML = getInitials(loggedEmployee.name);

    // Auto-fill Create Form Contact Info
    document.getElementById('contactEmail').value = loggedEmployee.work_email || '';
    document.getElementById('contactPhone').value = loggedEmployee.work_phone || loggedEmployee.mobile_phone || '';

    // Update Server Modal Info
    document.getElementById('srvUrl').textContent = odooAPI.serverUrl || 'Offline';
    document.getElementById('srvDb').textContent = odooAPI.db || '--';
    document.getElementById('srvSid').textContent = odooAPI.sessionId || '--';
    document.getElementById('srvMode').textContent = odooAPI.isDemoMode ? 'Offline Test / Demo Mode' : 'Live Odoo JSON-RPC';

  } catch (err) {
    console.error('Error loading employee profile:', err);
  }
}

async function loadMetadata() {
  try {
    // Load IT Departments
    const depts = await odooAPI.getITDepartments();
    const deptSelect = document.getElementById('deptSelect');
    deptSelect.innerHTML = '<option value="">-- Select Dept --</option>';
    depts.forEach(d => {
      deptSelect.innerHTML += `<option value="${d.id}">${escapeHtml(d.name)}</option>`;
    });

    // Load Predefined Ticket Subjects
    const subjects = await odooAPI.getTicketSubjects();
    const subjectSelect = document.getElementById('subjectSelect');
    subjectSelect.innerHTML = '<option value="">-- Select Predefined Subject (Optional) --</option>';
    subjects.forEach(s => {
      const deptId = s.department_id ? s.department_id[0] : '';
      subjectSelect.innerHTML += `<option value="${s.id}" data-dept="${deptId}">${escapeHtml(s.name)}</option>`;
    });
  } catch (err) {
    console.warn('Metadata loading warning:', err);
  }
}

function onSubjectChange(select) {
  const selectedOpt = select.options[select.selectedIndex];
  if (selectedOpt.value) {
    document.getElementById('ticketSubjectInput').value = selectedOpt.text;
    const deptId = selectedOpt.getAttribute('data-dept');
    if (deptId) {
      document.getElementById('deptSelect').value = deptId;
    }
  }
}

/* ==========================================================================
   TICKETS FEED & DASHBOARD STATS
   ========================================================================== */
async function refreshTickets() {
  const listEl = document.getElementById('ticketsList');
  const refreshIcon = document.getElementById('refreshIcon');
  refreshIcon.classList.add('fa-spin');

  try {
    currentTickets = await odooAPI.getTickets(currentFilterStage, currentSearchQuery);
    renderTickets();
    updateStatsCounter();
  } catch (err) {
    showToast('Failed to sync tickets from Odoo: ' + err.message, 'error');
  } finally {
    refreshIcon.classList.remove('fa-spin');
  }
}

function updateStatsCounter() {
  const total = currentTickets.length;
  const countNew = currentTickets.filter(t => t.stage === 'new' || t.stage === 'draft').length;
  const countProgress = currentTickets.filter(t => t.stage === 'in_progress').length;
  const countResolved = currentTickets.filter(t => t.stage === 'resolved').length;

  document.getElementById('statTotal').textContent = total;
  document.getElementById('statNew').textContent = countNew;
  document.getElementById('statInProgress').textContent = countProgress;
  document.getElementById('statResolved').textContent = countResolved;
}

function renderTickets() {
  const listEl = document.getElementById('ticketsList');

  if (!currentTickets || currentTickets.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-folder-open"></i>
        <h3>No IT Tickets Found</h3>
        <p>No tickets match your filter or search query.</p>
      </div>
    `;
    return;
  }

  let html = '';
  currentTickets.forEach((t, idx) => {
    const pBadge = getPriorityBadge(t.priority);
    const sBadge = getStageBadge(t.stage);
    const deptName = t.department_id ? t.department_id[1] : 'General IT';
    const num = t.ticket_number || `IT#${t.id}`;
    const dateStr = formatDate(t.create_date);
    const delay = (idx * 0.05).toFixed(2);

    html += `
      <div class="ticket-card" style="animation-delay: ${delay}s;" onclick="openTicketDetail(${t.id})">
        <div class="ticket-card-header">
          <span class="ticket-num">${escapeHtml(num)}</span>
          ${sBadge}
        </div>
        <h4 class="ticket-card-title">${escapeHtml(t.name)}</h4>
        <div class="ticket-card-meta">
          <span class="ticket-dept"><i class="fa-solid fa-building"></i> ${escapeHtml(deptName)}</span>
          <span>${pBadge}</span>
          <span><i class="fa-solid fa-clock"></i> ${dateStr}</span>
        </div>
      </div>
    `;
  });

  listEl.innerHTML = html;
}

function filterByStage(stage) {
  currentFilterStage = stage;
  const pills = document.querySelectorAll('.filter-pills .pill');
  pills.forEach(p => {
    if (p.getAttribute('data-stage') === stage) {
      p.classList.add('active');
    } else {
      p.classList.remove('active');
    }
  });
  refreshTickets();
}

function selectFilterPill(pillBtn, stage) {
  document.querySelectorAll('.filter-pills .pill').forEach(p => p.classList.remove('active'));
  pillBtn.classList.add('active');
  currentFilterStage = stage;
  refreshTickets();
}

function handleSearch() {
  currentSearchQuery = document.getElementById('searchInput').value.trim();
  refreshTickets();
}

/* ==========================================================================
   RAISE / CREATE TICKET HANDLER
   ========================================================================== */
async function handleCreateTicket(e) {
  e.preventDefault();
  const subjectId = document.getElementById('subjectSelect').value;
  const title = document.getElementById('ticketSubjectInput').value.trim();
  const deptId = document.getElementById('deptSelect').value;
  const priority = document.getElementById('prioritySelect').value;
  const desc = document.getElementById('ticketDescInput').value.trim();
  const email = document.getElementById('contactEmail').value;
  const phone = document.getElementById('contactPhone').value;

  const btn = document.getElementById('submitTicketBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Submitting to Odoo...';

  try {
    const newTicket = await odooAPI.createTicket({
      name: title,
      subject_id: subjectId,
      department_id: deptId,
      priority: priority,
      description: desc,
      email: email,
      phone: phone
    });

    showToast(`Ticket #${newTicket.ticket_number || newTicket.id} created!`, 'success');

    // Reset Form
    document.getElementById('createTicketForm').reset();
    document.getElementById('contactEmail').value = loggedEmployee ? loggedEmployee.work_email : '';

    // Switch to Tickets List
    switchTab('tabTickets');
    await refreshTickets();

  } catch (err) {
    showToast('Failed to create ticket: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit Ticket to Odoo';
  }
}

/* ==========================================================================
   TICKET DETAILS VIEW & STEPPER
   ========================================================================== */
async function openTicketDetail(ticketId) {
  activeTicket = currentTickets.find(t => t.id == ticketId);
  if (!activeTicket) return;

  const modal = document.getElementById('ticketDetailModal');
  modal.classList.add('active');

  document.getElementById('detailTicketNum').textContent = activeTicket.ticket_number || `IT#${activeTicket.id}`;
  document.getElementById('detailSubject').textContent = activeTicket.name;
  document.getElementById('detailPriority').className = `badge ${getPriorityClass(activeTicket.priority)}`;
  document.getElementById('detailPriority').textContent = getPriorityLabel(activeTicket.priority);
  document.getElementById('detailDept').textContent = activeTicket.department_id ? activeTicket.department_id[1] : 'Unassigned';
  document.getElementById('detailAssigned').textContent = activeTicket.assigned_user_id ? activeTicket.assigned_user_id[1] : 'Unassigned';
  document.getElementById('detailCreated').textContent = formatDate(activeTicket.create_date);

  // Resolution date
  const resolvedRow = document.getElementById('rowResolvedDate');
  if (activeTicket.date_resolved) {
    resolvedRow.classList.remove('hidden');
    document.getElementById('detailResolved').textContent = formatDate(activeTicket.date_resolved);
  } else {
    resolvedRow.classList.add('hidden');
  }

  // Description
  document.getElementById('detailDescription').innerHTML = activeTicket.description || 'No detailed description provided.';

  // Resolution Notes Box
  const resBox = document.getElementById('resolutionBox');
  if (activeTicket.stage === 'resolved' && activeTicket.resolution_notes) {
    resBox.classList.remove('hidden');
    document.getElementById('detailResolutionNotes').innerHTML = activeTicket.resolution_notes;
  } else {
    resBox.classList.add('hidden');
  }

  // Cancellation Box
  const cancelBox = document.getElementById('cancellationBox');
  if (activeTicket.stage === 'cancelled' && activeTicket.cancellation_reason) {
    cancelBox.classList.remove('hidden');
    document.getElementById('detailCancellationReason').textContent = activeTicket.cancellation_reason;
  } else {
    cancelBox.classList.add('hidden');
  }

  // Update Stepper
  updateStepper(activeTicket.stage);

  // Update Action Buttons
  const actionsBox = document.getElementById('detailActions');
  if (activeTicket.stage === 'cancelled' || activeTicket.stage === 'resolved') {
    actionsBox.classList.add('hidden');
  } else {
    actionsBox.classList.remove('hidden');
  }

  // Load Chatter
  loadChatter(activeTicket.id);
}

function closeTicketDetail() {
  document.getElementById('ticketDetailModal').classList.remove('active');
  activeTicket = null;
}

function updateStepper(stage) {
  const steps = document.querySelectorAll('#ticketStepper .step');
  const stageOrder = ['draft', 'new', 'in_progress', 'resolved'];
  const currentIndex = stageOrder.indexOf(stage);

  steps.forEach((step, idx) => {
    step.className = 'step';
    if (stage === 'cancelled') {
      if (idx === 0) step.classList.add('active');
    } else if (idx < currentIndex) {
      step.classList.add('completed');
    } else if (idx === currentIndex) {
      step.classList.add('active');
    }
  });
}

async function refreshCurrentTicketDetail() {
  if (!activeTicket) return;
  await refreshTickets();
  openTicketDetail(activeTicket.id);
  showToast('Ticket updated', 'success');
}

/* ==========================================================================
   CHATTER / COMMENTS
   ========================================================================== */
async function loadChatter(ticketId) {
  const chatterList = document.getElementById('chatterList');
  chatterList.innerHTML = '<p class="text-muted"><i class="fa-solid fa-spinner fa-spin"></i> Loading comments...</p>';

  try {
    const comments = await odooAPI.getTicketChatter(ticketId);
    if (!comments || comments.length === 0) {
      chatterList.innerHTML = '<p class="text-muted" style="font-size: 0.8rem;">No comments posted yet.</p>';
      return;
    }

    let html = '';
    comments.forEach(c => {
      const author = c.author_id ? c.author_id[1] : 'Odoo User';
      const dateStr = formatDate(c.date);
      html += `
        <div class="chat-bubble">
          <div class="chat-meta">
            <strong>${escapeHtml(author)}</strong>
            <span>${dateStr}</span>
          </div>
          <div>${c.body}</div>
        </div>
      `;
    });

    chatterList.innerHTML = html;
  } catch (err) {
    chatterList.innerHTML = '<p class="text-danger">Could not load chatter messages.</p>';
  }
}

async function postComment() {
  if (!activeTicket) return;
  const input = document.getElementById('commentInput');
  const text = input.value.trim();
  if (!text) return;

  try {
    await odooAPI.postComment(activeTicket.id, text);
    showToast('Message sent to Odoo', 'success');
    input.value = '';
    loadChatter(activeTicket.id);
  } catch (err) {
    showToast('Failed to post message: ' + err.message, 'error');
  }
}

/* ==========================================================================
   CANCEL TICKET MODAL HANDLER
   ========================================================================== */
function openCancelModal() {
  document.getElementById('cancelModal').classList.add('active');
  document.getElementById('cancelReasonText').value = '';
  document.getElementById('cancelReasonPreset').value = '';
}

function closeCancelModal() {
  document.getElementById('cancelModal').classList.remove('active');
}

function onCancelPresetChange(select) {
  if (select.value && select.value !== 'Other') {
    document.getElementById('cancelReasonText').value = select.value;
  }
}

async function submitCancelTicket() {
  if (!activeTicket) return;
  const reason = document.getElementById('cancelReasonText').value.trim();
  if (!reason) {
    showToast('Please specify a cancellation reason.', 'error');
    return;
  }

  try {
    await odooAPI.cancelTicket(activeTicket.id, reason);
    showToast('Ticket cancelled successfully', 'success');
    closeCancelModal();
    closeTicketDetail();
    await refreshTickets();
  } catch (err) {
    showToast('Failed to cancel ticket: ' + err.message, 'error');
  }
}

/* ==========================================================================
   SERVER STATUS MODAL
   ========================================================================== */
function showServerModal() {
  document.getElementById('serverModal').classList.add('active');
}

function closeServerModal() {
  document.getElementById('serverModal').classList.remove('active');
}

async function testConnection() {
  try {
    showToast('Testing Odoo connection...', 'info');
    await loadMetadata();
    showToast('Odoo server connection OK!', 'success');
  } catch (e) {
    showToast('Connection failed: ' + e.message, 'error');
  }
}

/* ==========================================================================
   NAVIGATION & UI HELPERS
   ========================================================================== */
function switchTab(tabId) {
  currentTab = tabId;
  document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.bottom-nav .nav-item').forEach(n => n.classList.remove('active'));

  const activeTabEl = document.getElementById(tabId);
  if (activeTabEl) {
    activeTabEl.classList.add('active');
  }
  const navBtn = document.querySelector(`.bottom-nav .nav-item[data-tab="${tabId}"]`);
  if (navBtn) navBtn.classList.add('active');

  const contentEl = document.querySelector('.app-content');
  if (contentEl) contentEl.scrollTo({ top: 0, behavior: 'smooth' });
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let icon = 'fa-circle-info';
  if (type === 'success') icon = 'fa-circle-check';
  if (type === 'error') icon = 'fa-triangle-exclamation';

  toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function getPriorityBadge(priority) {
  const label = getPriorityLabel(priority);
  const cls = getPriorityClass(priority);
  return `<span class="badge ${cls}">${label}</span>`;
}

function getPriorityLabel(priority) {
  switch (String(priority)) {
    case '0': return 'Low';
    case '1': return 'Medium';
    case '2': return 'High';
    case '3': return 'Urgent';
    default: return 'Medium';
  }
}

function getPriorityClass(priority) {
  switch (String(priority)) {
    case '0': return 'badge-low';
    case '1': return 'badge-med';
    case '2': return 'badge-high';
    case '3': return 'badge-urgent';
    default: return 'badge-med';
  }
}

function getStageBadge(stage) {
  let label = stage;
  if (stage === 'in_progress') label = 'In Progress';
  return `<span class="badge badge-stage-${stage}">${label}</span>`;
}

function getInitials(name) {
  if (!name) return 'U';
  const parts = name.trim().split(' ');
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.substring(0, 2).toUpperCase();
}

function formatDate(dateStr) {
  if (!dateStr) return '--';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
