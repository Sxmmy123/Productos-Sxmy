/*=========================================
    FIREBASE-CONFIG.JS
    Configuracion de Firebase
==========================================*/

// Importar Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";

import {
    getFirestore
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

import {
    getStorage
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";

import {
    getAuth
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";


// ======================================
// Configuracion Firebase
// ======================================

const firebaseConfig = {

    apiKey: "AIzaSyCp4_zEU9V1JYDDLcIXDqLNTALNUxTXE0M",

    authDomain: "sxmy-bd.firebaseapp.com",

    projectId: "sxmy-bd",

    storageBucket: "sxmy-bd.firebasestorage.app",

    messagingSenderId: "882955106120",

    appId: "1:882955106120:web:977204fe757861e229a57d"

};


// ======================================
// Inicializar Firebase
// ======================================

const app = initializeApp(firebaseConfig);


// ======================================
// Servicios
// ======================================

const db = getFirestore(app);

const storage = getStorage(app);

const auth = getAuth(app);


// ======================================
// Exportar
// ======================================

export {

    app,

    firebaseConfig,

    db,

    storage,

    auth

};
