/**
 * Firebase Configuration & Synchronization Module
 * Life Hotel Supply Hub
 */

// Default Firebase Configuration (Life Hotel Supply)
const DEFAULT_FIREBASE_CONFIG = {
    apiKey: "AIzaSyBwMdRQrnmAO19diCKf2zC4fYQFkhZuTFo",
    authDomain: "life-hotel-supply.firebaseapp.com",
    projectId: "life-hotel-supply",
    storageBucket: "life-hotel-supply.firebasestorage.app",
    messagingSenderId: "427632686787",
    appId: "1:427632686787:web:b18911b8ab91c08f569476",
    measurementId: "G-M1CEDFRVN3"
};

// Retrieve configured Firebase settings or fall back to DEFAULT_FIREBASE_CONFIG
function getSavedFirebaseConfig() {
    try {
        const stored = localStorage.getItem('lhs_firebase_config');
        if (stored) {
            const parsed = JSON.parse(stored);
            if (parsed && parsed.apiKey) return parsed;
        }
    } catch (e) {
        console.warn('LocalStorage unavailable:', e);
    }
    return DEFAULT_FIREBASE_CONFIG;
}

// Save Firebase Config
function saveFirebaseConfig(config) {
    localStorage.setItem('lhs_firebase_config', JSON.stringify(config));
}

let firebaseApp = null;
let firebaseAuth = null;
let firebaseDb = null;
let isFirebaseConnected = false;

// Initialize Firebase SDK
async function initFirebaseServices() {
    const config = getSavedFirebaseConfig();
    
    // Check if valid Firebase API Key exists
    if (config && config.apiKey && config.apiKey.length > 10) {
        try {
            if (typeof firebase !== 'undefined') {
                if (!firebase.apps.length) {
                    firebaseApp = firebase.initializeApp(config);
                } else {
                    firebaseApp = firebase.app();
                }
                firebaseAuth = firebase.auth();
                firebaseDb = firebase.firestore();
                isFirebaseConnected = true;
                console.log('Firebase initialized successfully!');
            }
        } catch (err) {
            console.error('Failed to initialize Firebase:', err);
            isFirebaseConnected = false;
        }
    } else {
        console.log('Firebase API Key not provided. Operating in Local Data Mode (Restored SQL Data).');
        isFirebaseConnected = false;
    }
}

window.FirebaseManager = {
    getConfig: getSavedFirebaseConfig,
    saveConfig: saveFirebaseConfig,
    init: initFirebaseServices,
    isConnected: () => isFirebaseConnected,
    getAuth: () => firebaseAuth,
    getDb: () => firebaseDb
};
