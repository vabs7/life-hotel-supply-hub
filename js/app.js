/**
 * Application Engine - Life Hotel Supply Attendance Hub
 */

// Global State
let currentUser = null;
let appData = {
    users: [],
    attendance: [],
    salary_history: []
};

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
    // 0. Set all month/year dropdowns to current real-world month immediately
    initDefaultMonthYearFilters();

    // 1. Immediately verify session from localStorage to display app/login without delay
    checkAuthSession();

    // 2. Load live data from Firebase (or local fallback)
    try {
        if (typeof initFirebaseServices === 'function') {
            await initFirebaseServices();
        }
        await initDataStore();
    } catch (e) {
        console.error('Initialization error:', e);
    }

    initClockTimer();

    // 3. Re-render UI with populated data store if user is logged in
    if (currentUser) {
        onUserAuthenticated();
    }
});

// Initialize Data Store — reads from localStorage cache first, Firestore only when cache is stale
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

async function initDataStore() {
    // Check localStorage cache freshness
    const cacheTs = parseInt(localStorage.getItem('lhs_cache_ts') || '0');
    const cacheAge = Date.now() - cacheTs;
    const isCacheFresh = cacheAge < CACHE_TTL_MS;

    const cachedUsers = localStorage.getItem('lhs_users');
    const cachedAtt = localStorage.getItem('lhs_attendance');
    const cachedSal = localStorage.getItem('lhs_salary_history');

    if (isCacheFresh && cachedUsers && cachedAtt) {
        // Serve from localStorage — zero Firestore reads
        try {
            appData.users = JSON.parse(cachedUsers) || [];
            appData.attendance = JSON.parse(cachedAtt) || [];
            appData.salary_history = JSON.parse(cachedSal) || [];
            console.log(`Data loaded from cache (${Math.round(cacheAge / 60000)}m old). Skipped Firestore reads.`);
            return;
        } catch (e) {
            console.warn('Cache parse error, falling back to Firestore:', e);
        }
    }

    // Cache stale or missing — fetch from Firestore
    console.log('Cache stale or missing — fetching from Firestore...');
    try {
        if (typeof firebaseDb !== 'undefined' && firebaseDb) {
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Firebase fetch timeout')), 5000)
            );

            let attQuery = null;
            let salQuery = null;

            if (currentUser) {
                const now = new Date();
                const year = now.getFullYear();
                const month = String(now.getMonth() + 1).padStart(2, '0');
                const startStr = `${year}-${month}-01`;
                const endStr = `${year}-${month}-31`;

                const isHrOrAdmin = isHrOrAdminUser(currentUser);

                if (!isHrOrAdmin) {
                    // Regular employees only fetch their own current month's records on initial load
                    attQuery = firebaseDb.collection('attendance')
                        .where('user_id', '==', String(currentUser.id))
                        .where('date', '>=', startStr)
                        .where('date', '<=', endStr)
                        .get();
                    salQuery = firebaseDb.collection('salary_history').where('user_id', '==', String(currentUser.id)).get();
                } else {
                    // HR and Admin fetch current month's records for all team members on initial load
                    attQuery = firebaseDb.collection('attendance')
                        .where('date', '>=', startStr)
                        .where('date', '<=', endStr)
                        .get();
                    salQuery = firebaseDb.collection('salary_history').get();
                }
            }

            let queries = [];
            if (currentUser) {
                queries.push(firebaseDb.collection('users').get());
                if (attQuery) queries.push(attQuery);
                if (salQuery) queries.push(salQuery);
            }

            if (queries.length === 0) {
                console.log('No user logged in. Skipping all Firebase reads.');
                return;
            }

            const fetchPromise = Promise.all(queries);

            const results = await Promise.race([fetchPromise, timeoutPromise]);

            const usersSnap = results[0];
            const attSnap = attQuery ? results[1] : null;
            const salSnap = salQuery ? results[2] : null;

            if (usersSnap && !usersSnap.empty) appData.users = usersSnap.docs.map(doc => doc.data());
            if (attSnap && !attSnap.empty) appData.attendance = attSnap.docs.map(doc => doc.data());
            else if (!attSnap) appData.attendance = [];

            if (salSnap && !salSnap.empty) appData.salary_history = salSnap.docs.map(doc => doc.data());
            else if (!salSnap) appData.salary_history = [];

            // Persist to localStorage and stamp the cache
            saveDataStore();
            console.log(`Firestore fetch complete (${appData.users.length} users, ${appData.attendance.length} attendance, ${appData.salary_history.length} salary). Cache updated.`);
            return;
        }
    } catch (err) {
        console.warn('Firestore fetch failed, using local cache if available:', err);
        // Use whatever stale cache we have rather than showing nothing
        if (cachedUsers) {
            try {
                appData.users = JSON.parse(cachedUsers) || [];
                appData.attendance = JSON.parse(cachedAtt) || [];
                appData.salary_history = JSON.parse(cachedSal) || [];
                return;
            } catch (e) { }
        }
    }

    // Last resort: seed from bundled JSON
    try {
        const res = await fetch('migrated_data.json');
        const initialData = await res.json();
        appData.users = initialData.users || [];
        appData.attendance = initialData.attendance || [];
        appData.salary_history = initialData.salary_history || [];
        saveDataStore();
    } catch (e) {
        console.error('All data sources failed:', e);
    }
}

function saveDataStore() {
    try {
        localStorage.setItem('lhs_users', JSON.stringify(appData.users));
        localStorage.setItem('lhs_attendance', JSON.stringify(appData.attendance));
        localStorage.setItem('lhs_salary_history', JSON.stringify(appData.salary_history));
        localStorage.setItem('lhs_cache_ts', String(Date.now())); // stamp cache
    } catch (e) {
        console.warn('LocalStorage save error:', e);
    }
}

// Force a fresh Firestore sync (call after significant remote changes)
async function forceRefreshFromFirestore() {
    localStorage.removeItem('lhs_cache_ts'); // invalidate cache
    await initDataStore();
}

// Save document directly to Firebase Cloud Firestore
async function saveFirebaseDoc(collectionName, docId, dataObj) {
    if (typeof firebaseDb !== 'undefined' && firebaseDb) {
        try {
            await firebaseDb.collection(collectionName).doc(String(docId)).set(dataObj, { merge: true });
        } catch (err) {
            console.error(`Firebase save error (${collectionName}/${docId}):`, err);
        }
    }
}

// Delete document directly from Firebase Cloud Firestore
async function deleteFirebaseDoc(collectionName, docId) {
    if (typeof firebaseDb !== 'undefined' && firebaseDb) {
        try {
            await firebaseDb.collection(collectionName).doc(String(docId)).delete();
        } catch (err) {
            console.error(`Firebase delete error (${collectionName}/${docId}):`, err);
        }
    }
}

function saveDataStore() {
    try {
        localStorage.setItem('lhs_users', JSON.stringify(appData.users));
        localStorage.setItem('lhs_attendance', JSON.stringify(appData.attendance));
        localStorage.setItem('lhs_salary_history', JSON.stringify(appData.salary_history));
    } catch (e) {
        console.warn('LocalStorage save error:', e);
    }
}

// Clock & Time Helper
function initClockTimer() {
    updateClock();
    setInterval(updateClock, 1000);
}

function updateClock() {
    const now = new Date();
    const clockTimeEl = document.getElementById('clockTime');
    const clockDateEl = document.getElementById('clockDate');
    const currentDateDisplay = document.getElementById('currentDateDisplay');
    const headerChicagoClock = document.getElementById('headerChicagoClock');

    const timeStr = now.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour12: true }) + ' (CT)';

    if (clockTimeEl) clockTimeEl.textContent = timeStr;
    if (headerChicagoClock) headerChicagoClock.textContent = timeStr;

    const options = { timeZone: 'America/Chicago', weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' };
    const dateStr = now.toLocaleDateString('en-US', options);
    if (clockDateEl) clockDateEl.textContent = dateStr;
    if (currentDateDisplay) currentDateDisplay.textContent = dateStr;
}

function getTodayString() {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago',
        year: 'numeric', month: '2-digit', day: '2-digit'
    });
    const parts = formatter.formatToParts(now);
    const m = parts.find(p => p.type === 'month').value;
    const d = parts.find(p => p.type === 'day').value;
    const y = parts.find(p => p.type === 'year').value;
    return `${y}-${m}-${d}`;
}

function getDateTimeString() {
    const now = new Date();
    const datePart = getTodayString();
    const timePart = now.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour12: false });
    return `${datePart} ${timePart}`;
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const dateObj = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    return dateObj.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTime(dateTimeStr) {
    if (!dateTimeStr) return '-';
    const parts = dateTimeStr.split(' ');
    if (parts.length < 2) return dateTimeStr;
    const timeParts = parts[1].split(':');
    let hours = parseInt(timeParts[0]);
    const minutes = timeParts[1];
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${hours}:${minutes} ${ampm}`;
}

function isSameUser(userId1, userId2) {
    if (!userId1 || !userId2) return false;
    return String(userId1).trim() === String(userId2).trim();
}

function isHrOrAdminUser(user = currentUser) {
    if (!user) return false;
    return user.role === 'HR' || user.role === 'Admin' || user.username === 'kedar_is' || user.email === 'lifehotelsupply@gmail.com';
}

function isAdminUser(user = currentUser) {
    if (!user) return false;
    return user.username === 'kedar_is' || user.email === 'lifehotelsupply@gmail.com' || user.role === 'Admin';
}

function isSameDate(date1, date2) {
    if (!date1 || !date2) return false;
    return String(date1).trim() === String(date2).trim();
}

function isRecordInMonthYear(dateStr, month, year) {
    if (!dateStr) return false;
    const parts = String(dateStr).trim().split('-');
    if (parts.length < 3) return false;
    const recYear = parseInt(parts[0], 10);
    const recMonth = parseInt(parts[1], 10);
    return recMonth === month && recYear === year;
}

function formatRemarks(remarks) {
    if (!remarks) return '-';
    const str = String(remarks).trim();
    if (!str) return '-';
    // Hide legacy system timestamp strings stored in remarks (e.g. "2026-01-22 06:33:25")
    if (/^\d{4}-\d{2}-\d{2}(\s+\d{2}:\d{2}(:\d{2})?)?$/.test(str)) {
        return '-';
    }
    return escapeHtml(str);
}

function getCurrentMonthYear() {
    const today = getTodayString(); // Chicago CT based "YYYY-MM-DD"
    const parts = today.split('-');
    if (parts.length >= 3) {
        return {
            year: parts[0],
            month: String(parseInt(parts[1], 10))
        };
    }
    const now = new Date();
    return {
        year: String(now.getFullYear()),
        month: String(now.getMonth() + 1)
    };
}

function initDefaultMonthYearFilters() {
    const current = getCurrentMonthYear();

    const myMonth = document.getElementById('myMonthFilter');
    const myYear = document.getElementById('myYearFilter');
    if (myMonth && !myMonth.dataset.userChanged) myMonth.value = current.month;
    if (myYear && !myYear.dataset.userChanged) myYear.value = current.year;

    const teamMonth = document.getElementById('teamMonthFilter');
    const teamYear = document.getElementById('teamYearFilter');
    if (teamMonth && !teamMonth.dataset.userChanged) teamMonth.value = current.month;
    if (teamYear && !teamYear.dataset.userChanged) teamYear.value = current.year;

    const payMonth = document.getElementById('payrollMonthFilter');
    const payYear = document.getElementById('payrollYearFilter');
    if (payMonth && !payMonth.dataset.userChanged) payMonth.value = current.month;
    if (payYear && !payYear.dataset.userChanged) payYear.value = current.year;
}

// Authentication Logic
function showLoginOverlay() {
    window.location.href = 'index.html';
}

function checkAuthSession() {
    const savedUser = localStorage.getItem('lhs_current_user');
    if (savedUser) {
        try {
            currentUser = JSON.parse(savedUser);
            onUserAuthenticated();
        } catch (e) {
            console.error('Error parsing saved session:', e);
            window.location.href = 'index.html';
        }
    } else {
        window.location.href = 'index.html';
    }
}

function fillPassword(val) {
    if (val) {
        document.getElementById('loginPassword').value = '123456';
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const usernameInput = document.getElementById('loginUsername').value.trim().toLowerCase();
    const passwordInput = document.getElementById('loginPassword').value.trim();
    const errEl = document.getElementById('loginError');

    if (errEl) {
        errEl.style.display = 'none';
        errEl.textContent = '';
    }

    if (!usernameInput) {
        if (errEl) {
            errEl.textContent = 'Please enter your email or username.';
            errEl.style.display = 'block';
        }
        return;
    }

    let user = null;
    const btn = document.querySelector('#authOverlay button');
    if (btn) {
        btn.textContent = 'Authenticating...';
        btn.disabled = true;
    }

    if (typeof firebaseDb !== 'undefined' && firebaseDb) {
        try {
            let snap = await firebaseDb.collection('users').where('username', '==', usernameInput).get();
            if (snap.empty) {
                snap = await firebaseDb.collection('users').where('email', '==', usernameInput).get();
            }
            if (!snap.empty) {
                user = snap.docs[0].data();
            }
        } catch (e) {
            console.error('Firestore login query failed:', e);
            user = appData.users.find(u =>
                (u.username && u.username.toLowerCase() === usernameInput) ||
                (u.email && u.email.toLowerCase() === usernameInput)
            );
        }
    } else {
        user = appData.users.find(u =>
            (u.username && u.username.toLowerCase() === usernameInput) ||
            (u.email && u.email.toLowerCase() === usernameInput)
        );
    }

    if (!user) {
        if (errEl) {
            errEl.textContent = 'Invalid email/username or account not found.';
            errEl.style.display = 'block';
        }
        if (btn) {
            btn.textContent = 'Login';
            btn.disabled = false;
        }
        return;
    }

    // Block ex-employees
    if (user.offboard_date) {
        if (errEl) {
            errEl.textContent = 'Access Denied: Offboarded ex-employees cannot log into the system.';
            errEl.style.display = 'block';
        }
        if (btn) {
            btn.textContent = 'Login';
            btn.disabled = false;
        }
        return;
    }

    // Password Validation
    const expectedPassword = user.password || '123456';
    if (passwordInput !== expectedPassword) {
        if (errEl) {
            errEl.textContent = 'Incorrect password. Please check your password and try again.';
            errEl.style.display = 'block';
        }
        if (btn) {
            btn.textContent = 'Login';
            btn.disabled = false;
        }
        return;
    }

    // Authenticated
    currentUser = user;
    localStorage.setItem('lhs_current_user', JSON.stringify(currentUser));

    // Invalidate cache and fetch the correct data scope for the newly logged-in user
    if (btn) {
        btn.textContent = 'Loading Data...';
    }
    await forceRefreshFromFirestore();
    if (btn) {
        btn.textContent = 'Login';
        btn.disabled = false;
    }

    onUserAuthenticated();
}

function handleLogout() {
    currentUser = null;
    localStorage.removeItem('lhs_current_user');
    localStorage.removeItem('lhs_cache_ts'); // Invalidate cache on logout
    appData.attendance = []; // Clear sensitive data from memory
    appData.salary_history = [];
    window.location.href = 'index.html';
}

function onUserAuthenticated() {
    const appEl = document.getElementById('app');
    if (appEl) appEl.style.display = 'flex';

    // Update User Badge in Sidebar
    const avatarEl = document.getElementById('userAvatar');
    const nameEl = document.getElementById('userName');
    const roleEl = document.getElementById('userRole');

    const isAdmin = isAdminUser(currentUser);
    const isHrOrAdmin = isHrOrAdminUser(currentUser);

    if (avatarEl && currentUser) avatarEl.textContent = currentUser.display_name.charAt(0).toUpperCase();
    if (nameEl && currentUser) nameEl.textContent = currentUser.display_name;
    if (roleEl && currentUser) roleEl.textContent = isAdmin ? 'Admin' : currentUser.role;

    // Toggle HR & Admin Visibility (Team Logs, Employee Roster, Salary & Payroll, Ex-Employees)
    const hrElements = document.querySelectorAll('.hr-only');
    hrElements.forEach(el => {
        el.style.display = isHrOrAdmin ? '' : 'none';
    });

    const adminElements = document.querySelectorAll('.admin-only');
    adminElements.forEach(el => {
        el.style.display = isAdmin ? '' : 'none';
    });

    // Initialize month/year filters to current Chicago CT date
    initDefaultMonthYearFilters();

    // Render Initial View
    switchView('dashboard');
}

// View Switcher
function switchView(viewName) {
    // Nav menu highlighting
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });

    const targetNav = Array.from(document.querySelectorAll('.nav-item')).find(el => el.getAttribute('onclick')?.includes(viewName));
    if (targetNav) targetNav.classList.add('active');

    // Section visibility
    document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
    const targetSection = document.getElementById(`view-${viewName}`);
    if (targetSection) targetSection.classList.add('active');

    // Title update
    const titleMap = {
        dashboard: 'Dashboard',
        myAttendance: 'My Attendance Log',
        teamAttendance: 'Team Attendance Logs',
        employees: 'Employee Roster',
        salaryPayroll: 'Salary & Payroll',
        exEmployees: 'Ex-Employees Archive',
        firebaseSetup: 'Firebase Connection Settings'
    };
    document.getElementById('pageTitle').textContent = titleMap[viewName] || 'Dashboard';

    // Render view contents
    if (viewName === 'dashboard') renderDashboard();
    if (viewName === 'myAttendance') renderMyAttendance();
    if (viewName === 'teamAttendance') renderTeamAttendance();
    if (viewName === 'employees') renderEmployeesRoster();
    if (viewName === 'salaryPayroll') renderSalaryPayroll();
    if (viewName === 'exEmployees') renderExEmployees();
    if (viewName === 'firebaseSetup') renderFirebaseSetup();
}

// VIEW 1: DASHBOARD
function renderDashboard() {
    if (!currentUser) return;
    const today = getTodayString();

    // Check today's punch for current user with robust matching
    const todayRecord = appData.attendance.find(a => isSameUser(a.user_id, currentUser.id) && isSameDate(a.date, today));

    const btnClockIn = document.getElementById('btnClockIn');
    const btnClockOut = document.getElementById('btnClockOut');
    const btnClockLegacy = document.getElementById('btnClockAction');
    const statusBadge = document.getElementById('clockStatusBadge');
    const todayTimes = document.getElementById('todayTimes');

    if (!todayRecord) {
        // State 1: Not Clocked In Yet Today
        if (statusBadge) {
            statusBadge.textContent = 'Status: Not Clocked In Today';
            statusBadge.className = 'clock-status-pill';
            statusBadge.style.color = '#e2e8f0';
        }
        if (btnClockIn) {
            btnClockIn.textContent = 'Clock In';
            btnClockIn.className = 'btn btn-primary btn-sm';
            btnClockIn.disabled = false;
        }
        if (btnClockOut) {
            btnClockOut.textContent = 'Clock Out';
            btnClockOut.className = 'btn btn-secondary btn-sm';
            btnClockOut.disabled = true;
        }
        if (btnClockLegacy) {
            btnClockLegacy.textContent = 'Clock In';
            btnClockLegacy.className = 'btn btn-primary';
            btnClockLegacy.disabled = false;
        }
        if (todayTimes) todayTimes.textContent = '';
    } else if (todayRecord && !todayRecord.logout_time) {
        // State 2: Clocked In (Shift in progress)
        if (statusBadge) {
            statusBadge.textContent = 'Status: Clocked In (Present)';
            statusBadge.className = 'clock-status-pill';
            statusBadge.style.color = 'var(--status-present)';
        }
        if (btnClockIn) {
            btnClockIn.textContent = 'Clocked In';
            btnClockIn.className = 'btn btn-secondary btn-sm';
            btnClockIn.disabled = true;
        }
        if (btnClockOut) {
            btnClockOut.textContent = 'Clock Out';
            btnClockOut.className = 'btn btn-danger btn-sm';
            btnClockOut.disabled = false;
        }
        if (btnClockLegacy) {
            btnClockLegacy.textContent = 'Clock Out';
            btnClockLegacy.className = 'btn btn-danger';
            btnClockLegacy.disabled = false;
        }
        if (todayTimes) todayTimes.textContent = `In: ${formatTime(todayRecord.login_time)}`;
    } else {
        // State 3: Shift Completed (Clocked Out)
        if (statusBadge) {
            statusBadge.textContent = 'Status: Clocked Out (Completed)';
            statusBadge.className = 'clock-status-pill';
            statusBadge.style.color = '#cbd5e1';
        }
        if (btnClockIn) {
            btnClockIn.textContent = 'Clocked In';
            btnClockIn.className = 'btn btn-secondary btn-sm';
            btnClockIn.disabled = true;
        }
        if (btnClockOut) {
            btnClockOut.textContent = 'Clocked Out';
            btnClockOut.className = 'btn btn-secondary btn-sm';
            btnClockOut.disabled = true;
        }
        if (btnClockLegacy) {
            btnClockLegacy.textContent = 'Shift Completed';
            btnClockLegacy.className = 'btn btn-secondary';
            btnClockLegacy.disabled = true;
        }
        if (todayTimes) todayTimes.textContent = `In: ${formatTime(todayRecord.login_time)} | Out: ${formatTime(todayRecord.logout_time)}`;
    }

    // Monthly stats for current user
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const monthlyRecords = appData.attendance.filter(a => {
        if (!isSameUser(a.user_id, currentUser.id)) return false;
        return isRecordInMonthYear(a.date, currentMonth, currentYear);
    });

    const presentCount = monthlyRecords.filter(a => a.status === 'Present').length;
    const absentCount = monthlyRecords.filter(a => a.status === 'Absent').length;
    const halfCount = monthlyRecords.filter(a => a.status === 'Half Day').length;

    document.getElementById('statPresent').textContent = presentCount;
    document.getElementById('statAbsent').textContent = absentCount;
    document.getElementById('statHalfDay').textContent = halfCount;

    // Calculate Estimated Net Pay using exact days in current month
    const totalDaysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    const baseSalObj = getLatestBaseSalary(currentUser.id, `${currentYear}-${String(currentMonth).padStart(2, '0')}-${totalDaysInMonth}`);
    const statNetPayEl = document.getElementById('statNetPay');
    if (statNetPayEl) {
        if (baseSalObj.isSet && baseSalObj.amount > 0) {
            const perDay = baseSalObj.amount / totalDaysInMonth;
            const deduction = (absentCount * perDay) + (halfCount * (perDay / 2));
            const netPay = Math.max(0, baseSalObj.amount - deduction);
            statNetPayEl.textContent = formatMoney(netPay, baseSalObj.currency);
        } else {
            statNetPayEl.textContent = 'Not Set';
        }
    }

    // Render Today's Team Table for HR & Admin
    if (isHrOrAdminUser()) {
        let activeUsers = appData.users.filter(u => !u.offboard_date);
        if (currentUser.username !== 'kedar_is') {
            activeUsers = activeUsers.filter(u => u.username !== 'kedar_is');
        }
        activeUsers.sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''));
        const tbody = document.getElementById('todayTeamTableBody');
        if (tbody) {
            tbody.innerHTML = activeUsers.map(u => {
                const rec = appData.attendance.find(a => isSameUser(a.user_id, u.id) && isSameDate(a.date, today));
                const status = rec ? rec.status : 'Absent';
                const inTime = rec && rec.login_time ? formatTime(rec.login_time) : '-';
                const outTime = rec && rec.logout_time ? formatTime(rec.logout_time) : '-';
                const badgeClass = status === 'Present' ? 'badge-present' : (status === 'Absent' ? 'badge-absent' : 'badge-halfday');

                return `
                    <tr>
                        <td><strong>${escapeHtml(u.display_name)}</strong></td>
                        <td><span class="user-role-tag">${u.role}</span></td>
                        <td>${inTime}</td>
                        <td>${outTime}</td>
                        <td><span class="badge ${badgeClass}">${status}</span></td>
                    </tr>
                `;
            }).join('');
        }
    }
}

// Ex-Employee Report Inclusion Helper
let currentDetailEmployee = null; // tracks which employee is in drill-down

function toggleEmployeeReportInclusion(userId) {
    const user = appData.users.find(u => String(u.id) === String(userId));
    if (!user) return;
    user.include_in_reports = !user.include_in_reports;
    saveDataStore();
    saveFirebaseDoc('users', String(user.id), user);
    renderExEmployees();
}

// Clock In Handler
async function handleClockIn() {
    if (!currentUser) return;
    const today = getTodayString();
    const nowStr = getDateTimeString();
    const remarksInput = document.getElementById('clockRemarks');
    const remarks = remarksInput ? remarksInput.value.trim() : '';

    const btnClockIn = document.getElementById('btnClockIn');
    if (btnClockIn) {
        btnClockIn.disabled = true;
        btnClockIn.textContent = 'Clocking In...';
    }

    let todayRecord = appData.attendance.find(a => isSameUser(a.user_id, currentUser.id) && isSameDate(a.date, today));
    if (todayRecord) {
        alert('You are already clocked in for today.');
        renderDashboard();
        return;
    }

    const newRecord = {
        id: String(Date.now()),
        user_id: String(currentUser.id).trim(),
        date: today,
        login_time: nowStr,
        logout_time: null,
        status: 'Present',
        remarks: remarks || 'Web Clock In',
        ip_address: 'Client Web'
    };

    appData.attendance.unshift(newRecord);
    saveDataStore();
    await saveFirebaseDoc('attendance', newRecord.id, newRecord);

    if (remarksInput) remarksInput.value = '';
    renderDashboard();
}

// Clock Out Handler
async function handleClockOut() {
    if (!currentUser) return;
    const today = getTodayString();
    const nowStr = getDateTimeString();
    const remarksInput = document.getElementById('clockRemarks');
    const remarks = remarksInput ? remarksInput.value.trim() : '';

    const btnClockOut = document.getElementById('btnClockOut');
    if (btnClockOut) {
        btnClockOut.disabled = true;
        btnClockOut.textContent = 'Clocking Out...';
    }

    let todayRecord = appData.attendance.find(a => isSameUser(a.user_id, currentUser.id) && isSameDate(a.date, today));
    if (!todayRecord) {
        alert('Please clock in before clocking out.');
        renderDashboard();
        return;
    }
    if (todayRecord.logout_time) {
        alert('You have already clocked out for today.');
        renderDashboard();
        return;
    }

    todayRecord.logout_time = nowStr;
    if (remarks) todayRecord.remarks = (todayRecord.remarks ? todayRecord.remarks + ' | ' : '') + remarks;

    saveDataStore();
    await saveFirebaseDoc('attendance', todayRecord.id, todayRecord);

    if (remarksInput) remarksInput.value = '';
    renderDashboard();
}

// Clock Action Handler (Legacy / Fallback)
async function toggleClockAction() {
    const today = getTodayString();
    const todayRecord = appData.attendance.find(a => isSameUser(a.user_id, currentUser.id) && isSameDate(a.date, today));
    if (!todayRecord) {
        await handleClockIn();
    } else if (!todayRecord.logout_time) {
        await handleClockOut();
    } else {
        alert('You have already clocked in and out for today.');
    }
}

async function ensureMonthDataLoaded(month, year, userId = null) {
    if (typeof firebaseDb === 'undefined' || !firebaseDb) return;
    const existing = appData.attendance.filter(a => {
        if (userId && !isSameUser(a.user_id, userId)) return false;
        return isRecordInMonthYear(a.date, month, year);
    });
    if (existing.length > 0) return;

    try {
        const monthStr = String(month).padStart(2, '0');
        const startStr = `${year}-${monthStr}-01`;
        const endStr = `${year}-${monthStr}-31`;

        let query = firebaseDb.collection('attendance')
            .where('date', '>=', startStr)
            .where('date', '<=', endStr);

        if (userId) {
            query = query.where('user_id', '==', String(userId));
        }

        const snap = await query.get();
        if (!snap.empty) {
            const fetched = snap.docs.map(doc => doc.data());
            fetched.forEach(f => {
                if (!appData.attendance.some(e => e.id === f.id)) {
                    appData.attendance.push(f);
                }
            });
            saveDataStore();
        }
    } catch (err) {
        console.warn('Month data load note:', err);
    }
}

// VIEW 2: MY ATTENDANCE HISTORY
async function renderMyAttendance() {
    if (!currentUser) return;

    const monthEl = document.getElementById('myMonthFilter');
    const yearEl = document.getElementById('myYearFilter');
    const current = getCurrentMonthYear();

    if (monthEl && (!monthEl.value || !monthEl.dataset.initialized)) {
        monthEl.value = current.month;
        monthEl.dataset.initialized = 'true';
    }
    if (yearEl && (!yearEl.value || !yearEl.dataset.initialized)) {
        yearEl.value = current.year;
        yearEl.dataset.initialized = 'true';
    }

    const month = parseInt(monthEl ? monthEl.value : current.month);
    const year = parseInt(yearEl ? yearEl.value : current.year);

    // On-Demand fetch from Firestore if records for this selected month are not in local memory yet
    await ensureMonthDataLoaded(month, year, currentUser.id);

    const existingRecords = appData.attendance.filter(a => {
        if (!isSameUser(a.user_id, currentUser.id)) return false;
        return isRecordInMonthYear(a.date, month, year);
    });

    const records = existingRecords.sort((a, b) => new Date(b.date) - new Date(a.date));

    const tbody = document.getElementById('myAttendanceTableBody');
    if (records.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No attendance records found for this month.</td></tr>`;
        return;
    }

    tbody.innerHTML = records.map(r => {
        const badgeClass = r.status === 'Present' ? 'badge-present' : (r.status === 'Absent' ? 'badge-absent' : 'badge-halfday');
        return `
            <tr>
                <td><strong>${formatDate(r.date)}</strong></td>
                <td>${formatTime(r.login_time)}</td>
                <td>${formatTime(r.logout_time)}</td>
                <td><span class="badge ${badgeClass}">${r.status}</span></td>
                <td>${formatRemarks(r.remarks)}</td>
            </tr>
        `;
    }).join('');
}

// VIEW 3: TEAM ATTENDANCE (HR)
async function renderTeamAttendance() {
    if (!isHrOrAdminUser()) return;

    const monthEl = document.getElementById('teamMonthFilter');
    const yearEl = document.getElementById('teamYearFilter');
    const current = getCurrentMonthYear();

    if (monthEl && (!monthEl.value || !monthEl.dataset.initialized)) {
        monthEl.value = current.month;
        monthEl.dataset.initialized = 'true';
    }
    if (yearEl && (!yearEl.value || !yearEl.dataset.initialized)) {
        yearEl.value = current.year;
        yearEl.dataset.initialized = 'true';
    }

    const month = parseInt(monthEl ? monthEl.value : current.month);
    const year = parseInt(yearEl ? yearEl.value : current.year);

    await ensureMonthDataLoaded(month, year);

    // Build allowed users list (Active OR explicitly included Ex-Employees)
    let allowedUsers = appData.users.filter(u => !u.offboard_date || u.include_in_reports);
    if (currentUser.username !== 'kedar_is') {
        allowedUsers = allowedUsers.filter(u => u.username !== 'kedar_is');
    }
    allowedUsers.sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''));

    // Render Summary Panel
    document.getElementById('teamSummaryPanel').style.display = 'block';
    document.getElementById('teamDetailPanel').style.display = 'none';

    const monthName = new Date(year, month - 1, 1).toLocaleString('default', { month: 'long' });
    const summaryTbody = document.getElementById('teamSummaryTableBody');

    if (allowedUsers.length === 0) {
        summaryTbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No employees found.</td></tr>`;
        return;
    }

    summaryTbody.innerHTML = allowedUsers.map(u => {
        const userRecords = appData.attendance.filter(a => {
            if (!isSameUser(a.user_id, u.id)) return false;
            return isRecordInMonthYear(a.date, month, year);
        });
        const present = userRecords.filter(a => a.status === 'Present').length;
        const absent = userRecords.filter(a => a.status === 'Absent').length;
        const halfDay = userRecords.filter(a => a.status === 'Half Day').length;
        const total = userRecords.length;
        const exTag = u.offboard_date ? '<span style="color:#ef4444; font-size:0.75rem; margin-left:4px;">(Ex)</span>' : '';

        return `
            <tr style="cursor:pointer;" onclick="drillDownEmployee('${u.id}', '${escapeHtml(u.display_name)}')">
                <td><strong style="color:var(--primary);">${escapeHtml(u.display_name)}</strong>${exTag}</td>
                <td><span class="badge badge-present">${present} P</span></td>
                <td><span class="badge badge-absent">${absent} A</span></td>
                <td><span class="badge badge-halfday">${halfDay} H</span></td>
                <td style="color:var(--text-muted);">${total} days</td>
            </tr>
        `;
    }).join('');
}

function drillDownEmployee(userId, displayName) {
    const month = parseInt(document.getElementById('teamMonthFilter').value);
    const year = parseInt(document.getElementById('teamYearFilter').value);
    const monthName = new Date(year, month - 1, 1).toLocaleString('default', { month: 'long' });

    currentDetailEmployee = { id: userId, name: displayName };

    document.getElementById('teamSummaryPanel').style.display = 'none';
    document.getElementById('teamDetailPanel').style.display = 'block';
    document.getElementById('teamDetailTitle').textContent = `${displayName} — ${monthName} ${year}`;

    const records = appData.attendance.filter(a => {
        if (!isSameUser(a.user_id, userId)) return false;
        return isRecordInMonthYear(a.date, month, year);
    }).sort((a, b) => new Date(b.date) - new Date(a.date));

    const tbody = document.getElementById('teamAttendanceTableBody');
    if (records.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">No records found for this month.</td></tr>`;
        return;
    }

    tbody.innerHTML = records.map(r => {
        const badgeClass = r.status === 'Present' ? 'badge-present' : (r.status === 'Absent' ? 'badge-absent' : 'badge-halfday');
        return `
            <tr>
                <td><strong>${formatDate(r.date)}</strong></td>
                <td>${formatTime(r.login_time)}</td>
                <td>${formatTime(r.logout_time)}</td>
                <td><span class="badge ${badgeClass}">${r.status}</span></td>
                <td>${formatRemarks(r.remarks)}</td>
                <td>
                    <button class="btn btn-secondary btn-sm" onclick="editAttendanceModal('${r.id}')">Edit</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteAttendanceRecord('${r.id}')">Delete</button>
                </td>
            </tr>
        `;
    }).join('');
}

function backToTeamSummary() {
    currentDetailEmployee = null;
    document.getElementById('teamSummaryPanel').style.display = 'block';
    document.getElementById('teamDetailPanel').style.display = 'none';
    renderTeamAttendance();
}

function renderEmployeesRoster() {
    if (!isHrOrAdminUser()) return;

    let activeUsers = appData.users.filter(u => !u.offboard_date);
    if (currentUser.username !== 'kedar_is') {
        activeUsers = activeUsers.filter(u => u.username !== 'kedar_is');
    }
    activeUsers.sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''));

    const tbody = document.getElementById('employeesTableBody');

    tbody.innerHTML = activeUsers.map(u => {
        const passDisplay = u.password || '123456';
        return `
            <tr>
                <td><strong>${escapeHtml(u.display_name)}</strong></td>
                <td><code>${escapeHtml(u.username)}</code></td>
                <td>${escapeHtml(u.email)}</td>
                <td><span class="user-role-tag">${u.role}</span></td>
                <td>
                    <div style="display: flex; gap: 0.5rem;">
                        <button class="btn btn-secondary btn-sm" onclick="resetEmployeePassword('${u.id}')" title="Current Password: ${escapeHtml(passDisplay)}">Reset Password</button>
                        <button class="btn btn-danger btn-sm" onclick="offboardEmployee('${u.id}')">Offboard</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function openAddEmployeeModal() {
    document.getElementById('employeeForm').reset();
    document.getElementById('empPassword').value = '123456';
    openModal('employeeModal');
}

function saveEmployee(e) {
    e.preventDefault();
    const name = document.getElementById('empName').value.trim();
    const username = document.getElementById('empUsername').value.trim().toLowerCase();
    const email = document.getElementById('empEmail').value.trim().toLowerCase();
    const role = document.getElementById('empRole').value;
    const password = document.getElementById('empPassword').value.trim() || '123456';

    const existingUser = appData.users.find(u =>
        (u.username && u.username.toLowerCase() === username) ||
        (u.email && u.email.toLowerCase() === email)
    );
    if (existingUser) {
        alert('An account with this username or email already exists.');
        return;
    }

    const newEmp = {
        id: String(Date.now()),
        display_name: name,
        username: username,
        email: email,
        role: role,
        password: password,
        offboard_date: null
    };

    appData.users.push(newEmp);
    saveDataStore();
    saveFirebaseDoc('users', String(newEmp.id), newEmp);
    closeModal('employeeModal');
    renderEmployeesRoster();
    alert(`Employee ${name} added successfully!\nUsername: ${username}\nDefault Password: ${password}`);
}

function resetEmployeePassword(id) {
    const user = appData.users.find(u => isSameUser(u.id, id));
    if (!user) return;
    const currentPass = user.password || '123456';
    const newPass = prompt(`Reset password for ${user.display_name}:\n\nCurrent Password: ${currentPass}\n\nEnter new password:`, currentPass);
    if (newPass && newPass.trim()) {
        user.password = newPass.trim();
        saveDataStore();
        saveFirebaseDoc('users', String(user.id), user);
        renderEmployeesRoster();
        alert(`Password for ${user.display_name} updated successfully to: ${user.password}`);
    }
}

function offboardEmployee(id) {
    const user = appData.users.find(u => isSameUser(u.id, id));
    if (!user) return;
    const defaultDate = getTodayString();
    const exitDate = prompt(`Offboard ${user.display_name}:\nPlease enter offboarding exit date (YYYY-MM-DD):`, defaultDate);
    if (exitDate && exitDate.trim()) {
        user.offboard_date = exitDate.trim();
        saveDataStore();
        saveFirebaseDoc('users', String(user.id), user);
        renderEmployeesRoster();
        alert(`${user.display_name} has been offboarded with exit date: ${user.offboard_date}`);
    }
}

function rehireEmployee(id) {
    const user = appData.users.find(u => String(u.id) === String(id));
    if (!user) return;
    user.offboard_date = null;
    saveDataStore();
    saveFirebaseDoc('users', String(user.id), user);
    renderEmployeesRoster();
    renderExEmployees();
}

// VIEW 5: SALARY & PAYROLL (HR & ADMIN)
function renderSalaryPayroll() {
    if (!isHrOrAdminUser()) {
        switchView('dashboard');
        return;
    }
    renderPayrollMonthlyTab();
    renderSalaryRatesTab();
    populateCalcUserDropdown();
}

function switchSalarySubTab(tab) {
    document.getElementById('salarySubTabMonthly').style.display = tab === 'monthly' ? 'block' : 'none';
    document.getElementById('salarySubTabRates').style.display = tab === 'rates' ? 'block' : 'none';
    document.getElementById('salarySubTabCalc').style.display = tab === 'calc' ? 'block' : 'none';

    document.getElementById('tabSalaryMonthlyBtn').className = tab === 'monthly' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
    document.getElementById('tabSalaryRatesBtn').className = tab === 'rates' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
    document.getElementById('tabSalaryCalcBtn').className = tab === 'calc' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
}

async function renderPayrollMonthlyTab() {
    const monthEl = document.getElementById('payrollMonthFilter');
    const yearEl = document.getElementById('payrollYearFilter');
    const current = getCurrentMonthYear();

    if (monthEl && (!monthEl.value || !monthEl.dataset.initialized)) {
        monthEl.value = current.month;
        monthEl.dataset.initialized = 'true';
    }
    if (yearEl && (!yearEl.value || !yearEl.dataset.initialized)) {
        yearEl.value = current.year;
        yearEl.dataset.initialized = 'true';
    }

    const month = parseInt(monthEl ? monthEl.value : current.month);
    const year = parseInt(yearEl ? yearEl.value : current.year);
    const totalDays = new Date(year, month, 0).getDate();
    const eomDate = `${year}-${String(month).padStart(2, '0')}-${totalDays}`;

    await ensureMonthDataLoaded(month, year);

    let users = appData.users.filter(u => !u.offboard_date || u.include_in_reports);
    if (currentUser.username !== 'kedar_is') {
        users = users.filter(u => u.username !== 'kedar_is');
    }
    users.sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''));

    const tbody = document.getElementById('payrollTableBody');
    tbody.innerHTML = users.map(u => {
        const baseObj = getLatestBaseSalary(u.id, eomDate);
        const stats = getMonthlyCounts(u.id, month, year);

        let baseDisplay = `<span style="color:var(--text-muted); font-style:italic;">Not Set</span>`;
        let deductionDisplay = `<span style="color:var(--text-muted);">-</span>`;
        let netPayableDisplay = `<span style="color:var(--text-muted); font-style:italic;">Not Set</span>`;

        if (baseObj.isSet && baseObj.amount > 0) {
            const perDay = baseObj.amount / totalDays; // Dynamic divisor: exact number of days in this month
            const deduction = (stats.absent * perDay) + (stats.halfDay * (perDay / 2));
            const netPayable = Math.max(0, baseObj.amount - deduction);

            baseDisplay = formatMoney(baseObj.amount, baseObj.currency);
            deductionDisplay = `<span style="color:#ef4444;">-${formatMoney(deduction, baseObj.currency)}</span>`;
            netPayableDisplay = `<strong>${formatMoney(netPayable, baseObj.currency)}</strong>`;
        }

        return `
            <tr>
                <td><strong>${escapeHtml(u.display_name)}</strong> ${u.offboard_date ? '<span style="color:#ef4444; font-size:0.75rem;">(Ex)</span>' : ''}</td>
                <td>${baseDisplay}</td>
                <td>
                    <span style="color:var(--status-present); font-weight:600;">${stats.present} P</span> / 
                    <span style="color:var(--status-absent); font-weight:600;">${stats.absent} A</span> / 
                    <span style="color:var(--status-halfday); font-weight:600;">${stats.halfDay} H</span>
                </td>
                <td>${deductionDisplay}</td>
                <td>${netPayableDisplay}</td>
                <td>
                    <button class="btn btn-secondary btn-sm" onclick="showPayslipModal('${u.id}', ${month}, ${year})">View Slip</button>
                </td>
            </tr>
        `;
    }).join('');
}

function renderSalaryRatesTab() {
    const tbody = document.getElementById('salaryRatesTableBody');
    let sortedSalaries = [...appData.salary_history].sort((a, b) => new Date(b.effective_date) - new Date(a.effective_date));

    sortedSalaries = sortedSalaries.filter(s => {
        const user = appData.users.find(u => String(u.id) === String(s.user_id));
        if (currentUser.username !== 'kedar_is' && user && user.username === 'kedar_is') return false;
        if (user && user.offboard_date && !user.include_in_reports) return false;
        return true;
    });

    tbody.innerHTML = sortedSalaries.map(s => {
        const user = appData.users.find(u => String(u.id) === String(s.user_id));
        return `
            <tr>
                <td><strong>${escapeHtml(user ? user.display_name : `User ${s.user_id}`)}</strong> ${user && user.offboard_date ? '<span style="color:#ef4444; font-size:0.75rem;">(Ex)</span>' : ''}</td>
                <td>${formatMoney(s.amount, s.currency || 'INR')}</td>
                <td><span class="user-role-tag">${s.currency || 'INR'}</span></td>
                <td>${formatDate(s.effective_date)}</td>
                <td>
                    <button class="btn btn-danger btn-sm" onclick="deleteSalaryRate('${s.id}')">Delete</button>
                </td>
            </tr>
        `;
    }).join('');
}

function populateCalcUserDropdown() {
    const select = document.getElementById('calcEmployeeSelect');
    if (select) {
        let list = appData.users.filter(u => !u.offboard_date);
        if (currentUser.username !== 'kedar_is') {
            list = list.filter(u => u.username !== 'kedar_is');
        }
        select.innerHTML = `<option value="">-- Choose Employee --</option>` + list.map(u => `<option value="${u.id}">${escapeHtml(u.display_name)}</option>`).join('');
    }
}

function calculateQuickPay() {
    const userId = document.getElementById('calcEmployeeSelect').value;
    let base = parseFloat(document.getElementById('calcBaseSalary').value) || 0;
    let currency = 'INR';

    if (userId) {
        const today = getTodayString();
        const baseObj = getLatestBaseSalary(userId, today);
        if (!document.getElementById('calcBaseSalary').dataset.userSet) {
            base = baseObj.amount;
            document.getElementById('calcBaseSalary').value = base;
        }
        currency = baseObj.currency;
    }

    const absent = parseFloat(document.getElementById('calcAbsentDays').value) || 0;
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    const totalDaysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    const perDay = base / totalDaysInMonth;
    const deduction = absent * perDay;
    const net = Math.max(0, base - deduction);

    document.getElementById('calcPerDay').textContent = formatMoney(perDay, currency);
    document.getElementById('calcDeduction').textContent = `-${formatMoney(deduction, currency)}`;
    document.getElementById('calcNetPay').textContent = formatMoney(net, currency);
}

// VIEW 6: EX-EMPLOYEES ARCHIVE (HR & ADMIN)
function renderExEmployees() {
    if (!isHrOrAdminUser()) return;

    // Reverse chronological order (latest exit date first)
    const offboardedUsers = appData.users
        .filter(u => !!u.offboard_date)
        .sort((a, b) => new Date(b.offboard_date) - new Date(a.offboard_date));

    const tbody = document.getElementById('exEmployeesTableBody');

    if (offboardedUsers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No offboarded employees recorded.</td></tr>`;
        return;
    }

    tbody.innerHTML = offboardedUsers.map(u => {
        const isIncluded = !!u.include_in_reports;
        const toggleBtnClass = isIncluded ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
        const toggleText = isIncluded ? '✓ Included in Reports' : '✕ Excluded from Reports';

        return `
            <tr>
                <td><strong>${escapeHtml(u.display_name)}</strong></td>
                <td>${escapeHtml(u.email)}</td>
                <td><span style="color:#ef4444; font-weight:600;">${formatDate(u.offboard_date)}</span></td>
                <td>
                    <button class="${toggleBtnClass}" onclick="toggleEmployeeReportInclusion('${u.id}')">${toggleText}</button>
                </td>
                <td>
                    <button class="btn btn-secondary btn-sm" onclick="rehireEmployee('${u.id}')">Rehire</button>
                </td>
            </tr>
        `;
    }).join('');
}

// VIEW 7: FIREBASE SETUP (ADMIN ONLY)
function renderFirebaseSetup() {
    if (!isAdminUser(currentUser)) {
        switchView('dashboard');
        return;
    }
    const config = FirebaseManager.getConfig();
    document.getElementById('fbApiKey').value = config.apiKey || '';
    document.getElementById('fbAuthDomain').value = config.authDomain || '';
    document.getElementById('fbProjectId').value = config.projectId || '';
    document.getElementById('fbStorageBucket').value = config.storageBucket || '';
    document.getElementById('fbAppId').value = config.appId || '';
}

function saveFirebaseConfigHandler(e) {
    e.preventDefault();
    const config = {
        apiKey: document.getElementById('fbApiKey').value.trim(),
        authDomain: document.getElementById('fbAuthDomain').value.trim(),
        projectId: document.getElementById('fbProjectId').value.trim(),
        storageBucket: document.getElementById('fbStorageBucket').value.trim(),
        appId: document.getElementById('fbAppId').value.trim()
    };
    FirebaseManager.saveConfig(config);
    alert('Firebase configuration saved successfully!');
    FirebaseManager.init();
}

async function seedFirebaseDatabase() {
    const allowedSeeders = ['kedar_is', 'kcalpesh'];
    if (!currentUser || !allowedSeeders.includes(currentUser.username)) {
        alert('Access Denied: Only Admin (Vaibhav & Kalpesh) have permission to seed the database.');
        return;
    }
    if (!FirebaseManager.isConnected()) {
        alert('Please enter a valid Firebase API Key above and save config first.');
        return;
    }
    try {
        const db = FirebaseManager.getDb();
        alert('Starting upload of restored data to Firestore... Please wait.');

        // Seed Users
        for (const user of appData.users) {
            await db.collection('users').doc(String(user.id)).set(user, { merge: true });
        }

        // Seed Attendance (in batches)
        const batchSize = 100;
        for (let i = 0; i < appData.attendance.length; i += batchSize) {
            const batch = db.batch();
            const chunk = appData.attendance.slice(i, i + batchSize);
            chunk.forEach(att => {
                const ref = db.collection('attendance').doc(String(att.id));
                batch.set(ref, att, { merge: true });
            });
            await batch.commit();
        }

        // Seed Salary History
        for (const sal of appData.salary_history) {
            await db.collection('salary_history').doc(String(sal.id)).set(sal, { merge: true });
        }

        alert('Restored data (760 attendance entries + 9 salary logs) uploaded to Firebase Firestore successfully!');
    } catch (err) {
        console.error('Firebase seeding failed:', err);
        alert('Seeding failed: ' + err.message);
    }
}

// MODAL CONTROLLERS & ACTIONS
function openAddAttendanceModal() {
    document.getElementById('attEditId').value = '';
    document.getElementById('attModalTitle').textContent = 'Add Attendance Record';

    // Show employee + date fields for new records
    document.getElementById('attUserGroup').style.display = 'block';
    document.getElementById('attDateGroup').style.display = 'block';

    const select = document.getElementById('attUserSelect');
    let activeUsers = appData.users.filter(u => !u.offboard_date);
    if (currentUser.username !== 'kedar_is') {
        activeUsers = activeUsers.filter(u => u.username !== 'kedar_is');
    }
    select.innerHTML = `<option value="">-- Choose Employee --</option>` + activeUsers.map(u => `<option value="${u.id}">${escapeHtml(u.display_name)}</option>`).join('');
    select.value = '';

    document.getElementById('attDate').value = getTodayString();
    document.getElementById('attStatus').value = 'Present';
    document.getElementById('attInTime').value = '09:00';
    document.getElementById('attOutTime').value = '18:00';
    document.getElementById('attRemarksInput').value = '';

    openModal('attendanceModal');
}

function editAttendanceModal(id) {
    const record = appData.attendance.find(a => String(a.id) === String(id));
    if (!record) return;

    document.getElementById('attEditId').value = record.id;
    document.getElementById('attModalTitle').textContent = 'Edit Attendance Record';

    // Hide employee + date — obvious from context
    document.getElementById('attUserGroup').style.display = 'none';
    document.getElementById('attDateGroup').style.display = 'none';

    // Still set the values so they submit correctly
    const select = document.getElementById('attUserSelect');
    select.innerHTML = appData.users.map(u => `<option value="${u.id}">${escapeHtml(u.display_name)}</option>`).join('');
    select.value = record.user_id;
    document.getElementById('attDate').value = record.date;

    document.getElementById('attStatus').value = record.status;
    document.getElementById('attInTime').value = record.login_time ? record.login_time.split(' ')[1]?.substring(0, 5) || '' : '';
    document.getElementById('attOutTime').value = record.logout_time ? record.logout_time.split(' ')[1]?.substring(0, 5) || '' : '';
    document.getElementById('attRemarksInput').value = record.remarks || '';

    openModal('attendanceModal');
}

function saveAttendanceRecord(e) {
    e.preventDefault();
    const editId = document.getElementById('attEditId').value;
    const userId = document.getElementById('attUserSelect').value;
    const date = document.getElementById('attDate').value;
    const status = document.getElementById('attStatus').value;
    const inTimeVal = document.getElementById('attInTime').value;
    const outTimeVal = document.getElementById('attOutTime').value;
    const remarks = document.getElementById('attRemarksInput').value;

    if (!userId) {
        alert('Please choose an employee from the dropdown list.');
        return;
    }
    if (!date) {
        alert('Please select a valid date.');
        return;
    }

    // Check for duplicate attendance record when adding a new entry
    if (!editId) {
        const existingRecord = appData.attendance.find(a => isSameUser(a.user_id, userId) && isSameDate(a.date, date));
        if (existingRecord) {
            const userObj = appData.users.find(u => isSameUser(u.id, userId));
            const empName = userObj ? userObj.display_name : 'this employee';

            const shouldEdit = confirm(
                `An attendance record already exists for ${empName} on ${formatDate(date)}.\n\n` +
                `Would you like to EDIT the existing record instead of creating a duplicate?`
            );

            if (shouldEdit) {
                closeModal('attendanceModal');
                editAttendanceModal(existingRecord.id);
            }
            return;
        }
    }

    const loginTime = inTimeVal ? `${date} ${inTimeVal}:00` : null;
    const logoutTime = outTimeVal ? `${date} ${outTimeVal}:00` : null;

    let recordToSave;

    if (editId) {
        // --- EDIT existing record ---
        recordToSave = appData.attendance.find(a => String(a.id) === String(editId));
        if (recordToSave) {
            recordToSave.user_id = userId;
            recordToSave.date = date;
            recordToSave.status = status;
            recordToSave.login_time = loginTime;
            recordToSave.logout_time = logoutTime;
            recordToSave.remarks = remarks;
        }
    } else {
        // --- ADD new record ---
        recordToSave = {
            id: String(Date.now()),
            user_id: userId,
            date: date,
            status: status,
            login_time: loginTime,
            logout_time: logoutTime,
            remarks: remarks,
            ip_address: 'Admin Manual'
        };
        appData.attendance.unshift(recordToSave);
    }

    // Save locally + push to Firebase
    saveDataStore();
    if (recordToSave) {
        saveFirebaseDoc('attendance', String(recordToSave.id), recordToSave);
    }

    closeModal('attendanceModal');

    // Refresh the right panel — stay in drill-down if active
    if (currentDetailEmployee) {
        drillDownEmployee(currentDetailEmployee.id, currentDetailEmployee.name);
    } else {
        renderTeamAttendance();
    }
}

function deleteAttendanceRecord(id) {
    if (!confirm('Are you sure you want to delete this attendance record?')) return;
    appData.attendance = appData.attendance.filter(a => String(a.id) !== String(id));
    saveDataStore();
    deleteFirebaseDoc('attendance', id);
    // If we're in a drill-down detail view, stay there
    if (currentDetailEmployee) {
        drillDownEmployee(currentDetailEmployee.id, currentDetailEmployee.name);
    } else {
        renderTeamAttendance();
    }
}

function openAddSalaryModal() {
    const select = document.getElementById('salUserSelect');
    let activeUsers = appData.users.filter(u => !u.offboard_date);
    if (currentUser.username !== 'kedar_is') {
        activeUsers = activeUsers.filter(u => u.username !== 'kedar_is');
    }
    select.innerHTML = activeUsers.map(u => `<option value="${u.id}">${escapeHtml(u.display_name)}</option>`).join('');

    document.getElementById('salAmount').value = '30000';
    document.getElementById('salCurrency').value = 'INR';
    document.getElementById('salDate').value = getTodayString();

    openModal('salaryModal');
}

function saveSalaryRate(e) {
    e.preventDefault();
    const userId = document.getElementById('salUserSelect').value;
    const amount = parseFloat(document.getElementById('salAmount').value);
    const currency = document.getElementById('salCurrency').value;
    const effectiveDate = document.getElementById('salDate').value;

    if (!userId) {
        alert('Please select an employee.');
        return;
    }
    if (isNaN(amount) || amount <= 0) {
        alert('Please enter a valid salary amount.');
        return;
    }
    if (!effectiveDate) {
        alert('Please select an effective date.');
        return;
    }

    const newSal = {
        id: String(Date.now()),
        user_id: String(userId).trim(),
        amount: amount,
        currency: currency,
        effective_date: effectiveDate,
        updated_at: getDateTimeString()
    };

    appData.salary_history.unshift(newSal);
    saveDataStore();
    saveFirebaseDoc('salary_history', newSal.id, newSal);
    closeModal('salaryModal');
    renderSalaryPayroll();
}

function deleteSalaryRate(id) {
    if (!confirm('Delete this salary rate record?')) return;
    appData.salary_history = appData.salary_history.filter(s => String(s.id) !== String(id));
    saveDataStore();
    deleteFirebaseDoc('salary_history', id);
    renderSalaryPayroll();
}

function formatMoney(amount, currency = 'INR') {
    const symbols = { INR: '₹', USD: '$', PHP: '₱', ETB: 'Br ', NGN: '₦' };
    const sym = symbols[currency] || (currency ? currency + ' ' : '');
    const val = parseFloat(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${sym}${val}`;
}

async function showPayslipModal(userId, month, year) {
    const user = appData.users.find(u => isSameUser(u.id, userId));
    if (!user) return;

    await ensureMonthDataLoaded(month, year, userId);

    const totalDays = new Date(year, month, 0).getDate();
    const eomDate = `${year}-${String(month).padStart(2, '0')}-${totalDays}`;
    const baseObj = getLatestBaseSalary(userId, eomDate);
    const stats = getMonthlyCounts(userId, month, year);

    const perDay = baseObj.isSet && baseObj.amount > 0 ? baseObj.amount / totalDays : 0;
    const deduction = (stats.absent * perDay) + (stats.halfDay * (perDay / 2));
    const netPayable = Math.max(0, baseObj.amount - deduction);

    const monthName = new Date(year, month - 1, 1).toLocaleString('default', { month: 'long' });

    const baseRateDisplay = baseObj.isSet && baseObj.amount > 0
        ? formatMoney(baseObj.amount, baseObj.currency)
        : '<span style="color:var(--text-muted); font-style:italic;">Not Set (Set in Base Salary Rates tab)</span>';

    const netPayDisplay = baseObj.isSet && baseObj.amount > 0
        ? formatMoney(netPayable, baseObj.currency)
        : '<span style="color:var(--text-muted); font-style:italic;">Not Set</span>';

    const content = `
        <div style="text-align: center; margin-bottom: 1.5rem; border-bottom: 2px solid var(--primary); padding-bottom: 1rem;">
            <img src="logo.jpg" style="height: 50px; margin-bottom: 0.5rem;" alt="Logo">
            <h2></h2>
            <p style="color: var(--text-muted); font-size: 0.85rem;">Payslip Statement - ${monthName} ${year}</p>
        </div>

        <div style="display: flex; justify-content: space-between; margin-bottom: 1.25rem; font-size: 0.9rem;">
            <div>
                <strong>Employee Name:</strong> ${escapeHtml(user.display_name)}<br>
                <strong>Role:</strong> ${user.role}<br>
                <strong>Email:</strong> ${escapeHtml(user.email)}
            </div>
            <div style="text-align: right;">
                <strong>Statement Period:</strong> ${monthName} ${year}<br>
                <strong>Generated Date:</strong> ${getTodayString()}<br>
                <strong>Currency:</strong> ${baseObj.currency}<br>
                <strong>Standard Divisor:</strong> ${totalDays} Days (${monthName})
            </div>
        </div>

        <table class="data-table" style="margin-bottom: 1.25rem;">
            <thead>
                <tr>
                    <th>Description</th>
                    <th style="text-align: right;">Amount</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>Base Monthly Salary Rate</td>
                    <td style="text-align: right;">${baseRateDisplay}</td>
                </tr>
                <tr>
                    <td>Days Present (${stats.present} Days)</td>
                    <td style="text-align: right; color: var(--status-present);">Verified</td>
                </tr>
                <tr>
                    <td>Absent Deductions (${stats.absent} Full + ${stats.halfDay} Half Days)</td>
                    <td style="text-align: right; color: #ef4444;">${baseObj.isSet && baseObj.amount > 0 ? `-${formatMoney(deduction, baseObj.currency)}` : '-'}</td>
                </tr>
                <tr style="font-weight: 700; background: #f8fafc;">
                    <td>NET PAYABLE SALARY</td>
                    <td style="text-align: right; color: var(--primary); font-size: 1.1rem;">${netPayDisplay}</td>
                </tr>
            </tbody>
        </table>
    `;

    document.getElementById('payslipContent').innerHTML = content;
    openModal('payslipModal');
}

// Helpers
function parseSalaryAmount(val) {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    const str = String(val);
    const matches = str.match(/[\d,]+(?:\.\d+)?/g);
    if (matches && matches.length > 0) {
        const lastMatch = matches[matches.length - 1].replace(/,/g, '');
        const num = parseFloat(lastMatch);
        if (!isNaN(num)) return num;
    }
    return parseFloat(str) || 0;
}

function getLatestBaseSalary(userId, dateStr) {
    const userSalaries = appData.salary_history.filter(s => isSameUser(s.user_id, userId) && s.effective_date <= dateStr)
        .sort((a, b) => new Date(b.effective_date) - new Date(a.effective_date));

    if (userSalaries.length > 0) {
        return {
            amount: parseSalaryAmount(userSalaries[0].amount),
            currency: userSalaries[0].currency || 'INR',
            isSet: true
        };
    }
    return { amount: 0, currency: 'INR', isSet: false };
}

function getMonthlyCounts(userId, month, year) {
    const records = appData.attendance.filter(a => {
        if (!isSameUser(a.user_id, userId)) return false;
        return isRecordInMonthYear(a.date, month, year);
    });

    return {
        present: records.filter(a => a.status === 'Present').length,
        absent: records.filter(a => a.status === 'Absent').length,
        halfDay: records.filter(a => a.status === 'Half Day').length
    };
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatTime(dateTimeStr) {
    if (!dateTimeStr) return '-';
    // If string contains time part HH:MM:SS, extract it directly to prevent browser timezone shifts
    if (typeof dateTimeStr === 'string' && dateTimeStr.includes(' ')) {
        const parts = dateTimeStr.split(' ');
        if (parts[1]) {
            const timeParts = parts[1].split(':');
            if (timeParts.length >= 2) {
                let hour = parseInt(timeParts[0]);
                const minute = timeParts[1];
                const ampm = hour >= 12 ? 'PM' : 'AM';
                hour = hour % 12 || 12;
                return `${hour}:${minute} ${ampm}`;
            }
        }
    }
    const d = new Date(dateTimeStr);
    if (isNaN(d.getTime())) return dateTimeStr;
    return d.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: true });
}

function openModal(modalId) {
    document.getElementById(modalId).classList.add('show');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('show');
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

// Global Window Exports for HTML inline onclick handlers
if (typeof window !== 'undefined') {
    window.handleClockIn = handleClockIn;
    window.handleClockOut = handleClockOut;
    window.toggleClockAction = toggleClockAction;
    window.switchView = switchView;
    window.renderMyAttendance = renderMyAttendance;
    window.renderTeamAttendance = renderTeamAttendance;
    window.renderSalaryPayroll = renderSalaryPayroll;
    window.renderEmployeesRoster = renderEmployeesRoster;
    window.renderExEmployees = renderExEmployees;
    window.renderFirebaseSetup = renderFirebaseSetup;
    window.showPayslipModal = showPayslipModal;
    window.openModal = openModal;
    window.closeModal = closeModal;
    window.logout = logout;
}
