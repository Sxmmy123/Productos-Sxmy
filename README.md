# Productos SXMY

Catalogo publico y panel de ventas para Productos SXMY. Es una aplicacion web estatica con Firebase y soporte PWA; no requiere un proceso de compilacion.

## Entradas

- `index.html`: catalogo publico para clientes.
- `login.html`: acceso de administradores y cajeros.
- `admin.html`: aplicacion interna. Sus rutas son `#productos`, `#historial`, `#analisis`, `#tienda`, `#compras` y `#cajeros`.

## Estructura

```text
app/
  core/                  Arranque, navegacion, rutas, estado y PWA
  modules/               Funcionalidad separada por pantalla
    catalogo/            Tienda publica
    login/               Inicio de sesion
    productos/           Inventario e importacion CSV
    historial/           Notas de venta
    analisis/             Estadisticas de ventas
    tienda/              Venta para admin y cajero
    cajeros/              Administracion de usuarios
    compras/              Interpretacion, revision y registro de compras
    configuracion/       Modal y preferencias personales por usuario
  shared/                Codigo reutilizable entre modulos
    catalog/             Utilidades y layout del catalogo
    firebase/            Configuracion de Firebase
    sale-note/           Generador e impresion de notas
    services/            Acceso a productos, ventas y usuarios
    styles/              Capas visuales compartidas
    theme/               Tema claro y oscuro
assets/                  Iconos, imagenes y recursos de la PWA
data/importaciones/       Archivos CSV para carga de productos
functions/                Operaciones privadas para cambiar correo de cajeros
firebase/                 Reglas, indices e instrucciones de despliegue
tests/                    Pruebas de ventas, stock, analisis, cajeros y preferencias
```

Cada modulo interno conserva su HTML en `view.html`, su comportamiento en `controller.js` y, cuando corresponde, estilos propios. `app/core/panel-app.js` carga estos recursos solo cuando se abre el modulo.

## Ejecucion local

Sirve la carpeta con un servidor HTTP y abre:

```text
http://127.0.0.1:5500/index.html
```

No abras los HTML directamente desde el explorador: los modulos dinamicos y el service worker necesitan HTTP.

## Reglas de mantenimiento

1. Agrega funcionalidad nueva dentro de `app/modules/<modulo>/`.
2. Mueve a `app/shared/` solo lo que realmente utilicen dos o mas modulos.
3. Mantiene `admin.html` como contenedor; no vuelvas a colocar ahi el contenido completo de las pantallas.
4. Centraliza las lecturas y escrituras de Firebase en `app/shared/services/`.
5. Al agregar o mover un recurso necesario sin conexion, incluyelo en `APP_SHELL` y cambia la version de cache en `service-worker.js`.

## Roles

- Publico: consulta el catalogo.
- Cajero: productos, historial, analisis, tienda y compras.
- Administrador: todas las funciones anteriores y administracion de cajeros.

## Mejoras y puesta en marcha

Las ventas registran nota y stock en una transaccion y conservan un identificador al reintentarse. El historial carga paginas de 25 ventas. El analisis permite elegir fechas y distribuye los descuentos entre productos. El stock minimo es opcional.

Los colores de ambos temas se definen en `app/shared/styles/tokens.css`; controles y estados comunes, en `components.css`. Historial, Analisis y Carrito tienen estilos propios en sus modulos.

El boton Configuracion del sidebar abre las preferencias de General, Productos e Impresion. Se guardan por usuario y se sincronizan con su subcoleccion privada de Firebase. La impresion admite Carta y tickets de 58/80 mm, tambien al reimprimir desde Historial.

Consulta [firebase/README.md](firebase/README.md) para preparar el perfil administrador y publicar reglas, indices y la funcion de cambio de correo. Ejecuta `npm test` para las pruebas locales.

## Compras

`admin.html#compras` permite pegar una lista o cargar TXT, interpretarla con IA, ajustar una tabla editable y registrar lo comprado. Los nombres incompletos se especifican con botones de variantes; las cantidades ausentes quedan vacias, sin preguntas ni datos inventados. Nada se registra sin pulsar el boton correspondiente.

La tabla compara solo el costo unitario, sin duplicar importes: Sin cambios, Producto nuevo, Subio precio o Bajo precio, con diferencias verdes o rojas junto al costo. Los nombres genericos ofrecen botones para elegir variantes reales del inventario. Las subidas quedan seleccionadas por defecto y las bajadas son opcionales. Aplicar al inventario actualiza los costos seleccionados; la venta se conserva salvo que se active su switch. Los productos nuevos se registran expresamente sin imagen, con nombre y descripcion propuestos por IA y editables, y venta elegida por el usuario. No se modifica stock.

Registrar compra guarda exclusivamente la lista, cantidades, costos y total, sin modificar el inventario. Los alias confirmados se recuerdan al registrar. Los reintentos de registro, actualizacion y creacion conservan sus propios identificadores para evitar duplicados. El historial es inmutable y carga paginas de 20 registros.

Compras no necesita Firebase Functions ni Blaze. Utiliza automaticamente la clave ya guardada en `configuracion_privada/openai`; no muestra un formulario de API. Solo admin/cajeros activos pueden leerla y solo admin puede reemplazarla. Las cuentas autorizadas pueden extraerla del navegador; esta modalidad se eligio para uso familiar. No se guarda en el repositorio ni en borradores o preferencias. Consulta [app/modules/compras/README.md](app/modules/compras/README.md).
