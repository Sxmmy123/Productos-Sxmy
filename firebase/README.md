# Configuracion de las mejoras

El codigo local incluye ventas atomicas, indices del historial y la funcion `updateCashier`. Estos archivos no modifican el proyecto remoto por si solos.

## Administrador

Antes de publicar las reglas, verifica en Firestore que tu usuario administrador tenga un documento `usuarios/<UID>` con:

```json
{ "uid": "TU_UID", "nombre": "Administrador", "email": "TU_CORREO", "rol": "admin", "activo": true }
```

Usa el UID real de Authentication. Los cajeros conservan `rol: "cajero"` y `activo: true`. No publiques las reglas antes de completar este documento, porque requieren un perfil activo para entrar a los datos internos. Conserva cualquier regla de otras colecciones que utilices al integrar este archivo.

## Publicacion

Desde la carpeta del proyecto, con Firebase CLI autenticada:

```powershell
firebase deploy --only functions:updateCashier,firestore --project sxmy-bd
```

La funcion utiliza Node.js 22 y la region `us-central1`. La instalacion de dependencias esta en `functions/`. El proyecto de Firebase debe permitir desplegar Cloud Functions. Los indices pueden tardar en quedar disponibles; el historial muestra un aviso mientras tanto.

## Ventas y stock

- La coleccion `contadores` contiene el documento `ventas` con `ultimoNumero`, `numero` y `notaId`.
- La primera venta inicializa el contador a partir de las notas existentes; no borres ni reinicies ese documento.
- Una transaccion registra la nota y descuenta el stock actual. Si un producto esta agotado o cambio su precio, se conserva la orden para revisarla.
- `requestId` se guarda con el borrador y es el ID del documento de venta. Reintentar una orden confirmada devuelve la misma nota.
- El stock vacio sigue siendo opcional y no se descuenta.

## Cajeros

Editar solo el nombre actualiza su perfil. Cambiar el correo llama a `updateCashier`, que verifica el rol administrador y actualiza Authentication y el perfil. Las notas antiguas conservan los datos del vendedor con los que fueron emitidas.

## PWA

Los borradores se guardan por usuario en el dispositivo. Una orden pendiente no es una venta registrada. Sin conexion se puede mantener la orden, pero no confirmar una venta. La actualizacion de la PWA solicita pulsar `Actualizar`, conserva el borrador y espera si hay una venta en curso.

## Configuracion personal

El modal del sidebar guarda tema, menu, sonidos, Pushbuy, vistas/filtros de Productos y formato de impresion por UID, en `localStorage` y en `usuarios/<UID>/preferencias/interfaz`. Solo el propietario puede leer o escribir su configuracion; estas preferencias no cambian el rol ni los permisos del usuario. Publica la regla de esa subcoleccion para habilitar la sincronizacion entre dispositivos. Mientras falten los permisos o no haya conexion, se conserva la configuracion local y el modal muestra su estado.

Los formatos disponibles son Carta, Ticket 80 mm y Ticket 58 mm. Comparten encabezado con logo y titulo, una franja gris con datos del cliente y de la nota, tabla azul con filas alternadas y total alineado a la derecha. Solo aparecen los datos del cliente que se hayan completado; no se imprime el metodo de pago y las lineas de subtotal y descuento aparecen cuando hay descuento. El vendedor aparece una sola vez junto al numero y la fecha; el pie conserva WhatsApp y ubicacion. Los tickets adaptan cada producto a dos filas, conservan codigo y numeracion y ajustan la altura al contenido. Selecciona tambien el papel correcto en el controlador de la impresora. El navegador no puede seleccionar automaticamente una impresora ni cambiar sus ajustes fisicos. La reimpresion desde Historial utiliza el formato del usuario actual, sin modificar la venta guardada.

## Compras

Compras esta disponible para administrador y cajeros activos sin Firebase Functions ni Blaze. Publica las reglas de `compras`, `compras_aliases`, `compras_operaciones` y `configuracion_privada/openai`. Registrar compra guarda solo la lista revisada; Aplicar al inventario y Crear producto son acciones separadas, con constancias idempotentes en `compras_operaciones`. No se cambia stock. Interpretar lista consulta directamente a GPT-6 Luna y no realiza escrituras.

La clave ya configurada se utiliza automaticamente, sin pedirla en Compras. Solo admin puede escribirla y admin/cajeros activos pueden leerla. No puede ocultarse a esas cuentas cuando la usan en el navegador; el publico no tiene acceso. No se incluye en el codigo ni en las preferencias. Consulta [app/modules/compras/README.md](../app/modules/compras/README.md).

## Verificacion

```powershell
npm test
npm run test:rules
```

`npm test` simula concurrencia y fallos de escritura. `npm run test:rules` requiere Firebase CLI y Java 21 o superior; inicia los emuladores locales de Authentication y Firestore para el proyecto ficticio `demo-sxmy-rules` y los detiene al terminar. Comprueba ventas de admin/cajero, contador, stock y rechazos de usuarios no autorizados; no utiliza `sxmy-bd` ni modifica datos reales.

Las validaciones de la nota acceden a `getAfter(...).data.numero` y `getAfter(...).data.notaId`. `getAfter` devuelve un recurso, no directamente sus campos. Despues de publicar, valida una venta controlada y un cambio de correo con una cuenta de prueba para comprobar permisos e indices reales.

Referencias: [transacciones de Firestore](https://firebase.google.com/docs/firestore/manage-data/transactions), [funciones callable](https://firebase.google.com/docs/functions/callable), [administracion de usuarios](https://firebase.google.com/docs/auth/admin/manage-users).
