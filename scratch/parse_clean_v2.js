const fs = require('fs');

console.log('Reading SQL dump...');
const content = fs.readFileSync('i10989407_gnmu1.sql', 'utf8');

// 1. Users Setup
const originalData = JSON.parse(fs.readFileSync('migrated_data.json', 'utf8'));

// Admin User override:
// Email: lifehotelsupply@gmail.com, Name: Kedar Raval, Username: kedar_is, Password: KedarRaval_2025@#
const cleanUsers = originalData.users.map(u => {
    if (u.id === '347' || u.username === 'vaibhav.ajugiya' || u.username === 'kedar_is') {
        return {
            id: '347',
            username: 'kedar_is',
            email: 'lifehotelsupply@gmail.com',
            display_name: 'Kedar Raval',
            first_name: 'Kedar',
            last_name: 'Raval',
            role: 'HR',
            password: 'KedarRaval_2025@#',
            offboard_date: null
        };
    }
    return u;
});

if (!cleanUsers.some(u => u.username === 'kedar_is')) {
    cleanUsers.unshift({
        id: '347',
        username: 'kedar_is',
        email: 'lifehotelsupply@gmail.com',
        display_name: 'Kedar Raval',
        first_name: 'Kedar',
        last_name: 'Raval',
        role: 'HR',
        password: 'KedarRaval_2025@#',
        offboard_date: null
    });
}

// 2. Parse ALL Attendance Blocks from eqla_wc_ams_attendance
console.log('Parsing ALL attendance blocks...');
let attendance = [];
let attPos = 0;

while ((attPos = content.indexOf('INSERT INTO `eqla_wc_ams_attendance`', attPos)) !== -1) {
    const endPos = content.indexOf(';\n', attPos);
    const sqlChunk = content.substring(attPos, endPos === -1 ? content.length : endPos);
    const valuesPart = sqlChunk.substring(sqlChunk.indexOf('VALUES') + 6).trim();

    const tuples = valuesPart.split(/\),\s*\(/);

    for (let rawTuple of tuples) {
        let cleaned = rawTuple.trim();
        if (cleaned.startsWith('(')) cleaned = cleaned.substring(1);
        if (cleaned.endsWith(')')) cleaned = cleaned.substring(0, cleaned.length - 1);
        if (cleaned.endsWith(';')) cleaned = cleaned.substring(0, cleaned.length - 1);

        const cols = [];
        let cur = '';
        let inStr = false;
        for (let i = 0; i < cleaned.length; i++) {
            const ch = cleaned[i];
            if (ch === "'" && (i === 0 || cleaned[i-1] !== '\\')) {
                inStr = !inStr;
            } else if (ch === ',' && !inStr) {
                cols.push(cur.trim());
                cur = '';
            } else {
                cur += ch;
            }
        }
        if (cur) cols.push(cur.trim());

        const cleanCols = cols.map(c => {
            if (c === 'NULL') return null;
            if (c.startsWith("'") && c.endsWith("'")) {
                return c.substring(1, c.length - 1).replace(/\\'/g, "'").replace(/\\\\/g, "\\");
            }
            return c;
        });

        // 0: id, 1: user_id, 2: date, 3: login_time, 4: logout_time, 5: status, 6: created_at, 7: remarks, 8: ip_address
        if (cleanCols.length >= 6) {
            const id = cleanCols[0];
            const user_id = cleanCols[1];
            const date = cleanCols[2];
            const login_time = cleanCols[3];
            const logout_time = cleanCols[4];
            const status = cleanCols[5] || 'Absent';
            const created_at = cleanCols[6];
            let remarks = cleanCols[7] || '';
            const ip_address = cleanCols[8] || '';

            if (!remarks || remarks === created_at || remarks.match(/^\d{4}-\d{2}-\d{2}/)) {
                remarks = '';
            }

            attendance.push({
                id: String(id),
                user_id: String(user_id),
                date: date,
                login_time: login_time,
                logout_time: logout_time,
                status: status,
                remarks: remarks,
                ip_address: ip_address
            });
        }
    }

    if (endPos === -1) break;
    attPos = endPos + 2;
}

// 3. Parse Salary History Blocks
console.log('Parsing ALL salary history blocks...');
let salary_history = [];
let salPos = 0;

while ((salPos = content.indexOf('INSERT INTO `eqla_wc_ams_salary_history`', salPos)) !== -1) {
    const endPos = content.indexOf(';\n', salPos);
    const sqlChunk = content.substring(salPos, endPos === -1 ? content.length : endPos);
    const valuesPart = sqlChunk.substring(sqlChunk.indexOf('VALUES') + 6).trim();

    const tuples = valuesPart.split(/\),\s*\(/);

    for (let rawTuple of tuples) {
        let cleaned = rawTuple.trim();
        if (cleaned.startsWith('(')) cleaned = cleaned.substring(1);
        if (cleaned.endsWith(')')) cleaned = cleaned.substring(0, cleaned.length - 1);
        if (cleaned.endsWith(';')) cleaned = cleaned.substring(0, cleaned.length - 1);

        const cols = [];
        let cur = '';
        let inStr = false;
        for (let i = 0; i < cleaned.length; i++) {
            const ch = cleaned[i];
            if (ch === "'" && (i === 0 || cleaned[i-1] !== '\\')) {
                inStr = !inStr;
            } else if (ch === ',' && !inStr) {
                cols.push(cur.trim());
                cur = '';
            } else {
                cur += ch;
            }
        }
        if (cur) cols.push(cur.trim());

        const cleanCols = cols.map(c => {
            if (c === 'NULL') return null;
            if (c.startsWith("'") && c.endsWith("'")) {
                return c.substring(1, c.length - 1).replace(/\\'/g, "'").replace(/\\\\/g, "\\");
            }
            return c;
        });

        // 0: id, 1: user_id, 2: amount, 3: effective_date, 4: updated_at, 5: currency
        if (cleanCols.length >= 4) {
            const id = cleanCols[0];
            const user_id = cleanCols[1];
            const amount = parseFloat(cleanCols[2]) || 0;
            const effective_date = cleanCols[3];
            const updated_at = cleanCols[4];
            const currency = cleanCols[5] || 'INR';

            salary_history.push({
                id: String(id),
                user_id: String(user_id),
                amount: amount,
                effective_date: effective_date,
                updated_at: updated_at,
                currency: currency
            });
        }
    }

    if (endPos === -1) break;
    salPos = endPos + 2;
}

// Write out newly parsed clean JSON
const finalData = {
    users: cleanUsers,
    attendance: attendance,
    salary_history: salary_history
};

fs.writeFileSync('migrated_data.json', JSON.stringify(finalData, null, 2));

console.log('Successfully re-parsed and exported complete clean data:');
console.log('- Users Count:', finalData.users.length);
console.log('- Attendance Count:', finalData.attendance.length);
console.log('- Salary Records Count:', finalData.salary_history.length);

const richa = finalData.attendance.filter(a => String(a.user_id) === '351');
console.log('- Richa Narang Total Attendance Records:', richa.length);
const richaDates = richa.map(a => a.date).sort();
console.log('- Richa Date Range:', richaDates[0], 'to', richaDates[richaDates.length - 1]);
