# Compras

Este modulo no utiliza Firebase Functions ni requiere Blaze. La conexion elegida es directa desde el navegador a OpenAI con una clave compartida que el administrador guarda en `configuracion_privada/openai`.

## Acceso

- Solo un perfil `usuarios/{uid}` con `rol: admin` y `activo: true` puede configurar o reemplazar la clave.
- Los perfiles activos `admin` y `cajero` pueden leer ese documento para interpretar listas.
- El catalogo publico no tiene acceso al documento ni a las compras.
- Las cuentas autorizadas pueden extraer la clave desde el navegador. Es una limitacion aceptada de esta modalidad, no un secreto oculto para esos usuarios.

## Activacion

1. Publicar `firebase/firestore.rules` con `firebase deploy --only firestore:rules --project sxmy-bd`.
2. Conservar el documento privado `configuracion_privada/openai` ya configurado. Compras lo utiliza automaticamente; no solicita registrar la clave al usuario.
3. La clave no se incluye en el repositorio, los borradores, el historial ni las preferencias del usuario. La lectura usa `getDocFromServer`.

El documento contiene `apiKey`, `model: gpt-6-luna`, `updatedByUid` y `updatedAt`. OpenAI tiene su propia facturacion y limites; no se activa facturacion de Firebase.

## Flujo

- Interpretar envia a la API Responses el texto y los IDs, codigos y nombres del catalogo. No envia precios internos, perfiles ni ventas. `store: false` evita guardar la respuesta como objeto recuperable en OpenAI; no reemplaza las politicas de retencion del proveedor.
- `openai-client.js` define el modelo, esquema estructurado y errores. La IA no tiene herramientas de escritura.
- Cuando un encabezado indica una cantidad y debajo aparecen variantes con sus propios precios, cada variante hereda esa cantidad y el producto base. Por ejemplo, 12 cautines con madera 240 y plastico 300 son dos filas de 12, a 20 y 25 Bs por unidad. No hace falta escribir unidades/u ni repetir Bs. Una cantidad propia de la variante prevalece; solo se reparte un total si la lista lo indica expresamente. Las instrucciones incluyen estos ejemplos, no un entrenamiento del modelo ni aprendizaje automatico desde el chat.
- `registration-domain.js` valida cantidades, importes, coincidencias y precios y calcula los totales en centavos.
- La opcion Usar unidades por paquete del historial consulta las compras registradas, con lectura paginada y cache temporal por usuario. `package-memory.js` compara producto, nombre y tipo de empaque: una coincidencia unica completa el campo marcado Del historial; tamanos o productos ambiguos ofrecen botones. AA, AAA y 18650 no se mezclan. Las cantidades escritas o editadas tienen prioridad. Es posible desactivar la memoria globalmente o quitar un dato de una fila. Solo Registrar compra guarda la cantidad revisada para proximos pedidos; interpretar no escribe memorias ni modifica inventario. No se envia el historial a OpenAI ni se requiere otra coleccion o cambio de reglas.
- La tabla muestra producto, cantidad, costo unitario y estado: Sin cambios, Producto nuevo, Subio precio o Bajo precio. Las diferencias llevan una flecha verde o roja junto al costo. No repite importes ni pide elegir el tipo de precio: el importe de la lista es total salvo que indique expresamente por unidad.
- Los nombres genericos o probables ofrecen botones con las variantes reales del inventario. Elegir una variante confirma su identidad y usa su nombre canonico. La lupa permite buscar otros productos sin mostrar etiquetas redundantes de vinculacion ni preguntas.
- Las subidas se seleccionan automaticamente y las bajadas son opcionales. La venta se conserva incluso si existe un valor antiguo en el borrador; solo el switch Cambiar precio de venta muestra y habilita ese campo. Ninguna seleccion escribe por si sola.
- Aplicar al inventario modifica solo los precios seleccionados, sin guardar una compra ni cambiar stock. Valida precios actuales dentro de la transaccion.
- Registrar producto abre un formulario sin imagen: la IA propone nombre corregido y descripcion, ambos editables; compra unitaria calculada y venta obligatoria con sugerencia opcional basada en los margenes del catalogo. Las interpretaciones nuevas incluyen estos datos; los borradores anteriores los generan al abrir el formulario, sin crear aun el producto. No se inventan especificaciones. El codigo se asigna sin sobrescribir un producto existente.
- Registrar compra guarda solo la lista revisada, cantidades, costos, total y texto original. Ignora cualquier seleccion de inventario. Las coincidencias no confirmadas pueden archivarse sin vincularlas a un producto.
- Cada operacion tiene un ID estable. Las modificaciones y creaciones guardan una constancia privada en `compras_operaciones` para comprobar reintentos sin duplicar productos ni historial de precios. Los borradores congelan las operaciones cuyo resultado aun no se puede confirmar.
- Las reglas permiten crear compras a cuentas activas, pero no editar ni borrar las compras registradas. La validacion aritmetica de cada fila se ejecuta en el cliente: las reglas de Firestore no constituyen un validador completo de toda la tabla.

`domain.js` y `controller.js` mantienen la tabla, confirmaciones, borradores por UID, historial y revision de coincidencias. El funcionamiento no depende de servicios de Cloud Functions.
