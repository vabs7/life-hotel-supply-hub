const fs = require('fs');
const https = require('https');

const PROJECT_ID = "life-hotel-supply";
const BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function makeRequest(url, method, body = null) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = https.request({
            hostname: u.hostname,
            path: u.pathname + u.search,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': body ? Buffer.byteLength(body) : 0
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve(parsed);
                } catch (e) {
                    resolve(data);
                }
            });
        });

        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

// Convert JavaScript Object to Firestore REST Value
function toFirestoreValue(val) {
    if (val === null || val === undefined) return { nullValue: null };
    if (typeof val === 'boolean') return { booleanValue: val };
    if (typeof val === 'number') {
        if (Number.isInteger(val)) return { integerValue: String(val) };
        return { doubleValue: val };
    }
    if (typeof val === 'string') return { stringValue: val };
    if (Array.isArray(val)) {
        return { arrayValue: { values: val.map(toFirestoreValue) } };
    }
    if (typeof val === 'object') {
        const fields = {};
        for (let k in val) fields[k] = toFirestoreValue(val[k]);
        return { mapValue: { fields } };
    }
    return { stringValue: String(val) };
}

async function wipeCollection(collectionName) {
    console.log(`Wiping collection: ${collectionName}...`);
    let pageToken = '';
    do {
        const url = `${BASE_URL}/${collectionName}?pageSize=300${pageToken ? '&pageToken=' + pageToken : ''}`;
        const res = await makeRequest(url, 'GET');
        if (res.documents && res.documents.length > 0) {
            for (let doc of res.documents) {
                const docPath = doc.name; // Full path
                const deleteUrl = `https://firestore.googleapis.com/v1/${docPath}`;
                await makeRequest(deleteUrl, 'DELETE');
            }
            console.log(`Deleted batch of ${res.documents.length} docs from ${collectionName}.`);
        }
        pageToken = res.nextPageToken || '';
    } while (pageToken);
    console.log(`✓ Collection ${collectionName} wiped clean.`);
}

async function uploadCollection(collectionName, items) {
    console.log(`Uploading ${items.length} clean documents to ${collectionName}...`);
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const docId = String(item.id);
        const url = `${BASE_URL}/${collectionName}/${docId}`;

        // Strictly sanitize remarks
        if (collectionName === 'attendance') {
            if (!item.remarks || item.remarks.match(/^\d{4}-\d{2}-\d{2}/) || item.remarks.includes('2026-') || item.remarks.includes('2025-')) {
                item.remarks = '';
            }
        }

        const fields = {};
        for (let k in item) {
            fields[k] = toFirestoreValue(item[k]);
        }

        await makeRequest(url, 'PATCH', JSON.stringify({ fields }));

        if ((i + 1) % 100 === 0 || (i + 1) === items.length) {
            console.log(`Uploaded ${i + 1} / ${items.length} to ${collectionName}...`);
        }
    }
    console.log(`✓ ${collectionName} upload complete.`);
}

async function runCleanSync() {
    console.log('🚀 Starting Full Firestore Wipe & Fresh Clean Reseed...');
    const data = JSON.parse(fs.readFileSync('migrated_data.json', 'utf8'));

    await wipeCollection('users');
    await wipeCollection('attendance');
    await wipeCollection('salary_history');

    await uploadCollection('users', data.users);
    await uploadCollection('attendance', data.attendance);
    await uploadCollection('salary_history', data.salary_history);

    console.log('🎉 WIPE & RE-SEED FINISHED SUCCESSFULLY!');
}

runCleanSync().catch(console.error);
