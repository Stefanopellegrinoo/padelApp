/**
 * `localStorage` detrás de un try/catch, que es el único lugar donde puede ir.
 *
 * `leerTorneo` valida el CONTENIDO; lo que tira acá es el ACCESO, y no es un
 * caso raro: en Safari iOS con cookies bloqueadas —o adentro del WebView de
 * Instagram o WhatsApp, que es por donde llega la mitad de los links— tocar
 * `localStorage` tira `SecurityError` y la pantalla entera se cae a
 * `app/error.tsx`, con un copy sobre torneos ajenos que no tiene nada que ver.
 * En Navegación Privada es peor porque es silencioso: leer anda y escribir
 * tira `QuotaExceededError`, así que la UI muestra el marcador cargado y no se
 * persiste nada.
 *
 * Por eso las dos funciones devuelven si se pudo en vez de tirar: sin storage
 * la pantalla funciona igual, en memoria, y avisa una vez.
 */

export interface Lectura {
  /** Lo guardado, o `null` si no había nada — o si no se pudo ni mirar. */
  valor: string | null
  /** `false` si el navegador ni siquiera deja leer. */
  disponible: boolean
}

export function leerGuardado(clave: string): Lectura {
  try {
    return { valor: localStorage.getItem(clave), disponible: true }
  } catch {
    return { valor: null, disponible: false }
  }
}

/**
 * Guarda, o borra si `valor` es `null` — borrar es la misma operación con la
 * misma forma de fallar, y separarlas duplicaba el try/catch sin ganar nada.
 * Devuelve `false` si el navegador no dejó.
 */
export function guardarEn(clave: string, valor: string | null): boolean {
  try {
    if (valor === null) localStorage.removeItem(clave)
    else localStorage.setItem(clave, valor)
    return true
  } catch {
    return false
  }
}
