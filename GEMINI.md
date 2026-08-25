# Project Guidelines & Rules — Life Hotel Supply Hub

## 1. Mandatory Version Number Bump on EVERY Update
Every time any modification, bug fix, or feature is updated in the codebase:
1. **Increment the Version Number** (e.g. `v2.3` -> `v2.4` -> `v2.5`):
2. **Update Cache-Buster Script & Style Tags in `dashboard.html`**:
   - `<script src="js/app.js?v=X.X"></script>`
   - `<script src="firebase-config.js?v=X.X"></script>`
   - `<link rel="stylesheet" href="css/styles.css?v=X.X">`
3. **Update the Visible Version Badge in `dashboard.html` Sidebar**:
   - Under `<div class="brand-subtitle">Portal</div>`, update the version tag `<div ...>vX.X</div>` so it exactly matches the script tag version.

---

## 2. Dynamic Month & Year Filters (No HTML Hardcoding)
- **Never hardcode `selected` on any specific month in HTML** (`<option value="8">August</option>`).
- Dropdown selections must always be initialized dynamically via JavaScript using `initDefaultMonthYearFilters()` based on Chicago Central Time (CT).

---

## 3. Salary & Payroll Calculations
- Unset base salaries must return `{ amount: 0, currency: 'INR', isSet: false }`.
- Always display **`Not Set`** instead of assuming fallback salary numbers (like 30,000 INR).
- Per-day rate calculation must always divide by the exact number of days in the selected month: `baseSalary / totalDaysInMonth`.

---

## 4. Alphabetical Sorting
- All employee lists (Team Summary, Roster, Payroll, Dashboard Today table) must be sorted alphabetically (**A to Z**) by `display_name`.

---

## 5. Duplicate Punch Protection
- The **Clock In** and **Clock Out** buttons are separate and stacked vertically.
- Buttons must instantly disable upon click (`disabled = true`) with a loading indicator to prevent rapid double-clicks.
- Always check `isSameUser(a.user_id, currentUser.id) && isSameDate(a.date, today)` before inserting attendance records.
