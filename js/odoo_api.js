/**
 * Odoo REST API Client for Zunax IT Support Mobile App
 *
 * PULL endpoints (GET):
 *   GET  /api/v1/auth/me             → current user profile
 *   GET  /api/v1/departments         → IT departments list
 *   GET  /api/v1/subjects            → ticket subjects list
 *   GET  /api/v1/cancellation-reasons
 *   GET  /api/v1/tickets             → list tickets (paginated)
 *   GET  /api/v1/tickets/<id>        → single ticket detail
 *
 * PUSH endpoints (POST / PUT):
 *   POST /api/v1/auth/login          → authenticate, get session
 *   POST /api/v1/auth/logout         → destroy session
 *   POST /api/v1/tickets             → create new ticket
 *   PUT  /api/v1/tickets/<id>        → update ticket fields
 *   POST /api/v1/tickets/<id>/submit          → draft → new
 *   POST /api/v1/tickets/<id>/start-progress  → new → in_progress
 *   POST /api/v1/tickets/<id>/resolve         → in_progress → resolved
 *   POST /api/v1/tickets/<id>/cancel          → cancel ticket
 *
 * Chatter (JSON-RPC fallback – no REST endpoint exists):
 *   POST /web/dataset/call_kw  (mail.message search_read / it.ticket message_post)
 */

class OdooAPIClient {
  constructor() {
    this.serverUrl   = localStorage.getItem('odoo_url')        || '';
    this.db          = localStorage.getItem('odoo_db')         || '';
    this.sessionId   = localStorage.getItem('odoo_session_id') || '';
    this.uid         = parseInt(localStorage.getItem('odoo_uid'))         || null;
    this.employeeId  = parseInt(localStorage.getItem('odoo_employee_id')) || null;
    this.isDemoMode  = localStorage.getItem('odoo_demo_mode') === 'true';
    this.currentUser = null; // cached /api/v1/auth/me response
    this._rpcId      = 1;
  }

  // ---------------------------------------------------------------------------
  // Configuration & Session helpers
  // ---------------------------------------------------------------------------

  setServerConfig(url, db, isDemo = false) {
    let cleanUrl = url.trim().replace(/\/+$/, '');
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = 'http://' + cleanUrl;
    }
    this.serverUrl  = cleanUrl;
    this.db         = db.trim();
    this.isDemoMode = isDemo;
    localStorage.setItem('odoo_url',       this.serverUrl);
    localStorage.setItem('odoo_db',        this.db);
    localStorage.setItem('odoo_demo_mode', this.isDemoMode ? 'true' : 'false');
  }

  saveSession(sessionId, uid) {
    this.sessionId = sessionId;
    this.uid       = uid;
    localStorage.setItem('odoo_session_id', sessionId);
    localStorage.setItem('odoo_uid',        uid);
  }

  clearSession() {
    this.sessionId   = '';
    this.uid         = null;
    this.employeeId  = null;
    this.currentUser = null;
    localStorage.removeItem('odoo_session_id');
    localStorage.removeItem('odoo_uid');
    localStorage.removeItem('odoo_employee_id');
  }

  // ---------------------------------------------------------------------------
  // Core REST fetch  (proxy-first, then direct fallback)
  // ---------------------------------------------------------------------------

  async _restFetch(method, path, body = null) {
    const headers = {
      'Content-Type': 'application/json',
      'Accept':       'application/json',
    };
    if (this.sessionId) {
      headers['X-Openerp-Session-Id'] = this.sessionId;
    }

    const options = {
      method,
      headers,
      credentials: 'include',
    };
    if (body !== null) {
      options.body = JSON.stringify(body);
    }

    let response;
    try {
      response = await fetch(`/proxy${path}`, options);
    } catch (_) {
      try {
        response = await fetch(`${this.serverUrl}${path}`, options);
      } catch (err) {
        throw new Error(
          `Cannot reach Odoo at "${this.serverUrl}". ` +
          `Make sure Odoo is running and the local proxy (server.py) is up.`
        );
      }
    }

    let json;
    try {
      json = await response.json();
    } catch (_) {
      throw new Error(`HTTP ${response.status}: non-JSON response from ${path}`);
    }

    if (json.success === false) {
      throw new Error(json.error || `API error ${json.code || response.status}`);
    }

    return json.data !== undefined ? json.data : json;
  }

  async _get(path, queryParams = {}) {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(queryParams).filter(([, v]) => v !== undefined && v !== null && v !== ''))
    ).toString();
    return this._restFetch('GET', qs ? `${path}?${qs}` : path);
  }

  async _post(path, body = {}) { return this._restFetch('POST',  path, body); }
  async _put(path,  body = {}) { return this._restFetch('PUT',   path, body); }

  // ---------------------------------------------------------------------------
  // JSON-RPC fallback (chatter only — no REST endpoint exists)
  // ---------------------------------------------------------------------------

  async _jsonrpc(endpoint, params = {}) {
    const payload = { jsonrpc: '2.0', method: 'call', params, id: this._rpcId++ };
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (this.sessionId) headers['X-Openerp-Session-Id'] = this.sessionId;

    const options = { method: 'POST', headers, credentials: 'include', body: JSON.stringify(payload) };

    let response;
    try {
      response = await fetch(`/proxy${endpoint}`, options);
    } catch (_) {
      response = await fetch(`${this.serverUrl}${endpoint}`, options);
    }

    const json = await response.json();
    if (json.error) {
      const msg = json.error.data
        ? (json.error.data.message || json.error.data.arguments?.[0])
        : json.error.message;
      throw new Error(msg || 'Odoo RPC Error');
    }
    return json.result;
  }

  async _callKw(model, method, args = [], kwargs = {}) {
    return this._jsonrpc('/web/dataset/call_kw', { model, method, args, kwargs });
  }

  // ---------------------------------------------------------------------------
  //  AUTH — PUSH
  // ---------------------------------------------------------------------------

  /**
   * Authenticate with the custom REST API.
   * PUSH: POST /api/v1/auth/login
   */
  async authenticate(username, password) {
    if (this.isDemoMode) {
      this.saveSession('demo_session_123', 2);
      this.employeeId = 10;
      localStorage.setItem('odoo_employee_id', 10);
      return {
        uid: 2,
        name: username.split('@')[0] || 'Demo Employee',
        username,
        employee: { id: 10, name: 'Demo Employee', work_email: username, mobile_phone: '' },
      };
    }

    const data = await this._post('/api/v1/auth/login', {
      login:    username,
      password: password,
      db:       this.db,
    });
    // data = { session_id, uid, db, user: {...} }
    this.saveSession(data.session_id, data.uid);
    this.currentUser = data.user;

    const empId = data.user?.employee?.id || null;
    if (empId) {
      this.employeeId = empId;
      localStorage.setItem('odoo_employee_id', empId);
    }

    return {
      uid:      data.uid,
      name:     data.user?.name || username,
      employee: data.user?.employee || null,
    };
  }

  /**
   * Logout from Odoo.
   * PUSH: POST /api/v1/auth/logout
   */
  async logout() {
    if (!this.isDemoMode && this.sessionId) {
      try { await this._post('/api/v1/auth/logout', {}); } catch (_) {}
    }
    this.clearSession();
  }

  // ---------------------------------------------------------------------------
  //  AUTH — PULL
  // ---------------------------------------------------------------------------

  /**
   * Fetch current user profile.
   * PULL: GET /api/v1/auth/me
   *
   * Returns shape compatible with what app.js expects from getLoggedEmployeeProfile().
   */
  async getLoggedEmployeeProfile(uid = this.uid) {
    if (this.isDemoMode) {
      return {
        id:            10,
        name:          'Alex Rivera',
        work_email:    'alex.rivera@zunax.com',
        work_phone:    '+1 (555) 234-5678',
        mobile_phone:  '',
        job_title:     'Senior Systems Analyst',
        department_id: [1, 'IT Infrastructure & Operations'],
        user_id:       [uid, 'Alex Rivera'],
      };
    }

    try {
      const user = await this._get('/api/v1/auth/me');
      this.currentUser = user;
      const emp = user.employee || {};
      return {
        id:            emp.id   || null,
        name:          user.name || emp.name || 'Employee',
        work_email:    emp.work_email   || user.email || '',
        work_phone:    emp.mobile_phone || '',
        mobile_phone:  emp.mobile_phone || '',
        job_title:     '',
        department_id: false,
        user_id:       [user.id, user.name],
      };
    } catch (e) {
      console.warn('Could not fetch /api/v1/auth/me:', e.message);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  //  MASTER DATA — PULL
  // ---------------------------------------------------------------------------

  /**
   * Fetch IT Departments.
   * PULL: GET /api/v1/departments
   */
  async getITDepartments() {
    if (this.isDemoMode) {
      return [
        { id: 1, name: 'IT Hardware & Support' },
        { id: 2, name: 'Software & Cloud Services' },
        { id: 3, name: 'Network & Connectivity' },
        { id: 4, name: 'ERP & Odoo Administration' },
      ];
    }
    const depts = await this._get('/api/v1/departments');
    return Array.isArray(depts) ? depts : [];
  }

  /**
   * Fetch Ticket Subjects (optionally filtered by department).
   * PULL: GET /api/v1/subjects?department_id=<id>
   *
   * Returns [{id, name, department_id: [id, name]}, ...] for app.js selects.
   */
  async getTicketSubjects(departmentId = null) {
    if (this.isDemoMode) {
      return [
        { id: 1, name: 'Hardware Repair / Laptop Issue',  department_id: [1, 'IT Hardware & Support'] },
        { id: 2, name: 'Password Reset / Account Unlock', department_id: [2, 'Software & Cloud Services'] },
        { id: 3, name: 'WiFi / Network Connection Drop',  department_id: [3, 'Network & Connectivity'] },
        { id: 4, name: 'Odoo Permission / Module Access', department_id: [4, 'ERP & Odoo Administration'] },
      ];
    }
    const subjects = await this._get('/api/v1/subjects', departmentId ? { department_id: departmentId } : {});
    // REST returns [{id, name, department: {id, name}}] — remap to many2one tuple
    return (Array.isArray(subjects) ? subjects : []).map(s => ({
      ...s,
      department_id: s.department ? [s.department.id, s.department.name] : false,
    }));
  }

  /**
   * Fetch Cancellation Reasons.
   * PULL: GET /api/v1/cancellation-reasons
   */
  async getCancellationReasons() {
    if (this.isDemoMode) {
      return [
        { id: 1, name: 'Issue resolved on my own' },
        { id: 2, name: 'Duplicate ticket' },
        { id: 3, name: 'No longer needed' },
      ];
    }
    const reasons = await this._get('/api/v1/cancellation-reasons');
    return Array.isArray(reasons) ? reasons : [];
  }

  // ---------------------------------------------------------------------------
  //  TICKETS — PULL
  // ---------------------------------------------------------------------------

  /**
   * List tickets for the current user.
   * PULL: GET /api/v1/tickets?stage=<>&page=<>&limit=<>
   *
   * Returns flat array shaped for app.js renderTickets().
   */
  async getTickets(stageFilter = 'all', searchQuery = '', page = 1, limit = 50) {
    if (this.isDemoMode) {
      return this.getDemoTickets(stageFilter, searchQuery);
    }

    const params = { page, limit };
    if (stageFilter && stageFilter !== 'all') params.stage = stageFilter;

    const data = await this._get('/api/v1/tickets', params);
    let tickets = Array.isArray(data.tickets) ? data.tickets : (Array.isArray(data) ? data : []);

    // Client-side search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      tickets = tickets.filter(t =>
        (t.name          || '').toLowerCase().includes(q) ||
        (t.ticket_number || '').toLowerCase().includes(q)
      );
    }

    return tickets.map(t => this._remapTicket(t));
  }

  /**
   * Fetch a single ticket's full detail.
   * PULL: GET /api/v1/tickets/<id>
   */
  async getTicketDetail(ticketId) {
    if (this.isDemoMode) {
      const all = await this.getDemoTickets('all', '');
      return all.find(t => t.id == ticketId) || null;
    }
    const ticket = await this._get(`/api/v1/tickets/${ticketId}`);
    return this._remapTicket(ticket);
  }

  // ---------------------------------------------------------------------------
  //  TICKETS — PUSH
  // ---------------------------------------------------------------------------

  /**
   * Create a new IT support ticket.
   * PUSH: POST /api/v1/tickets
   */
  async createTicket(data) {
    if (this.isDemoMode) {
      return this.createDemoTicket(data);
    }

    const body = {
      name:          data.name        || '',
      department_id: data.department_id ? parseInt(data.department_id) : undefined,
      priority:      data.priority    || '1',
      description:   data.description || '',
      email:         data.email       || '',
      phone:         data.phone       || '',
      stage:         'new',
    };
    if (data.subject_id) body.subject_id = parseInt(data.subject_id);

    const ticket = await this._post('/api/v1/tickets', body);
    return this._remapTicket(ticket);
  }

  /**
   * Update editable fields of an existing ticket.
   * PUSH: PUT /api/v1/tickets/<id>
   *
   * @param {number} ticketId
   * @param {Object} fields – any subset of ticket fields
   */
  async updateTicket(ticketId, fields) {
    if (this.isDemoMode) { return true; }
    const ticket = await this._put(`/api/v1/tickets/${ticketId}`, fields);
    return this._remapTicket(ticket);
  }

  /**
   * Submit a draft ticket to the queue (draft → new).
   * PUSH: POST /api/v1/tickets/<id>/submit
   */
  async submitTicket(ticketId) {
    if (this.isDemoMode) { return true; }
    const ticket = await this._post(`/api/v1/tickets/${ticketId}/submit`, {});
    return this._remapTicket(ticket);
  }

  /**
   * Move ticket to In-Progress (new → in_progress). Staff/manager only.
   * PUSH: POST /api/v1/tickets/<id>/start-progress
   */
  async startProgress(ticketId) {
    if (this.isDemoMode) { return true; }
    const ticket = await this._post(`/api/v1/tickets/${ticketId}/start-progress`, {});
    return this._remapTicket(ticket);
  }

  /**
   * Resolve a ticket (in_progress → resolved). Staff/manager only.
   * PUSH: POST /api/v1/tickets/<id>/resolve
   *
   * @param {number} ticketId
   * @param {string} resolutionNotes – required
   */
  async resolveTicket(ticketId, resolutionNotes) {
    if (this.isDemoMode) { return true; }
    const ticket = await this._post(`/api/v1/tickets/${ticketId}/resolve`, {
      resolution_notes: resolutionNotes,
    });
    return this._remapTicket(ticket);
  }

  /**
   * Cancel a ticket.
   * PUSH: POST /api/v1/tickets/<id>/cancel
   *
   * @param {number} ticketId
   * @param {string} reason – required
   */
  async cancelTicket(ticketId, reason) {
    if (this.isDemoMode) { return this.cancelDemoTicket(ticketId, reason); }
    const ticket = await this._post(`/api/v1/tickets/${ticketId}/cancel`, { reason });
    return this._remapTicket(ticket);
  }

  // ---------------------------------------------------------------------------
  //  CHATTER — JSON-RPC fallback (no REST endpoint for mail.message)
  // ---------------------------------------------------------------------------

  /**
   * PULL: Fetch chatter messages for a ticket.
   */
  async getTicketChatter(ticketId) {
    if (this.isDemoMode) {
      return [
        {
          id:        1,
          author_id: [1, 'System Auto-Router'],
          body:      '<p>Ticket created and auto-assigned to IT Hardware team.</p>',
          date:      '2026-07-30 10:15:00',
        },
        {
          id:        2,
          author_id: [5, 'IT Support Engineer'],
          body:      '<p>Hello, we received your ticket and are investigating the issue.</p>',
          date:      '2026-07-30 10:45:00',
        },
      ];
    }

    return this._callKw('mail.message', 'search_read', [], {
      domain: [
        ['res_id', '=', parseInt(ticketId)],
        ['model',  '=', 'it.ticket'],
      ],
      fields: ['id', 'author_id', 'body', 'date'],
      limit:  30,
      order:  'id asc',
    });
  }

  /**
   * PUSH: Post a comment on a ticket chatter.
   */
  async postComment(ticketId, messageBody) {
    if (this.isDemoMode) { return true; }
    return this._callKw('it.ticket', 'message_post', [[parseInt(ticketId)]], {
      body:          messageBody,
      message_type:  'comment',
      subtype_xmlid: 'mail.mt_comment',
    });
  }

  // ---------------------------------------------------------------------------
  //  Internal: remap REST ticket shape → app.js expected shape
  // ---------------------------------------------------------------------------

  /**
   * The REST API returns nested objects ({department: {id, name}})
   * but app.js reads many2one tuples: department_id[1], assigned_user_id[1], etc.
   * This adapter bridges both shapes so app.js needs zero changes.
   */
  _remapTicket(t) {
    if (!t) return t;
    return {
      id:                  t.id,
      ticket_number:       t.ticket_number,
      name:                t.name,
      stage:               t.stage,
      priority:            t.priority,
      description:         t.description        || '',
      resolution_notes:    t.resolution_notes   || false,
      cancellation_reason: t.cancellation_reason || false,
      email:               t.email  || '',
      phone:               t.phone  || '',
      create_date:         t.create_date,
      date_resolved:       t.date_resolved      || false,
      resolution_time:     t.resolution_time,
      // Many2one tuples: [id, name]
      department_id:    t.department  ? [t.department.id,  t.department.name]  : false,
      subject_id:       t.subject     ? [t.subject.id,     t.subject.name]     : false,
      employee_id:      t.employee    ? [t.employee.id,    t.employee.name]    : false,
      assigned_user_id: t.assigned_to ? [t.assigned_to.id, t.assigned_to.name] : false,
      partner_id:       t.partner     ? [t.partner.id,     t.partner.name]     : false,
    };
  }

  /* ==========================================================================
     DEMO MODE ENGINE (FOR OFFLINE / TEST WITHOUT LIVE ODOO SERVER)
     ========================================================================== */

  getDemoTickets(stageFilter, searchQuery) {
    if (!this._demoTickets) {
      this._demoTickets = [
        {
          id: 101,
          ticket_number: 'IT00084',
          name: 'Docking station display flickers on dual monitors',
          subject_id: [1, 'Hardware Repair / Laptop Issue'],
          employee_id: [10, 'Alex Rivera'],
          department_id: [1, 'IT Hardware & Support'],
          assigned_user_id: [3, 'Sarah Connor (IT Manager)'],
          priority: '2',
          stage: 'in_progress',
          description: '<p>Whenever I plug in my dual 4K monitors through Thunderbolt USB-C dock, the secondary display turns off every 5 minutes.</p>',
          resolution_notes: false,
          cancellation_reason: false,
          create_date: '2026-07-30 09:30:12',
          date_resolved: false
        },
        {
          id: 102,
          ticket_number: 'IT00082',
          name: 'Odoo 18 Sales module access permission required',
          subject_id: [4, 'Odoo Permission / Module Access'],
          employee_id: [10, 'Alex Rivera'],
          department_id: [4, 'ERP & Odoo Administration'],
          assigned_user_id: [2, 'Odoo Administrator'],
          priority: '1',
          stage: 'resolved',
          description: '<p>Need read access to Sales and Quotations for quarterly reporting.</p>',
          resolution_notes: '<p>Granted Sales User / Manager security group in Odoo settings.</p>',
          cancellation_reason: false,
          create_date: '2026-07-28 14:20:00',
          date_resolved: '2026-07-28 16:45:00'
        },
        {
          id: 103,
          ticket_number: 'IT00079',
          name: 'VPN credentials expired during remote travel',
          subject_id: [3, 'WiFi / Network Connection Drop'],
          employee_id: [10, 'Alex Rivera'],
          department_id: [3, 'Network & Connectivity'],
          assigned_user_id: false,
          priority: '3',
          stage: 'new',
          description: '<p>Unable to connect to company Cisco AnyConnect VPN. Received SSL cert error.</p>',
          resolution_notes: false,
          cancellation_reason: false,
          create_date: '2026-07-30 11:05:00',
          date_resolved: false
        }
      ];
    }

    let list = [...this._demoTickets];
    if (stageFilter && stageFilter !== 'all') {
      list = list.filter(t => t.stage === stageFilter);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(t => t.name.toLowerCase().includes(q) || t.ticket_number.toLowerCase().includes(q));
    }
    return Promise.resolve(list);
  }

  createDemoTicket(data) {
    const newId = 100 + (this._demoTickets ? this._demoTickets.length + 1 : 4);
    const num = `IT000${newId}`;
    const newTicket = {
      id: newId,
      ticket_number: num,
      name: data.name,
      subject_id: data.subject_id ? [parseInt(data.subject_id), 'Selected Subject'] : false,
      employee_id: [10, 'Alex Rivera'],
      department_id: [parseInt(data.department_id), 'IT Department'],
      assigned_user_id: [2, 'Support Staff (Auto Assigned)'],
      priority: data.priority || '1',
      stage: 'new',
      description: `<p>${data.description.replace(/\n/g, '<br>')}</p>`,
      resolution_notes: false,
      cancellation_reason: false,
      create_date: new Date().toISOString().replace('T', ' ').substring(0, 19),
      date_resolved: false
    };

    if (!this._demoTickets) this.getDemoTickets('all', '');
    this._demoTickets.unshift(newTicket);
    return Promise.resolve(newTicket);
  }

  cancelDemoTicket(ticketId, reason) {
    if (!this._demoTickets) this.getDemoTickets('all', '');
    const t = this._demoTickets.find(x => x.id == ticketId);
    if (t) {
      t.stage = 'cancelled';
      t.cancellation_reason = reason;
    }
    return Promise.resolve(true);
  }
}

// Global instance
const odooAPI = new OdooAPIClient();
