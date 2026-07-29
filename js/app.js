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
    await initDataStore();
    initClockTimer();
    checkAuthSession();
    await FirebaseManager.init();
});

// Initialize Data Store (LocalStorage / migrated_data.json)
async function initDataStore() {
    try {
        const storedUsers = localStorage.getItem('lhs_users');
        const storedAtt = localStorage.getItem('lhs_attendance');
        const storedSal = localStorage.getItem('lhs_salary_history');

        if (storedUsers && storedAtt && storedSal) {
            appData.users = JSON.parse(storedUsers);
            appData.attendance = JSON.parse(storedAtt);
            appData.salary_history = JSON.parse(storedSal);

            // Sanitize & format salary_history schema
            appData.salary_history = appData.salary_history.map(s => {
                const realEffectiveDate = (s.updated_at && s.updated_at.length === 10) ? s.updated_at : (s.effective_date ? s.effective_date.split(' ')[0] : '2026-01-01');
                const realTimestamp = (s.effective_date && s.effective_date.length > 10) ? s.effective_date : (s.updated_at || '2026-01-01 00:00:00');
                return {
                    id: String(s.id),
                    user_id: String(s.user_id),
                    amount: parseFloat(s.amount),
                    currency: (['INR', 'USD', 'PHP'].includes(s.currency) ? s.currency : 'INR'),
                    effective_date: realEffectiveDate,
                    updated_at: realTimestamp
                };
            });
            saveDataStore();
        } else {
            // Load restored database dump JSON file
            const res = await fetch('migrated_data.json');
            const initialData = await res.json();
            appData.users = initialData.users || [];
            appData.attendance = initialData.attendance || [];
            appData.salary_history = initialData.salary_history || [];
            saveDataStore();
        }

        // Sync roles
        const roma = appData.users.find(u => u.username === 'roma.parmar');
        if (roma && roma.role !== 'HR') {
            roma.role = 'HR';
            saveDataStore();
        }
        const kcalpesh = appData.users.find(u => u.username === 'kcalpesh');
        if (kcalpesh && kcalpesh.role !== 'Employee') {
            kcalpesh.role = 'Employee';
            saveDataStore();
        }
    } catch (err) {
        console.error('Data Store initialization error:', err);
    }
}

function saveDataStore() {
    localStorage.setItem('lhs_users', JSON.stringify(appData.users));
    localStorage.setItem('lhs_attendance', JSON.stringify(appData.attendance));
    localStorage.setItem('lhs_salary_history', JSON.stringify(appData.salary_history));
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
    const today = getTodayString();
    const time = now.toLocaleTimeString('en-GB', { timeZone: 'America/Chicago' });
    return `${today} ${time}`;
}

// Auth Management
function checkAuthSession() {
    const savedUser = localStorage.getItem('lhs_current_user');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        onUserAuthenticated();
    } else {
        document.getElementById('authOverlay').style.display = 'flex';
    }
}

function fillPassword(val) {
    if (val) {
        document.getElementById('loginPassword').value = '123456';
    }
}

function handleLogin(e) {
    e.preventDefault();
    const inputVal = document.getElementById('loginUsername').value.trim().toLowerCase();
    const passwordInput = document.getElementById('loginPassword').value.trim();
    const errEl = document.getElementById('loginError');

    if (errEl) {
        errEl.style.display = 'none';
        errEl.textContent = '';
    }

    if (!inputVal) {
        if (errEl) {
            errEl.textContent = 'Please enter your email or username.';
            errEl.style.display = 'block';
        }
        return;
    }

    const user = appData.users.find(u => 
        (u.username && u.username.toLowerCase() === inputVal) || 
        (u.email && u.email.toLowerCase() === inputVal)
    );

    if (!user) {
        if (errEl) {
            errEl.textContent = 'Invalid email/username or account not found.';
            errEl.style.display = 'block';
        }
        return;
    }

    // Block ex-employees
    if (user.offboard_date) {
        if (errEl) {
            errEl.textContent = 'Access Denied: Offboarded ex-employees cannot log into the system.';
            errEl.style.display = 'block';
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
        return;
    }

    // Authenticated
    currentUser = user;
    localStorage.setItem('lhs_current_user', JSON.stringify(currentUser));
    onUserAuthenticated();
}

function handleLogout() {
    currentUser = null;
    localStorage.removeItem('lhs_current_user');
    document.getElementById('authOverlay').style.display = 'flex';
}

function onUserAuthenticated() {
    document.getElementById('authOverlay').style.display = 'none';
    
    // Update User Badge in Sidebar
    const avatarEl = document.getElementById('userAvatar');
    const nameEl = document.getElementById('userName');
    const roleEl = document.getElementById('userRole');

    if (avatarEl) avatarEl.textContent = currentUser.display_name.charAt(0).toUpperCase();
    if (nameEl) nameEl.textContent = currentUser.display_name;
    if (roleEl) roleEl.textContent = currentUser.role;

    // Toggle HR Visibility
    const hrElements = document.querySelectorAll('.hr-only');
    hrElements.forEach(el => {
        el.style.display = (currentUser.role === 'HR') ? 'flex' : 'none';
    });

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
        teamAttendance: 'Team Attendance Logs (HR)',
        employees: 'Employee Roster (HR)',
        salaryPayroll: 'Salary & Payroll (HR)',
        exEmployees: 'Ex-Employees Archive (HR)',
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

    // Check today's punch for current user
    const todayRecord = appData.attendance.find(a => String(a.user_id) === String(currentUser.id) && a.date === today);

    const btnClock = document.getElementById('btnClockAction');
    const statusBadge = document.getElementById('clockStatusBadge');
    const todayTimes = document.getElementById('todayTimes');

    if (!todayRecord) {
        statusBadge.textContent = 'Status: Not Clocked In Today';
        statusBadge.className = 'clock-status-pill';
        statusBadge.style.color = '#e2e8f0';
        btnClock.textContent = 'Clock In';
        btnClock.className = 'btn btn-primary';
        btnClock.disabled = false;
        if (todayTimes) todayTimes.textContent = '';
    } else if (todayRecord && !todayRecord.logout_time) {
        statusBadge.textContent = 'Status: Clocked In (Present)';
        statusBadge.className = 'clock-status-pill';
        statusBadge.style.color = 'var(--status-present)';
        btnClock.textContent = 'Clock Out';
        btnClock.className = 'btn btn-danger';
        btnClock.disabled = false;
        if (todayTimes) todayTimes.textContent = `In: ${formatTime(todayRecord.login_time)}`;
    } else {
        statusBadge.textContent = 'Status: Clocked Out (Completed)';
        statusBadge.className = 'clock-status-pill';
        statusBadge.style.color = '#cbd5e1';
        btnClock.textContent = 'Shift Completed';
        btnClock.className = 'btn btn-secondary';
        btnClock.disabled = true;
        if (todayTimes) todayTimes.textContent = `In: ${formatTime(todayRecord.login_time)} | Out: ${formatTime(todayRecord.logout_time)}`;
    }

    // Monthly stats for current user
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const monthlyRecords = appData.attendance.filter(a => {
        if (String(a.user_id) !== String(currentUser.id)) return false;
        const d = new Date(a.date);
        return (d.getMonth() + 1) === currentMonth && d.getFullYear() === currentYear;
    });

    const presentCount = monthlyRecords.filter(a => a.status === 'Present').length;
    const absentCount = monthlyRecords.filter(a => a.status === 'Absent').length;
    const halfCount = monthlyRecords.filter(a => a.status === 'Half Day').length;

    document.getElementById('statPresent').textContent = presentCount;
    document.getElementById('statAbsent').textContent = absentCount;
    document.getElementById('statHalfDay').textContent = halfCount;

    // Calculate Estimated Net Pay
    const baseSalObj = getLatestBaseSalary(currentUser.id, `${currentYear}-${String(currentMonth).padStart(2,'0')}-28`);
    const perDay = baseSalObj.amount / 30;
    const deduction = (absentCount * perDay) + (halfCount * (perDay / 2));
    const netPay = Math.max(0, baseSalObj.amount - deduction);
    document.getElementById('statNetPay').textContent = formatMoney(netPay, baseSalObj.currency);

    // Render Today's Team Table for HR
    if (currentUser.role === 'HR') {
        let activeUsers = appData.users.filter(u => !u.offboard_date && String(u.id) !== String(currentUser.id));
        if (currentUser.username !== 'vaibhav.ajugiya') {
            activeUsers = activeUsers.filter(u => u.username !== 'vaibhav.ajugiya');
        }
        const tbody = document.getElementById('todayTeamTableBody');
        tbody.innerHTML = activeUsers.map(u => {
            const rec = appData.attendance.find(a => String(a.user_id) === String(u.id) && a.date === today);
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

// Global Ex-Employee Archive Toggle
let showExEmployeesGlobal = false;

function toggleArchiveExEmployees() {
    showExEmployeesGlobal = !showExEmployeesGlobal;
    const btn = document.getElementById('btnArchiveExToggle');
    if (btn) {
        btn.textContent = `Include Ex-Employees in Reports: ${showExEmployeesGlobal ? 'ON' : 'OFF'}`;
        btn.className = showExEmployeesGlobal ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
    }
}

// Clock Action Handler
function toggleClockAction() {
    if (!currentUser) return;
    const today = getTodayString();
    const nowStr = getDateTimeString();
    const remarks = document.getElementById('clockRemarks').value.trim();

    let todayRecord = appData.attendance.find(a => String(a.user_id) === String(currentUser.id) && a.date === today);

    if (!todayRecord) {
        // Clock In
        const newRecord = {
            id: String(Date.now()),
            user_id: String(currentUser.id),
            date: today,
            login_time: nowStr,
            logout_time: null,
            status: 'Present',
            remarks: remarks || 'Web Clock In',
            ip_address: 'Client Web'
        };
        appData.attendance.unshift(newRecord);
        saveDataStore();
        alert('Clocked In Successfully!');
    } else if (todayRecord && !todayRecord.logout_time) {
        // Clock Out
        todayRecord.logout_time = nowStr;
        if (remarks) todayRecord.remarks = (todayRecord.remarks ? todayRecord.remarks + ' | ' : '') + remarks;
        saveDataStore();
        alert('Clocked Out Successfully!');
    } else {
        alert('You have already clocked in and out for today.');
    }

    document.getElementById('clockRemarks').value = '';
    renderDashboard();
}

// VIEW 2: MY ATTENDANCE HISTORY
function renderMyAttendance() {
    if (!currentUser) return;
    const month = parseInt(document.getElementById('myMonthFilter').value);
    const year = parseInt(document.getElementById('myYearFilter').value);

    const records = appData.attendance.filter(a => {
        if (String(a.user_id) !== String(currentUser.id)) return false;
        const d = new Date(a.date);
        return (d.getMonth() + 1) === month && d.getFullYear() === year;
    }).sort((a, b) => new Date(b.date) - new Date(a.date));

    const tbody = document.getElementById('myAttendanceTableBody');
    if (records.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">No attendance records found for this month.</td></tr>`;
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
                <td><code>${escapeHtml(r.ip_address || '-')}</code></td>
                <td>${escapeHtml(r.remarks || '-')}</td>
            </tr>
        `;
    }).join('');
}

// VIEW 3: TEAM ATTENDANCE (HR)
function renderTeamAttendance() {
    if (currentUser.role !== 'HR') return;

    const month = parseInt(document.getElementById('teamMonthFilter').value);
    const year = parseInt(document.getElementById('teamYearFilter').value);

    // HR should not see herself in team logs
    let allowedUsers = appData.users.filter(u => String(u.id) !== String(currentUser.id));

    if (!showExEmployeesGlobal) {
        allowedUsers = allowedUsers.filter(u => !u.offboard_date);
    }
    if (currentUser.username !== 'vaibhav.ajugiya') {
        allowedUsers = allowedUsers.filter(u => u.username !== 'vaibhav.ajugiya');
    }

    const select = document.getElementById('teamUserFilter');
    if (select) {
        const label = showExEmployeesGlobal ? 'All Team (Including Ex-Employees)' : 'All Active Employees';
        select.innerHTML = `<option value="ALL">${label}</option>` + allowedUsers.map(u => `<option value="${u.id}">${escapeHtml(u.display_name)} ${u.offboard_date ? '(Ex)' : ''}</option>`).join('');
    }

    const selectedUserId = select ? select.value : 'ALL';
    const allowedUserIds = allowedUsers.map(u => String(u.id));

    const records = appData.attendance.filter(a => {
        if (!allowedUserIds.includes(String(a.user_id))) return false;
        if (selectedUserId !== 'ALL' && String(a.user_id) !== String(selectedUserId)) return false;
        const d = new Date(a.date);
        return (d.getMonth() + 1) === month && d.getFullYear() === year;
    }).sort((a, b) => new Date(b.date) - new Date(a.date));

    const tbody = document.getElementById('teamAttendanceTableBody');
    if (records.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">No team attendance records found for this selection.</td></tr>`;
        return;
    }

    tbody.innerHTML = records.map(r => {
        const user = appData.users.find(u => String(u.id) === String(r.user_id));
        const badgeClass = r.status === 'Present' ? 'badge-present' : (r.status === 'Absent' ? 'badge-absent' : 'badge-halfday');

        return `
            <tr>
                <td><strong>${escapeHtml(user ? user.display_name : `User ${r.user_id}`)}</strong> ${user && user.offboard_date ? '<span style="color:#ef4444; font-size:0.75rem;">(Ex)</span>' : ''}</td>
                <td>${formatDate(r.date)}</td>
                <td>${formatTime(r.login_time)}</td>
                <td>${formatTime(r.logout_time)}</td>
                <td><span class="badge ${badgeClass}">${r.status}</span></td>
                <td>${escapeHtml(r.remarks || '-')}</td>
                <td>
                    <button class="btn btn-secondary btn-sm" onclick="editAttendanceModal('${r.id}')">Edit</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteAttendanceRecord('${r.id}')">Delete</button>
                </td>
            </tr>
        `;
    }).join('');
}

function renderEmployeesRoster() {
    if (currentUser.role !== 'HR') return;

    let activeUsers = appData.users.filter(u => !u.offboard_date);
    if (currentUser.username !== 'vaibhav.ajugiya') {
        activeUsers = activeUsers.filter(u => u.username !== 'vaibhav.ajugiya');
    }

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
    const username = document.getElementById('empUsername').value.trim();
    const email = document.getElementById('empEmail').value.trim();
    const role = document.getElementById('empRole').value;
    const password = document.getElementById('empPassword').value.trim() || '123456';

    const existing = appData.users.find(u => u.username === username);
    if (existing) {
        alert('An account with this username already exists.');
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
    closeModal('employeeModal');
    renderEmployeesRoster();
    alert(`Employee ${name} added successfully! Default Password: ${password}`);
}

function resetEmployeePassword(id) {
    const user = appData.users.find(u => String(u.id) === String(id));
    if (!user) return;
    const currentPass = user.password || '123456';
    const newPass = prompt(`Reset password for ${user.display_name}:\n\nCurrent Password: ${currentPass}\n\nEnter new password:`, currentPass);
    if (newPass && newPass.trim()) {
        user.password = newPass.trim();
        saveDataStore();
        renderEmployeesRoster();
        alert(`Password for ${user.display_name} updated successfully to: ${user.password}`);
    }
}

function offboardEmployee(id) {
    const user = appData.users.find(u => String(u.id) === String(id));
    if (!user) return;
    const defaultDate = getTodayString();
    const exitDate = prompt(`Offboard ${user.display_name}:\nPlease enter offboarding exit date (YYYY-MM-DD):`, defaultDate);
    if (exitDate && exitDate.trim()) {
        user.offboard_date = exitDate.trim();
        saveDataStore();
        renderEmployeesRoster();
        alert(`${user.display_name} has been offboarded with exit date: ${user.offboard_date}`);
    }
}

function rehireEmployee(id) {
    const user = appData.users.find(u => String(u.id) === String(id));
    if (!user) return;
    user.offboard_date = null;
    saveDataStore();
    populateLoginDropdown();
    renderExEmployees();
}

// VIEW 5: SALARY & PAYROLL (HR)
function renderSalaryPayroll() {
    if (currentUser.role !== 'HR') return;
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

function renderPayrollMonthlyTab() {
    const month = parseInt(document.getElementById('payrollMonthFilter').value);
    const year = parseInt(document.getElementById('payrollYearFilter').value);
    const totalDays = new Date(year, month, 0).getDate();
    const eomDate = `${year}-${String(month).padStart(2,'0')}-${totalDays}`;

    let users = appData.users.filter(u => showExEmployeesGlobal || !u.offboard_date);
    if (currentUser.username !== 'vaibhav.ajugiya') {
        users = users.filter(u => u.username !== 'vaibhav.ajugiya');
    }

    const tbody = document.getElementById('payrollTableBody');
    tbody.innerHTML = users.map(u => {
        const baseObj = getLatestBaseSalary(u.id, eomDate);
        const stats = getMonthlyCounts(u.id, month, year);

        const perDay = baseObj.amount / 30; // 30-day standard divisor
        const deduction = (stats.absent * perDay) + (stats.halfDay * (perDay / 2));
        const netPayable = Math.max(0, baseObj.amount - deduction);

        return `
            <tr>
                <td><strong>${escapeHtml(u.display_name)}</strong> ${u.offboard_date ? '<span style="color:#ef4444; font-size:0.75rem;">(Ex)</span>' : ''}</td>
                <td>${formatMoney(baseObj.amount, baseObj.currency)}</td>
                <td>
                    <span style="color:var(--status-present); font-weight:600;">${stats.present} P</span> / 
                    <span style="color:var(--status-absent); font-weight:600;">${stats.absent} A</span> / 
                    <span style="color:var(--status-halfday); font-weight:600;">${stats.halfDay} H</span>
                </td>
                <td style="color:#ef4444;">-${formatMoney(deduction, baseObj.currency)}</td>
                <td><strong>${formatMoney(netPayable, baseObj.currency)}</strong></td>
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
        if (currentUser.username !== 'vaibhav.ajugiya' && user && user.username === 'vaibhav.ajugiya') return false;
        if (!showExEmployeesGlobal && user && user.offboard_date) return false;
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
        if (currentUser.username !== 'vaibhav.ajugiya') {
            list = list.filter(u => u.username !== 'vaibhav.ajugiya');
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
    const perDay = base / 30;
    const deduction = absent * perDay;
    const net = Math.max(0, base - deduction);

    document.getElementById('calcPerDay').textContent = formatMoney(perDay, currency);
    document.getElementById('calcDeduction').textContent = `-${formatMoney(deduction, currency)}`;
    document.getElementById('calcNetPay').textContent = formatMoney(net, currency);
}

// VIEW 6: EX-EMPLOYEES ARCHIVE (HR)
function renderExEmployees() {
    if (currentUser.role !== 'HR') return;

    const btn = document.getElementById('btnArchiveExToggle');
    if (btn) {
        btn.textContent = `Include Ex-Employees in Reports: ${showExEmployeesGlobal ? 'ON' : 'OFF'}`;
        btn.className = showExEmployeesGlobal ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
    }

    const offboardedUsers = appData.users.filter(u => !!u.offboard_date);
    const tbody = document.getElementById('exEmployeesTableBody');

    if (offboardedUsers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--text-muted);">No offboarded employees recorded.</td></tr>`;
        return;
    }

    tbody.innerHTML = offboardedUsers.map(u => {
        return `
            <tr>
                <td><strong>${escapeHtml(u.display_name)}</strong></td>
                <td>${escapeHtml(u.email)}</td>
                <td><span style="color:#ef4444; font-weight:600;">${formatDate(u.offboard_date)}</span></td>
            </tr>
        `;
    }).join('');
}

// VIEW 7: FIREBASE SETUP (HR)
function renderFirebaseSetup() {
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
    const allowedSeeders = ['vaibhav.ajugiya', 'kcalpesh'];
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

    const select = document.getElementById('attUserSelect');
    let activeUsers = appData.users.filter(u => !u.offboard_date);
    if (currentUser.username !== 'vaibhav.ajugiya') {
        activeUsers = activeUsers.filter(u => u.username !== 'vaibhav.ajugiya');
    }
    select.innerHTML = activeUsers.map(u => `<option value="${u.id}">${escapeHtml(u.display_name)}</option>`).join('');

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

    const select = document.getElementById('attUserSelect');
    select.innerHTML = appData.users.map(u => `<option value="${u.id}">${escapeHtml(u.display_name)}</option>`).join('');
    select.value = record.user_id;

    document.getElementById('attDate').value = record.date;
    document.getElementById('attStatus').value = record.status;
    document.getElementById('attInTime').value = record.login_time ? record.login_time.split(' ')[1]?.substring(0,5) || '' : '';
    document.getElementById('attOutTime').value = record.logout_time ? record.logout_time.split(' ')[1]?.substring(0,5) || '' : '';
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

    const loginTime = inTimeVal ? `${date} ${inTimeVal}:00` : null;
    const logoutTime = outTimeVal ? `${date} ${outTimeVal}:00` : null;

    if (editId) {
        const record = appData.attendance.find(a => String(a.id) === String(editId));
        if (record) {
            record.user_id = userId;
            record.date = date;
            record.status = status;
            record.login_time = loginTime;
            record.logout_time = logoutTime;
            record.remarks = remarks;
        }
    } else {
        const newRecord = {
            id: String(Date.now()),
            user_id: userId,
            date: date,
            status: status,
            login_time: loginTime,
            logout_time: logoutTime,
            remarks: remarks,
            ip_address: 'Admin Manual'
        };
        appData.attendance.unshift(newRecord);
    }

    saveDataStore();
    closeModal('attendanceModal');
    renderTeamAttendance();
}

function deleteAttendanceRecord(id) {
    if (!confirm('Are you sure you want to delete this attendance record?')) return;
    appData.attendance = appData.attendance.filter(a => String(a.id) !== String(id));
    saveDataStore();
    renderTeamAttendance();
}

function openAddSalaryModal() {
    const select = document.getElementById('salUserSelect');
    let activeUsers = appData.users.filter(u => !u.offboard_date);
    if (currentUser.username !== 'vaibhav.ajugiya') {
        activeUsers = activeUsers.filter(u => u.username !== 'vaibhav.ajugiya');
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

    const newSal = {
        id: String(Date.now()),
        user_id: userId,
        amount: amount,
        currency: currency,
        effective_date: effectiveDate,
        updated_at: getDateTimeString()
    };

    appData.salary_history.unshift(newSal);
    saveDataStore();
    closeModal('salaryModal');
    renderSalaryPayroll();
}

function deleteSalaryRate(id) {
    if (!confirm('Delete this salary rate record?')) return;
    appData.salary_history = appData.salary_history.filter(s => String(s.id) !== String(id));
    saveDataStore();
    renderSalaryPayroll();
}

function formatMoney(amount, currency = 'INR') {
    const symbols = { INR: '₹', USD: '$', PHP: '₱' };
    const sym = symbols[currency] || currency + ' ';
    const val = parseFloat(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${sym}${val}`;
}

function showPayslipModal(userId, month, year) {
    const user = appData.users.find(u => String(u.id) === String(userId));
    if (!user) return;

    const totalDays = new Date(year, month, 0).getDate();
    const eomDate = `${year}-${String(month).padStart(2,'0')}-${totalDays}`;
    const baseObj = getLatestBaseSalary(userId, eomDate);
    const stats = getMonthlyCounts(userId, month, year);

    const perDay = baseObj.amount / 30;
    const deduction = (stats.absent * perDay) + (stats.halfDay * (perDay / 2));
    const netPayable = Math.max(0, baseObj.amount - deduction);

    const monthName = new Date(year, month - 1, 1).toLocaleString('default', { month: 'long' });

    const content = `
        <div style="text-align: center; margin-bottom: 1.5rem; border-bottom: 2px solid var(--primary); padding-bottom: 1rem;">
            <img src="logo.jpg" style="height: 50px; margin-bottom: 0.5rem;" alt="Logo">
            <h2>Life Hotel Supply</h2>
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
                <strong>Standard Divisor:</strong> 30 Days
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
                    <td style="text-align: right;">${formatMoney(baseObj.amount, baseObj.currency)}</td>
                </tr>
                <tr>
                    <td>Days Present (${stats.present} Days)</td>
                    <td style="text-align: right; color: var(--status-present);">Verified</td>
                </tr>
                <tr>
                    <td>Absent Deductions (${stats.absent} Full + ${stats.halfDay} Half Days)</td>
                    <td style="text-align: right; color: #ef4444;">-${formatMoney(deduction, baseObj.currency)}</td>
                </tr>
                <tr style="font-weight: 700; background: #f8fafc;">
                    <td>NET PAYABLE SALARY</td>
                    <td style="text-align: right; color: var(--primary); font-size: 1.1rem;">${formatMoney(netPayable, baseObj.currency)}</td>
                </tr>
            </tbody>
        </table>
    `;

    document.getElementById('payslipContent').innerHTML = content;
    openModal('payslipModal');
}

// Helpers
function getLatestBaseSalary(userId, dateStr) {
    const userSalaries = appData.salary_history.filter(s => String(s.user_id) === String(userId) && s.effective_date <= dateStr)
        .sort((a, b) => new Date(b.effective_date) - new Date(a.effective_date));
    
    if (userSalaries.length > 0) {
        return {
            amount: parseFloat(userSalaries[0].amount),
            currency: userSalaries[0].currency || 'INR'
        };
    }
    return { amount: 30000, currency: 'INR' };
}

function getMonthlyCounts(userId, month, year) {
    const records = appData.attendance.filter(a => {
        if (String(a.user_id) !== String(userId)) return false;
        const d = new Date(a.date);
        return (d.getMonth() + 1) === month && d.getFullYear() === year;
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
