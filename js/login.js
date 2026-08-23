import { auth } from "../firebase/firebase-config.js";
import {
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signOut
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getUserProfile } from "./user-service.js";

const form = document.getElementById("loginForm");
const email = document.getElementById("email");
const password = document.getElementById("password");
const statusBox = document.getElementById("statusBox");

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
    statusBox.className = "rounded-lg border border-[#cbd5df] bg-[#f3f5f7] px-4 py-3 text-sm text-[#4b5563]";

    try {
        const credential = await signInWithEmailAndPassword(auth, email.value.trim(), password.value);
        if (await canEnter(credential.user)) window.location.href = "admin.html";
    } catch (error) {
        console.error(error);
        statusBox.textContent = "Correo o contrasena incorrectos, o Auth no esta habilitado.";
        statusBox.className = "rounded-lg border border-[#b8c3cf] bg-[#eef2f5] px-4 py-3 text-sm text-[#4b5563]";
    }
});
