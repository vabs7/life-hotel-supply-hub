/**
 * Node.js CLI script to seed restored database dump to Firebase Firestore using Firebase Admin SDK.
 * 
 * Usage:
 * 1. Download serviceAccountKey.json from your Firebase Console.
 * 2. Place serviceAccountKey.json in the project root folder.
 * 3. Run: node scripts/seed_firebase.js
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const serviceAccountPath = path.join(__dirname, '..', 'serviceAccountKey.json');
const dataPath = path.join(__dirname, '..', 'migrated_data.json');

if (!fs.existsSync(serviceAccountPath)) {
    console.error('Error: serviceAccountKey.json not found in root directory.');
    console.log('Please download your Firebase Admin service account key from Firebase Console -> Project Settings -> Service accounts.');
    process.exit(1);
}

if (!fs.existsSync(dataPath)) {
    console.error('Error: migrated_data.json not found.');
    process.exit(1);
}

const serviceAccount = require(serviceAccountPath);
const seedData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function runSeeder() {
    console.log('--- Starting Firebase Firestore Seeding ---');

    // 1. Users Collection
    console.log(`Seeding ${seedData.users.length} Users...`);
    for (const user of seedData.users) {
        await db.collection('users').doc(String(user.id)).set(user, { merge: true });
    }
    console.log('✓ Users uploaded.');

    // 2. Attendance Collection (in batches)
    console.log(`Seeding ${seedData.attendance.length} Attendance Records...`);
    const batchSize = 400;
    for (let i = 0; i < seedData.attendance.length; i += batchSize) {
        const batch = db.batch();
        const chunk = seedData.attendance.slice(i, i + batchSize);
        chunk.forEach(att => {
            const ref = db.collection('attendance').doc(String(att.id));
            batch.set(ref, att, { merge: true });
        });
        await batch.commit();
        console.log(`Uploaded batch ${Math.min(i + batchSize, seedData.attendance.length)} / ${seedData.attendance.length}`);
    }
    console.log('✓ Attendance records uploaded.');

    // 3. Salary History Collection
    console.log(`Seeding ${seedData.salary_history.length} Salary History Records...`);
    for (const sal of seedData.salary_history) {
        await db.collection('salary_history').doc(String(sal.id)).set(sal, { merge: true });
    }
    console.log('✓ Salary history records uploaded.');

    console.log('--- Firebase Seeding Complete! ---');
    process.exit(0);
}

runSeeder().catch(err => {
    console.error('Seeding Error:', err);
    process.exit(1);
});
