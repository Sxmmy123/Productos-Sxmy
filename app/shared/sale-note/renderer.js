import { escapeHtml } from "../services/product-service.js";
import { formatMoney, formatSaleNumber } from "../services/sales-service.js";
import { getPreferences } from "../../modules/configuracion/preferences.js";
import { ticketWidth } from "../../modules/configuracion/preferences-domain.js";

function renderItems(items, width) {
    if (width) {
        return `<table class="note-table note-table-ticket" aria-label="Productos de la nota">
            <colgroup><col class="note-ticket-name-column"><col class="note-ticket-unit-column"><col class="note-ticket-quantity-column"><col class="note-ticket-total-column"></colgroup>
            <thead><tr><th scope="col">Nombre</th><th scope="col" aria-label="Precio unitario en Bs">Uni.</th><th scope="col" aria-label="Cantidad">Cant.</th><th scope="col" aria-label="Total en Bs">Total</th></tr></thead>
            <tbody>${items.map((item, index) => `<tr class="note-ticket-item">
                <td><div class="note-ticket-product-line">
                    <span class="note-item-number">${index + 1}.</span>
                    <div class="note-ticket-product">
                        <span class="note-item-description">${escapeHtml(item.nombre || "Producto")}</span>
                        <div class="note-ticket-item-meta"><span class="note-item-code">Cod. ${escapeHtml(item.codigo || "-")}</span></div>
                    </div>
                </div></td>
                <td class="note-ticket-unit-price">${formatMoney(item.precio)}</td>
                <td class="note-ticket-quantity">${escapeHtml(String(item.cantidad ?? ""))}</td>
                <td class="note-item-subtotal">${formatMoney(item.subtotal)}</td>
            </tr>`).join("")}</tbody>
        </table>`;
    }
    return `<table class="note-table">
        <colgroup><col class="note-number-column"><col class="note-code-column"><col><col class="note-money-column"><col class="note-quantity-column"><col class="note-total-column"></colgroup>
        <thead><tr><th scope="col">N</th><th scope="col">COD.</th><th scope="col">DETALLE</th><th scope="col">P. UNITARIO</th><th scope="col">CANT.</th><th scope="col">SUBTOTAL</th></tr></thead>
        <tbody>${items.map((item, index) => `<tr>
            <td>${index + 1}</td><td>${escapeHtml(item.codigo || "")}</td><td>${escapeHtml(item.nombre || "Producto")}</td>
            <td>${formatMoney(item.precio)} Bs</td><td>${escapeHtml(String(item.cantidad ?? ""))}</td><td>${formatMoney(item.subtotal)} Bs</td>
        </tr>`).join("")}</tbody>
    </table>`;
}

function preparePrintPage(area) {
    const width = ticketWidth(area.dataset.printFormat);
    let style = document.getElementById("salePrintPageStyle");
    if (!width) { style?.remove(); return; }
    const sample = area.querySelector(".note-ticket").cloneNode(true);
    sample.style.cssText += ";position:fixed;left:-10000px;top:0;visibility:hidden;display:block;";
    document.body.append(sample);
    const height = Math.max(35, Math.ceil(sample.getBoundingClientRect().height * 25.4 / 96) + 3);
    sample.remove();
    if (!style) { style = document.createElement("style"); style.id = "salePrintPageStyle"; document.head.append(style); }
    style.textContent = `@page sxmy-ticket { size: ${width}mm ${height}mm; margin: 0; }`;
}

function renderCustomer(sale) {
    const fields = [["Cliente", sale.cliente], ["Tel.", sale.telefono], ["Direccion", sale.direccion]];
    const details = fields.flatMap(([label, value]) => {
        const text = String(value || "").trim();
        if (!text || (label === "Cliente" && text.toLowerCase() === "cliente")) return [];
        return `<p><strong>${label}:</strong> <span>${escapeHtml(text)}</span></p>`;
    });
    return details.length ? `<div class="note-client">${details.join("")}</div>` : `<p class="note-walk-in">Venta al publico</p>`;
}

export function renderSaleNote(sale, salePrintArea, { format = getPreferences().printing.format } = {}) {
    const subtotal = Number(sale.subtotal ?? sale.total ?? 0);
    const discount = Number(sale.descuento || 0);
    const noteNumber = formatSaleNumber(sale.numero || sale.numeroVista);
    const fecha = escapeHtml(sale.fechaTexto || "");
    const items = Array.isArray(sale.items) ? sale.items : [];
    const width = ticketWidth(format);
    salePrintArea.classList.remove("hidden");
    salePrintArea.dataset.printFormat = width ? format : "letter";
    if (width) salePrintArea.style.setProperty("--ticket-width", `${width}mm`);
    else salePrintArea.style.removeProperty("--ticket-width");
    salePrintArea.innerHTML = `
        <div class="note-page${width ? " note-ticket" : ""}"${width ? ` data-ticket-width="${width}" style="--ticket-width:${width}mm"` : ""}>
            <header class="note-hero">
                <div class="note-brand">
                    <img class="note-logo" src="assets/icons/icon.svg" alt="" width="36" height="36">
                    <div><h1>Productos SXMY</h1><p>Electronica y robotica</p></div>
                </div>
                <h2 class="note-title">NOTA DE VENTA</h2>
            </header>
            <section class="note-details">
                ${renderCustomer(sale)}
                <div class="note-box">
                    <p class="note-reference"><span>${width ? "Nota" : "No. de nota"}</span><strong>${escapeHtml(noteNumber)}</strong></p>
                    ${fecha ? `<p class="note-date"><span>Fecha</span><span>${fecha}</span></p>` : ""}
                    ${sale.vendedorNombre ? `<p class="note-seller"><span>${width ? "Vendedor" : "Atendido por"}</span><span>${escapeHtml(sale.vendedorNombre)}</span></p>` : ""}
                </div>
            </section>
            ${renderItems(items, width)}
            <section class="note-summary">
                <div class="note-totals">
                    ${discount ? `<p><span>Subtotal</span><span>${formatMoney(subtotal)} Bs</span></p>
                    <p><span>Descuento</span><span>${formatMoney(discount)} Bs</span></p>` : ""}
                    <p class="note-pay"><strong>TOTAL</strong><span>${formatMoney(sale.total)} Bs</span></p>
                </div>
            </section>
            <footer class="note-footer">
                <p class="note-footer-item">
                    <span class="note-footer-icon note-whatsapp-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" role="img"><path d="M12.04 2.5a9.35 9.35 0 0 0-7.94 14.28L3 21.5l4.84-1.07A9.36 9.36 0 1 0 12.04 2.5Zm0 1.75a7.61 7.61 0 0 1 6.44 11.7 7.58 7.58 0 0 1-9.9 2.73l-.3-.16-2.8.62.63-2.72-.18-.31a7.6 7.6 0 0 1 6.11-11.86Zm-3.3 3.82c-.15 0-.4.06-.61.29-.21.23-.8.78-.8 1.9s.82 2.2.93 2.35c.12.15 1.58 2.54 3.9 3.45 1.93.76 2.33.61 2.75.57.42-.04 1.35-.55 1.54-1.08.19-.53.19-.99.13-1.08-.06-.1-.21-.15-.44-.27-.23-.11-1.35-.67-1.56-.74-.21-.08-.36-.12-.52.11-.15.23-.6.74-.73.89-.13.15-.27.17-.5.06-.23-.12-.97-.36-1.84-1.14-.68-.61-1.14-1.36-1.27-1.59-.13-.23-.01-.35.1-.47.1-.1.23-.27.34-.4.11-.13.15-.23.23-.38.08-.15.04-.29-.02-.4-.06-.11-.52-1.25-.71-1.71-.19-.44-.38-.38-.52-.39h-.45Z"/></svg>
                    </span>
                    <span>77755897</span>
                </p>
                <p class="note-footer-item">
                    <span class="note-footer-icon note-location-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" role="img"><path d="M12 2.75a7.1 7.1 0 0 0-7.1 7.1c0 4.68 5.76 10.63 6.01 10.88a1.52 1.52 0 0 0 2.18 0c.25-.25 6.01-6.2 6.01-10.88A7.1 7.1 0 0 0 12 2.75Zm0 9.6a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z"/></svg>
                    </span>
                    <span>${width === 58 ? "Caranavi<br>Frente Colegio Kennedy" : "Caranavi - Frente Colegio Kennedy"}</span>
                </p>
            </footer>
        </div>
    `;
    preparePrintPage(salePrintArea);
}

export function printSaleNote(sale, salePrintArea) {
    renderSaleNote(sale, salePrintArea);
    requestAnimationFrame(() => requestAnimationFrame(async () => {
        await Promise.allSettled([...salePrintArea.querySelectorAll("img")].map(image => image.decode()));
        window.print();
    }));
}
