import { auth } from "../firebase/firebase-config.js";
import {
    browserLocalPersistence,
    browserSessionPersistence,
    onAuthStateChanged,
    setPersistence,
    signInWithEmailAndPassword,
    signOut
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getUserProfile } from "./user-service.js";
import { setupThemeToggle } from "./theme-service.js";

setupThemeToggle();

const form = document.getElementById("loginForm");
const email = document.getElementById("email");
const password = document.getElementById("password");
const togglePassword = document.getElementById("togglePassword");
const rememberSession = document.getElementById("rememberSession");
const statusBox = document.getElementById("statusBox");
const rememberKey = "sxmy-remember-session";

rememberSession.checked = localStorage.getItem(rememberKey) !== "false";

async function canEnter(user) {
    const profile = await getUserProfile(user.uid);
    if (profile && profile.activo === false) {
        await signOut(auth);
        statusBox.textContent = "Este usuario esta desactivado.";
        return false;
    }
    return true;
}

onAuthStateChanged(auth, async (user) => {
    if (user && await canEnter(user)) window.location.href = "admin.html";
});

form.addEventListener("submit", async (event) => {
    event.preventDefault();
    statusBox.textContent = "Ingresando...";
    statusBox.className = "login-status";

    try {
        localStorage.setItem(rememberKey, String(rememberSession.checked));
        await setPersistence(auth, rememberSession.checked ? browserLocalPersistence : browserSessionPersistence);
        const credential = await signInWithEmailAndPassword(auth, email.value.trim(), password.value);
        if (await canEnter(credential.user)) window.location.href = "admin.html";
    } catch (error) {
        console.error(error);
        statusBox.textContent = "Correo o contrasena incorrectos, o Auth no esta habilitado.";
        statusBox.className = "login-status login-status-error";
    }
});

togglePassword.addEventListener("click", () => {
    const visible = password.type === "text";
    password.type = visible ? "password" : "text";
    togglePassword.classList.toggle("is-visible", !visible);
    togglePassword.setAttribute("aria-label", visible ? "Mostrar contraseña" : "Ocultar contraseña");
    togglePassword.title = visible ? "Mostrar contraseña" : "Ocultar contraseña";
    password.focus();
});
