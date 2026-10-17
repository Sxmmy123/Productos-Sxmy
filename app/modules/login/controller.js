import { auth } from "../../shared/firebase/firebase-config.js";
import {
    browserLocalPersistence,
    browserSessionPersistence,
    onAuthStateChanged,
    setPersistence,
    signInWithEmailAndPassword,
    signOut
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getUserProfile } from "../../shared/services/user-service.js";
import { setupThemeToggle } from "../../shared/theme/theme.js?v=2";
import { authenticatedDestination } from "../../core/routes.js?v=5";

setupThemeToggle();

const form = document.getElementById("loginForm");
const email = document.getElementById("email");
const password = document.getElementById("password");
const togglePassword = document.getElementById("togglePassword");
const rememberSession = document.getElementById("rememberSession");
const statusBox = document.getElementById("statusBox");
const rememberKey = "sxmy-remember-session";

rememberSession.checked = localStorage.getItem(rememberKey) !== "false";

let pendingEntry = null;
let pendingUserId = null;
let redirecting = false;

function enterSession(user) {
    if (!user || redirecting) return Promise.resolve();
    if (pendingUserId === user.uid && pendingEntry) return pendingEntry;
    pendingUserId = user.uid;
    pendingEntry = (async () => {
        const profile = await getUserProfile(user.uid);
        if (profile?.activo === false) {
            await signOut(auth);
            statusBox.textContent = "Este usuario esta desactivado.";
            return;
        }
        redirecting = true;
        window.location.replace(authenticatedDestination(profile));
    })().finally(() => {
        pendingEntry = null;
        pendingUserId = null;
    });
    return pendingEntry;
}

onAuthStateChanged(auth, (user) => {
    enterSession(user).catch(() => {
        statusBox.textContent = "No se pudo verificar la sesion. Vuelve a intentarlo.";
        statusBox.className = "login-status login-status-error";
    });
});

form.addEventListener("submit", async (event) => {
    event.preventDefault();
    statusBox.textContent = "Ingresando...";
    statusBox.className = "login-status";
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;

    try {
        localStorage.setItem(rememberKey, String(rememberSession.checked));
        await setPersistence(auth, rememberSession.checked ? browserLocalPersistence : browserSessionPersistence);
        const credential = await signInWithEmailAndPassword(auth, email.value.trim(), password.value);
        await enterSession(credential.user);
    } catch (error) {
        console.error(error);
        statusBox.textContent = "Correo o contrasena incorrectos, o Auth no esta habilitado.";
        statusBox.className = "login-status login-status-error";
    } finally {
        submit.disabled = false;
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
