import { useMemo, useRef, useState } from "react";
import { Search, Lock, X, Delete, ShieldCheck, Trash2 } from "lucide-react";

/**
 * Prototipo autocontenido (datos simulados) — todavía no está conectado al
 * backend real de cotizaciones. Sirve para validar el flujo de búsqueda de
 * productos y el control de roles sobre descuentos antes de integrarlo.
 */

type Producto = {
  codigo: string;
  nombre: string;
  precio: number;
};

type FilaCotizacion = {
  id: string;
  producto: Producto;
  cantidad: number;
  descuentoPct: number;
};

type Rol = "VENDEDOR" | "CAJERO" | "ADMINISTRADOR";

const LIMITE_DESCUENTO_SIN_AUTORIZACION = 10;
const PIN_ADMINISTRADOR = "1234";

const mockProducts: Producto[] = [
  { codigo: "P-001", nombre: "Cemento Sol 42.5kg", precio: 28.5 },
  { codigo: "P-002", nombre: "Fierro corrugado 1/2\"", precio: 34.0 },
  { codigo: "P-003", nombre: "Pintura látex blanco 1gl", precio: 52.0 },
  { codigo: "P-004", nombre: "Tubo PVC 4\" x 3m", precio: 41.9 },
  { codigo: "P-005", nombre: "Taladro percutor 750W", precio: 289.0 },
  { codigo: "P-006", nombre: "Clavos 2\" (kg)", precio: 6.5 },
  { codigo: "P-007", nombre: "Lija de agua N°80", precio: 2.3 },
];

function money(n: number) {
  return "S/ " + n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function calcularSubtotal(fila: FilaCotizacion) {
  return fila.producto.precio * fila.cantidad * (1 - fila.descuentoPct / 100);
}

type PendingOverride = { filaId: string; valorIntentado: number };

export default function CotizacionForm() {
  const [userRole] = useState<Rol>("VENDEDOR");
  const [filas, setFilas] = useState<FilaCotizacion[]>([]);
  const [query, setQuery] = useState("");
  const [dropdownAbierto, setDropdownAbierto] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [pendingOverride, setPendingOverride] = useState<PendingOverride | null>(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);

  const rolRestringido = userRole === "VENDEDOR" || userRole === "CAJERO";

  const resultados = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return mockProducts.filter(
      (p) => p.nombre.toLowerCase().includes(q) || p.codigo.toLowerCase().includes(q)
    );
  }, [query]);

  function mostrarToast(mensaje: string) {
    setToast(mensaje);
    if (toastTimeout.current) clearTimeout(toastTimeout.current);
    toastTimeout.current = setTimeout(() => setToast(null), 3500);
  }

  function agregarProducto(producto: Producto) {
    setFilas((prev) => [
      ...prev,
      { id: crypto.randomUUID(), producto, cantidad: 1, descuentoPct: 0 },
    ]);
    setQuery("");
    setDropdownAbierto(false);
  }

  function quitarFila(id: string) {
    setFilas((prev) => prev.filter((f) => f.id !== id));
  }

  function actualizarCantidad(id: string, cantidad: number) {
    setFilas((prev) => prev.map((f) => (f.id === id ? { ...f, cantidad: Math.max(1, cantidad) } : f)));
  }

  function aplicarDescuento(id: string, valor: number) {
    setFilas((prev) => prev.map((f) => (f.id === id ? { ...f, descuentoPct: valor } : f)));
  }

  function onCambioDescuento(id: string, rawValue: string) {
    const valor = Number(rawValue);
    if (!Number.isFinite(valor)) return;

    // Límite estricto: un VENDEDOR o CAJERO no puede aplicar más de 10% de
    // descuento sin que un administrador autorice con su PIN.
    if (rolRestringido && valor > LIMITE_DESCUENTO_SIN_AUTORIZACION) {
      mostrarToast("Límite excedido. Requiere autorización del Administrador.");
      setPendingOverride({ filaId: id, valorIntentado: valor });
      setPin("");
      setPinError(false);
      return;
    }

    aplicarDescuento(id, valor);
  }

  function cerrarModalPin() {
    setPendingOverride(null);
    setPin("");
    setPinError(false);
  }

  function autorizarPin() {
    if (!pendingOverride) return;
    if (pin !== PIN_ADMINISTRADOR) {
      setPinError(true);
      return;
    }
    aplicarDescuento(pendingOverride.filaId, pendingOverride.valorIntentado);
    mostrarToast("Descuento autorizado por el administrador.");
    cerrarModalPin();
  }

  function presionarDigito(d: string) {
    setPinError(false);
    setPin((prev) => (prev.length >= 4 ? prev : prev + d));
  }

  const total = filas.reduce((sum, f) => sum + calcularSubtotal(f), 0);

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="text-xl font-bold text-slate-800">Nueva cotización</h1>
      <p className="mt-1 text-sm text-slate-500">
        Rol actual: <span className="font-semibold text-slate-700">{userRole}</span>
        {rolRestringido && (
          <span className="ml-2 inline-flex items-center gap-1 text-xs text-amber-700">
            <Lock size={11} /> descuentos por encima de {LIMITE_DESCUENTO_SIN_AUTORIZACION}% requieren autorización
          </span>
        )}
      </p>

      {/* Buscador de productos */}
      <div className="relative mt-5">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setDropdownAbierto(true);
          }}
          onFocus={() => setDropdownAbierto(true)}
          onBlur={() => setTimeout(() => setDropdownAbierto(false), 120)}
          placeholder="Buscar producto por código o nombre…"
          className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-800 placeholder-slate-400 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
        />
        {dropdownAbierto && query.trim() && (
          <div className="absolute z-20 mt-1.5 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
            {resultados.length === 0 ? (
              <div className="px-4 py-3 text-sm text-slate-400">Sin coincidencias para "{query}".</div>
            ) : (
              resultados.map((p) => (
                <button
                  key={p.codigo}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => agregarProducto(p)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-blue-50"
                >
                  <span className="truncate">
                    <span className="font-bold text-slate-800">{p.codigo}</span>{" "}
                    <span className="text-slate-600">{p.nombre}</span>
                  </span>
                  <span className="flex-none font-medium text-slate-500">{money(p.precio)}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Tabla de cotización */}
      <div className="mt-5 overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5 font-medium">Producto</th>
              <th className="px-4 py-2.5 font-medium">Cantidad</th>
              <th className="px-4 py-2.5 font-medium">Precio u.</th>
              <th className="px-4 py-2.5 font-medium">% Desc.</th>
              <th className="px-4 py-2.5 text-right font-medium">Subtotal</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filas.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-400">
                  Busca un producto arriba para agregarlo a la cotización.
                </td>
              </tr>
            )}
            {filas.map((f) => (
              <tr key={f.id}>
                <td className="px-4 py-2.5">
                  <p className="font-medium text-slate-800">{f.producto.nombre}</p>
                  <p className="text-xs text-slate-400">{f.producto.codigo}</p>
                </td>
                <td className="px-4 py-2.5">
                  <input
                    type="number"
                    min={1}
                    value={f.cantidad}
                    onChange={(e) => actualizarCantidad(f.id, Number(e.target.value))}
                    className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:border-blue-600"
                  />
                </td>
                <td className="px-4 py-2.5 text-slate-600">{money(f.producto.precio)}</td>
                <td className="px-4 py-2.5">
                  <div className="relative w-20">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={f.descuentoPct}
                      onChange={(e) => onCambioDescuento(f.id, e.target.value)}
                      className={
                        "w-full rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:border-blue-600" +
                        (rolRestringido ? " pl-6" : "")
                      }
                    />
                    {rolRestringido && (
                      <Lock size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                    )}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right font-medium text-slate-800">{money(calcularSubtotal(f))}</td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => quitarFila(f.id)}
                    title="Quitar"
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 text-right text-base">
        Total: <span className="font-bold text-slate-800">{money(total)}</span>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}

      {/* Modal de autorización (PIN de administrador) */}
      {pendingOverride && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
          <div className="w-full max-w-xs rounded-2xl border border-slate-700 bg-slate-900 p-6 text-white shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck size={18} className="text-amber-400" />
                <h2 className="text-sm font-bold">Autorización requerida</h2>
              </div>
              <button
                type="button"
                onClick={cerrarModalPin}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                aria-label="Cerrar"
              >
                <X size={16} />
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Descuento de {pendingOverride.valorIntentado}% supera el límite de {LIMITE_DESCUENTO_SIN_AUTORIZACION}% para tu rol.
              Ingresa el PIN de administrador para continuar.
            </p>

            <div className="mt-4 flex justify-center gap-2.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <span
                  key={i}
                  className={
                    "h-3 w-3 rounded-full border border-slate-600 " + (i < pin.length ? "bg-amber-400 border-amber-400" : "bg-transparent")
                  }
                />
              ))}
            </div>
            {pinError && <p className="mt-2 text-center text-xs font-medium text-red-400">PIN incorrecto — intenta de nuevo.</p>}

            <div className="mt-5 grid grid-cols-3 gap-2.5">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => presionarDigito(d)}
                  className="rounded-xl bg-slate-800 py-3.5 text-lg font-semibold text-white hover:bg-slate-700 active:bg-slate-600"
                >
                  {d}
                </button>
              ))}
              <button
                type="button"
                onClick={() => { setPin(""); setPinError(false); }}
                className="rounded-xl bg-slate-800 py-3.5 text-xs font-semibold text-slate-400 hover:bg-slate-700"
              >
                Borrar
              </button>
              <button
                type="button"
                onClick={() => presionarDigito("0")}
                className="rounded-xl bg-slate-800 py-3.5 text-lg font-semibold text-white hover:bg-slate-700 active:bg-slate-600"
              >
                0
              </button>
              <button
                type="button"
                onClick={() => setPin((prev) => prev.slice(0, -1))}
                className="flex items-center justify-center rounded-xl bg-slate-800 py-3.5 text-white hover:bg-slate-700"
                aria-label="Borrar último dígito"
              >
                <Delete size={16} />
              </button>
            </div>

            <div className="mt-5 flex gap-2.5">
              <button
                type="button"
                onClick={cerrarModalPin}
                className="flex-1 rounded-xl border border-slate-700 py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={autorizarPin}
                disabled={pin.length < 4}
                className="flex-1 rounded-xl bg-amber-500 py-2.5 text-sm font-bold text-slate-900 hover:bg-amber-400 disabled:opacity-40"
              >
                Autorizar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
