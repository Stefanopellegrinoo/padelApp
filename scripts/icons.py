"""Genera los íconos de la PWA.

La marca es una cancha de pádel vista desde arriba: rectángulo, red al medio,
y las líneas de saque. Se eligió por encima de una letra porque a 60pt en la
pantalla de inicio una "P" es indistinguible de cualquier otra app, y la
silueta 2:1 de la cancha no.

Los colores salen de `app/globals.css` — el verde es `--color-accent` del tema
claro y las líneas son `--color-text` del oscuro. Si cambia la paleta, se
cambian acá y se corre `python3 scripts/icons.py`.

La marca ocupa el 58% del lienzo a propósito: los íconos se declaran
`any maskable`, y Android recorta hasta el 80% central. Con este margen el
mismo archivo sirve recortado y sin recortar.
"""

import os

from PIL import Image, ImageDraw

VERDE = (14, 92, 63)
LINEA = (234, 242, 238)
SALIDA = "public"

# Se dibuja UNA vez en grande y se reduce: PIL no antialiasea las líneas, así
# que el suavizado sale del `resize` con LANCZOS.
LIENZO = 2048


def raqueta() -> Image.Image:
    """La pala, de frente.

    La primera versión de esto era la cancha vista desde arriba y se leía como
    una ventana: la línea central de saque arma una grilla 2x2 que el ojo
    resuelve como marco antes que como cancha. La pala no tiene ese problema —
    óvalo corto con mango corto es una silueta que no se parece a nada más, y
    los agujeros la separan de una raqueta de tenis incluso borroneada.
    """
    img = Image.new("RGBA", (LIENZO, LIENZO), (*VERDE, 255))
    d = ImageDraw.Draw(img)

    grosor = int(LIENZO * 0.030)
    centro_x = LIENZO // 2

    # La cabeza: más alta que ancha, arriba del centro para dejar el mango.
    ancho = int(LIENZO * 0.40)
    alto = int(ancho * 1.15)
    x0, x1 = centro_x - ancho // 2, centro_x + ancho // 2
    y0 = int(LIENZO * 0.14)
    y1 = y0 + alto
    d.rounded_rectangle([x0, y0, x1, y1], radius=ancho // 2, outline=LINEA, width=grosor)

    # El corazón: dos brazos cortos que bajan de la cabeza al mango.
    mango_ancho = int(LIENZO * 0.105)
    mx0, mx1 = centro_x - mango_ancho // 2, centro_x + mango_ancho // 2
    cuello = int(LIENZO * 0.045)
    d.line([(mx0, y1 - grosor), (mx0, y1 + cuello)], fill=LINEA, width=grosor)
    d.line([(mx1, y1 - grosor), (mx1, y1 + cuello)], fill=LINEA, width=grosor)

    # El mango, macizo y LARGO: en la primera versión medía 0.09 del lienzo y a
    # tamaño chico se leía como una pelota debajo de la pala, no como agarre.
    d.rounded_rectangle(
        [mx0, y1 + cuello, mx1, int(LIENZO * 0.87)], radius=mango_ancho // 2, fill=LINEA
    )

    # Los agujeros. Es lo único que distingue una pala de una raqueta cualquiera
    # cuando el ícono mide 60pt, así que van grandes y pocos, no muchos y finos.
    radio = int(LIENZO * 0.026)
    paso_x = ancho // 4
    paso_y = alto // 5
    for fila in range(1, 5):
        cy = y0 + paso_y * fila
        for col in (-1, 0, 1):
            cx = centro_x + paso_x * col
            # Recorta las esquinas para que los agujeros sigan el óvalo.
            if fila in (1, 4) and col != 0:
                continue
            d.ellipse([cx - radio, cy - radio, cx + radio, cy + radio], fill=LINEA)

    return img


# Pantallas de arranque de iOS (`apple-touch-startup-image`). iOS no usa el
# `background_color` del manifest: sin estas imágenes, la app instalada queda
# en negro hasta que llega el HTML, y en un arranque en frío del servidor eso
# son segundos. Una por tamaño de iPhone en vertical (ancho y alto en puntos,
# densidad), en claro y en oscuro con el `--color-bg` de cada tema. Un iPhone
# nuevo que no esté acá vuelve al negro: se agrega su fila.
IPHONES = [
    (320, 568, 2), (375, 667, 2), (414, 736, 3), (375, 812, 3), (414, 896, 2),
    (414, 896, 3), (390, 844, 3), (428, 926, 3), (393, 852, 3), (430, 932, 3),
    (402, 874, 3), (440, 956, 3), (420, 912, 3),
]
FONDOS = {"light": (255, 255, 255), "dark": (13, 21, 18)}


def splash(base: Image.Image) -> None:
    os.makedirs(f"{SALIDA}/splash", exist_ok=True)
    lado = 0.28  # del ancho: el ícono de la pantalla de inicio, un poco más grande.
    for w, h, dpr in IPHONES:
        for tema, fondo in FONDOS.items():
            img = Image.new("RGB", (w * dpr, h * dpr), fondo)
            n = int(w * dpr * lado)
            icono = base.resize((n, n), Image.LANCZOS)
            mascara = Image.new("L", (n, n), 0)
            ImageDraw.Draw(mascara).rounded_rectangle([0, 0, n, n], radius=n // 4, fill=255)
            img.paste(icono, ((w * dpr - n) // 2, (h * dpr - n) // 2), mascara)
            img.save(f"{SALIDA}/splash/{w}x{h}@{dpr}-{tema}.png", optimize=True)


def main() -> None:
    base = raqueta()
    for size, nombre in [
        (192, f"{SALIDA}/icon-192.png"),
        (512, f"{SALIDA}/icon-512.png"),
        (180, "app/apple-icon.png"),
        (32, "app/icon.png"),
    ]:
        base.resize((size, size), Image.LANCZOS).save(nombre)
        print(f"  {nombre}  {size}x{size}")
    splash(base)
    print(f"  {SALIDA}/splash/  {len(IPHONES) * len(FONDOS)} pantallas de arranque")


if __name__ == "__main__":
    main()
