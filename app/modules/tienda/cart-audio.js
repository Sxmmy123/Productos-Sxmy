import { getPreferences } from "../configuracion/preferences.js";
let audioContext = null;

export function playCartSound(type) {
    if (!getPreferences().general.sounds) return;
    try {
        audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const now = audioContext.currentTime;
        const isAdd = type === "add";

        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(isAdd ? 720 : 340, now);
        oscillator.frequency.exponentialRampToValueAtTime(isAdd ? 920 : 260, now + .08);
        gain.gain.setValueAtTime(.001, now);
        gain.gain.exponentialRampToValueAtTime(isAdd ? .08 : .065, now + .012);
        gain.gain.exponentialRampToValueAtTime(.001, now + .12);

        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(now);
        oscillator.stop(now + .13);
    } catch {
        // El navegador puede bloquear audio; la venta debe continuar normalmente.
    }
}
