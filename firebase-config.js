/**
 * Firebase Configuration & Synchronization Module
 * Life Hotel Supply Hub
 */

// Default or LocalStorage Firebase Config Object
const DEFAULT_FIREBASE_CONFIG = {
    apiKey: "",
    authDomain: "life-hotel-supply.firebaseapp.com",
    projectId: "life-hotel-supply",
    storageBucket: "life-hotel-supply.appspot.com",
    messagingSenderId: "",
    appId: ""
};

// Retrieve user's configured Firebase settings or fall back to stored
function getSavedFirebaseConfig() {
    try {
        const stored = localStorage.getItem('lhs_firebase_config');
        if (stored) {
            return JSON.parse(stored);
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
