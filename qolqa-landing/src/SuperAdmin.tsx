import { useEffect, useRef, useState } from "react";
import {
  LayoutDashboard,
  Building2,
  CreditCard,
  Settings,
  Menu,
  X,
  TrendingUp,
  Clock,
  Eye,
  Ban,
  RotateCcw,
  Wallet,
  Users,
  LogOut,
  Loader2,
  Zap,
  KeyRound,
  Pencil,
  Copy,
  Check,
  AlertTriangle,
  DollarSign,
  Search,
  FileText,
  UserPlus,
  Lock,
  Unlock,
  Trash2,
  ScrollText,
  ShieldCheck,
  Tag,
  ChevronDown,
} from "lucide-react";
import { ADMIN_TOKEN_KEY, ADMIN_USUARIO_KEY } from "./Login";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000/api/v1";

type EstadoSuscripcion = "trial" | "activo" | "vencido" | "suspendido";
type PlanPagado = "emprendedor" | "negocios" | "empresarial";
type PlanId = "trial" | PlanPagado;

type Empresa = {
  id: string;
  ruc: string;
  razon_social: string;
  nombre_comercial: string | null;
  correo: string | null;
  telefono: string | null;
  direccion: string | null;
  plan: PlanId;
  estado_suscripcion: EstadoSuscripcion;
  suscripcion_vencimiento: string | null;
  limite_usuarios: number | null;
  estado: string;
  creado_en: string;
  usuarios_activos: number;
};

type Metricas = {
  mrr: number;
  total_empresas: number;
  por_estado: Record<EstadoSuscripcion, number>;
};

type MetodoPago = "yape" | "plin" | "transferencia" | "efectivo";

const METODO_PAGO_LABEL: Record<MetodoPago, string> = {
  yape: "Yape",
  plin: "Plin",
  transferencia: "Transferencia BCP",
  efectivo: "Efectivo",
};

type Pago = {
  id: string;
  plan: PlanId;
  monto: string;
  dias_agregados: number;
  metodo_pago: MetodoPago | null;
  creado_en: string;
};

type PagoGlobal = Pago & {
  company_id: string;
  ruc: string;
  razon_social: string;
  nombre_comercial: string | null;
};

type ComprobantePago = {
  id: string;
  archivo_nombre: string;
  archivo_tipo: string;
  monto_declarado: string;
  plan_declarado: PlanId;
  metodo_pago: MetodoPago | null;
  estado: "pendiente" | "aprobado" | "rechazado";
  motivo_rechazo: string | null;
  creado_en: string;
  revisado_en: string | null;
  company_id: string;
  ruc: string;
  razon_social: string;
  nombre_comercial: string | null;
};

type EstadoNubefact = {
  configurado: boolean;
  existe_en_ventas: boolean;
  nubefact_ruta?: string | null;
};

type UsuarioStaff = {
  id: string;
  nombre: string;
  email: string;
  rol: string;
  activo: boolean;
};

const ROL_LABEL: Record<string, string> = {
  admin: "Admin",
  vendedor: "Vendedor",
  cajero: "Cajero",
  contador: "Contador",
};

type Vista = "dashboard" | "empresas" | "pagos" | "planes" | "alertas" | "auditoria" | "roles" | "configuracion";

const NAV_ITEMS: { vista: Vista; label: string; icon: typeof LayoutDashboard }[] = [
  { vista: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { vista: "empresas", label: "Empresas (Suscriptores)", icon: Building2 },
  { vista: "pagos", label: "Pagos y Facturación", icon: CreditCard },
  { vista: "planes", label: "Planes", icon: Tag },
  { vista: "alertas", label: "Alertas SUNAT", icon: AlertTriangle },
  { vista: "auditoria", label: "Auditoría", icon: ScrollText },
  { vista: "roles", label: "Roles y permisos", icon: ShieldCheck },
  { vista: "configuracion", label: "Configuración", icon: Settings },
];

const PLAN_LABEL: Record<PlanId, string> = {
  trial: "Trial",
  emprendedor: "Emprendedor",
  negocios: "Negocios",
  empresarial: "Empresarial",
};

const PRECIO_MENSUAL_PLAN: Record<PlanPagado, number> = {
  emprendedor: 39,
  negocios: 79,
  empresarial: 149,
};

const ESTADO_BADGE: Record<EstadoSuscripcion, { label: string; className: string }> = {
  activo: { label: "Activo", className: "bg-green-100 text-green-700" },
  trial: { label: "Trial", className: "bg-orange-100 text-orange-700" },
  vencido: { label: "Vencido", className: "bg-red-100 text-red-700" },
  suspendido: { label: "Suspendido", className: "bg-slate-200 text-slate-600" },
};

function formatFecha(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" });
}

function addDays(iso: string | null, days: number) {
  const base = iso && new Date(iso) > new Date() ? new Date(iso) : new Date();
  base.setDate(base.getDate() + days);
  return base.toISOString();
}

/** Días de diferencia entre hoy y el vencimiento (negativo si ya pasó),
 * redondeado a días completos usando solo la fecha (sin horas) para que
 * "vence hoy" siempre dé 0, no -0.4. */
function diasRestantes(iso: string | null): number | null {
  if (!iso) return null;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const venc = new Date(iso);
  venc.setHours(0, 0, 0, 0);
  return Math.round((venc.getTime() - hoy.getTime()) / 86400000);
}

function textoVencimiento(dias: number): { texto: string; className: string } {
  if (dias < 0) {
    return {
      texto: `Vencido hace ${Math.abs(dias)} día${Math.abs(dias) === 1 ? "" : "s"} — cobrar ahora`,
      className: "text-red-600",
    };
  }
  if (dias === 0) return { texto: "Vence hoy — cobrar ahora", className: "text-red-600" };
  if (dias <= 2) return { texto: `Vence en ${dias} día${dias === 1 ? "" : "s"}`, className: "text-amber-600" };
  return { texto: `Vence en ${dias} días`, className: "text-slate-400" };
}

function Sidebar({
  vistaActiva,
  onNavegar,
  mobileOpen,
  onClose,
  onLogout,
  badges,
}: {
  vistaActiva: Vista;
  onNavegar: (vista: Vista) => void;
  mobileOpen: boolean;
  onClose: () => void;
  onLogout: () => void;
  badges?: Partial<Record<Vista, number>>;
}) {
  const content = (
    <div className="flex h-full flex-col bg-slate-900 text-slate-300">
      <div className="flex items-center gap-2 border-b border-slate-800 px-6 py-5">
        <img src="/logo-facturapos-dark.png" alt="FacturasPOS" className="h-9 w-auto object-contain" />
        <span className="text-sm font-semibold text-white">Super Admin</span>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-6">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.vista}
            onClick={() => {
              onNavegar(item.vista);
              onClose();
            }}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
              item.vista === vistaActiva ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-white"
            }`}
          >
            <item.icon className="h-5 w-5" />
            <span className="flex-1 text-left">{item.label}</span>
            {!!badges?.[item.vista] && (
              <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {badges[item.vista]}
              </span>
            )}
          </button>
        ))}
      </nav>
      <div className="border-t border-slate-800 px-3 py-4">
        <button
          onClick={onLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          <LogOut className="h-5 w-5" />
          Cerrar sesión
        </button>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden w-64 flex-shrink-0 lg:block">{content}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={onClose} />
          <div className="absolute inset-y-0 left-0 w-64">
            <div className="flex justify-end p-3">
              <button onClick={onClose} aria-label="Cerrar menú" className="text-slate-300 hover:text-white">
                <X className="h-6 w-6" />
              </button>
            </div>
            <div className="h-[calc(100%-3.5rem)]">{content}</div>
          </div>
        </div>
      )}
    </>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof TrendingUp;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
          <Icon className="h-5 w-5" />
        </div>
        <span className="text-sm font-medium text-slate-500">{label}</span>
      </div>
      <p className="mt-4 text-2xl font-bold text-slate-800">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

/** Empresas que necesitan cobro ya (vencidas) o pronto (2 días o menos),
 * para que el super admin no tenga que revisar fila por fila la tabla
 * completa buscando cuál se le está por vencer. */
function AlertasCobro({
  empresas,
  onRegistrarPago,
  onVerDetalle,
}: {
  empresas: Empresa[];
  onRegistrarPago: (id: string) => void;
  onVerDetalle: (id: string) => void;
}) {
  const relevantes = empresas
    .filter((e) => e.estado_suscripcion !== "suspendido" && e.suscripcion_vencimiento)
    .map((e) => ({ empresa: e, dias: diasRestantes(e.suscripcion_vencimiento) as number }))
    .filter(({ dias }) => dias <= 2)
    .sort((a, b) => a.dias - b.dias);

  if (relevantes.length === 0) return null;

  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-amber-200 bg-amber-50">
      <div className="flex items-center gap-2 border-b border-amber-200 px-5 py-3">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        <h2 className="text-sm font-semibold text-amber-800">
          {relevantes.length} empresa{relevantes.length === 1 ? "" : "s"} necesita{relevantes.length === 1 ? "" : "n"} cobro
        </h2>
      </div>
      <ul className="divide-y divide-amber-100">
        {relevantes.map(({ empresa: e, dias }) => {
          const { texto, className } = textoVencimiento(dias);
          return (
            <li key={e.id} className="flex items-center justify-between gap-4 px-5 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">
                  {e.nombre_comercial || e.razon_social}
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    {PLAN_LABEL[e.plan]}
                  </span>
                </p>
                <p className={`text-xs font-semibold ${className}`}>{texto}</p>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                <button
                  onClick={() => onVerDetalle(e.id)}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-amber-100"
                >
                  Ver
                </button>
                <button
                  onClick={() => onRegistrarPago(e.id)}
                  className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
                >
                  Registrar pago
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Bandeja de comprobantes que las empresas subieron desde su propio
 * sistema de ventas (ver renderMiPlan en el dashboard) declarando que ya
 * pagaron — aprobar aquí es lo que de verdad activa el plan por 30 días. */
function ComprobantesPendientesCard({
  comprobantes,
  cargando,
  procesando,
  onVer,
  onAprobar,
  onRechazar,
}: {
  comprobantes: ComprobantePago[] | null;
  cargando: boolean;
  procesando: string | null;
  onVer: (id: string) => void;
  onAprobar: (id: string) => void;
  onRechazar: (id: string) => void;
}) {
  if (cargando) {
    return (
      <div className="mb-8 flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Cargando comprobantes…
      </div>
    );
  }

  const lista = comprobantes || [];

  return (
    <div className="mb-8 overflow-hidden rounded-xl border border-amber-200 bg-amber-50">
      <div className="flex items-center gap-2 border-b border-amber-200 px-6 py-3">
        <FileText className="h-4 w-4 text-amber-600" />
        <h2 className="text-sm font-semibold text-amber-800">
          {lista.length} comprobante{lista.length === 1 ? "" : "s"} por revisar
        </h2>
      </div>
      {lista.length === 0 ? (
        <p className="px-6 py-4 text-sm text-slate-500">No hay comprobantes pendientes de revisión.</p>
      ) : (
        <ul className="divide-y divide-amber-100">
          {lista.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">
                  {c.nombre_comercial || c.razon_social}
                  <span className="ml-2 text-xs font-normal text-slate-400">RUC {c.ruc}</span>
                </p>
                <p className="text-xs text-slate-500">
                  S/ {Number(c.monto_declarado).toFixed(2)} · {PLAN_LABEL[c.plan_declarado]}
                  {c.metodo_pago ? ` · ${METODO_PAGO_LABEL[c.metodo_pago]}` : ""} · {formatFecha(c.creado_en)}
                </p>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                <button
                  onClick={() => onVer(c.id)}
                  className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-amber-100"
                >
                  <Eye className="h-3.5 w-3.5" /> Ver
                </button>
                <button
                  onClick={() => onRechazar(c.id)}
                  disabled={procesando === c.id}
                  className="flex items-center gap-1 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
                >
                  <X className="h-3.5 w-3.5" /> Rechazar
                </button>
                <button
                  onClick={() => onAprobar(c.id)}
                  disabled={procesando === c.id}
                  className="flex items-center gap-1 rounded-lg bg-green-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-800 disabled:opacity-60"
                >
                  {procesando === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Aprobar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PagosGlobalView({ pagos, cargando }: { pagos: PagoGlobal[] | null; cargando: boolean }) {
  if (cargando) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Cargando pagos…
      </div>
    );
  }

  const total = (pagos || []).reduce((sum, p) => sum + Number(p.monto), 0);

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <MetricCard
          icon={Wallet}
          label="Total cobrado (últimos 200 pagos)"
          value={`S/ ${total.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          hint="Suma de los pagos manuales registrados"
        />
        <MetricCard
          icon={CreditCard}
          label="Pagos registrados"
          value={String((pagos || []).length)}
          hint="En todas las empresas"
        />
      </div>

      <div className="mt-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-800">Historial de pagos — todas las empresas</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-6 py-3 font-medium">Empresa</th>
                <th className="px-6 py-3 font-medium">Plan</th>
                <th className="px-6 py-3 font-medium">Días agregados</th>
                <th className="px-6 py-3 font-medium">Método</th>
                <th className="px-6 py-3 font-medium">Fecha</th>
                <th className="px-6 py-3 font-medium text-right">Monto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(pagos || []).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-400">
                    Todavía no hay pagos registrados.
                  </td>
                </tr>
              )}
              {(pagos || []).map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-6 py-4">
                    <p className="font-medium text-slate-800">{p.nombre_comercial || p.razon_social}</p>
                    <p className="text-xs text-slate-500">{p.ruc}</p>
                  </td>
                  <td className="px-6 py-4 text-slate-600">{PLAN_LABEL[p.plan]}</td>
                  <td className="px-6 py-4 text-slate-600">{p.dias_agregados}</td>
                  <td className="px-6 py-4 text-slate-600">{p.metodo_pago ? METODO_PAGO_LABEL[p.metodo_pago] : "—"}</td>
                  <td className="px-6 py-4 text-slate-600">{formatFecha(p.creado_en)}</td>
                  <td className="px-6 py-4 text-right font-semibold text-slate-800">
                    S/ {Number(p.monto).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

type AuditoriaLog = {
  id: number;
  accion: string;
  entidad: string | null;
  entidad_id: number | null;
  detalle: Record<string, unknown> | null;
  creado_en: string;
  usuario_nombre: string | null;
  usuario_rol: string | null;
};

function etiquetaAccion(accion: string) {
  return accion
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function SelectorEmpresaBuscable({
  empresas,
  valor,
  onSeleccionar,
  placeholderVacio,
}: {
  empresas: Empresa[];
  valor: string | null;
  onSeleccionar: (id: string) => void;
  placeholderVacio: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const contenedorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function alClicFuera(e: MouseEvent) {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target as Node)) {
        setAbierto(false);
        setBusqueda("");
      }
    }
    document.addEventListener("mousedown", alClicFuera);
    return () => document.removeEventListener("mousedown", alClicFuera);
  }, []);

  const empresaActual = empresas.find((e) => e.id === valor) || null;
  const q = busqueda.trim().toLowerCase();
  const filtradas = q
    ? empresas.filter(
        (e) =>
          e.ruc.includes(q) ||
          (e.razon_social || "").toLowerCase().includes(q) ||
          (e.nombre_comercial || "").toLowerCase().includes(q)
      )
    : empresas;

  return (
    <div className="relative" ref={contenedorRef}>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full min-w-64 items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm hover:border-purple-300 focus:border-purple-400 focus:outline-none"
      >
        <span className={`truncate ${empresaActual ? "text-slate-800" : "text-slate-500"}`}>
          {empresaActual ? `${empresaActual.nombre_comercial || empresaActual.razon_social} · ${empresaActual.ruc}` : placeholderVacio}
        </span>
        <ChevronDown className="h-4 w-4 flex-shrink-0 text-slate-400" />
      </button>
      {abierto && (
        <div className="absolute right-0 z-20 mt-1 w-80 rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 p-2">
            <div className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1.5">
              <Search className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
              <input
                autoFocus
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar por RUC o nombre…"
                className="w-full text-sm focus:outline-none"
              />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => {
                onSeleccionar("");
                setAbierto(false);
                setBusqueda("");
              }}
              className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                !valor ? "bg-purple-50 font-medium text-purple-700" : "text-slate-600"
              }`}
            >
              {placeholderVacio}
            </button>
            {filtradas.length === 0 && <p className="px-3 py-4 text-center text-xs text-slate-400">Sin resultados.</p>}
            {filtradas.map((e) => (
              <button
                type="button"
                key={e.id}
                onClick={() => {
                  onSeleccionar(e.id);
                  setAbierto(false);
                  setBusqueda("");
                }}
                className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                  valor === e.id ? "bg-purple-50 font-medium text-purple-700" : "text-slate-700"
                }`}
              >
                {e.nombre_comercial || e.razon_social} <span className="text-slate-400">· {e.ruc}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AuditoriaView({
  empresas,
  empresaSeleccionadaId,
  onSeleccionar,
  logs,
  cargando,
}: {
  empresas: Empresa[];
  empresaSeleccionadaId: string | null;
  onSeleccionar: (id: string) => void;
  logs: AuditoriaLog[] | null;
  cargando: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-800">Auditoría</h2>
          <p className="text-xs text-slate-500">Historial de acciones del sistema de ventas, empresa por empresa.</p>
        </div>
        <SelectorEmpresaBuscable
          empresas={empresas}
          valor={empresaSeleccionadaId}
          onSeleccionar={onSeleccionar}
          placeholderVacio="Elige una empresa…"
        />
      </div>

      {!empresaSeleccionadaId && (
        <p className="px-6 py-10 text-center text-sm text-slate-400">Elige una empresa para ver su historial.</p>
      )}
      {empresaSeleccionadaId && cargando && (
        <div className="flex items-center gap-2 px-6 py-10 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando auditoría…
        </div>
      )}
      {empresaSeleccionadaId && !cargando && logs && logs.length === 0 && (
        <p className="px-6 py-10 text-center text-sm text-slate-400">Todavía no hay actividad registrada.</p>
      )}
      {empresaSeleccionadaId && !cargando && logs && logs.length > 0 && (
        <div className="max-h-[32rem] overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-6 py-3 font-medium">Fecha</th>
                <th className="px-6 py-3 font-medium">Quién</th>
                <th className="px-6 py-3 font-medium">Acción</th>
                <th className="px-6 py-3 font-medium">Detalle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-6 py-3 text-slate-500">{formatFecha(l.creado_en)}</td>
                  <td className="px-6 py-3 text-slate-700">
                    {l.usuario_nombre ? `${l.usuario_nombre} (${ROL_LABEL[l.usuario_rol || ""] || l.usuario_rol})` : "Sistema"}
                  </td>
                  <td className="px-6 py-3 font-medium text-slate-800">{etiquetaAccion(l.accion)}</td>
                  <td className="max-w-xs truncate px-6 py-3 text-xs text-slate-400" title={l.detalle ? JSON.stringify(l.detalle) : ""}>
                    {l.detalle ? JSON.stringify(l.detalle) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const ACCION_LABEL: Record<string, string> = {
  emitirBoletaRecibo: "Emitir boleta / recibo",
  emitirFactura: "Emitir factura",
  anularOEmitirNotaCredito: "Anular / emitir nota de crédito",
  gestionarProductos: "Gestionar productos",
  gestionarUsuarios: "Gestionar usuarios",
  verReportes: "Ver reportes",
};

type PermisosEmpresaDatos = { roles: string[]; permisos: Record<string, string[]>; personalizados: string[] };

function FilaPermisoEditable({
  accion,
  roles,
  rolesActuales,
  personalizado,
  guardando,
  restaurando,
  onGuardar,
  onRestaurar,
}: {
  accion: string;
  roles: string[];
  rolesActuales: string[];
  personalizado: boolean;
  guardando: boolean;
  restaurando: boolean;
  onGuardar: (roles: string[]) => void;
  onRestaurar: () => void;
}) {
  const [seleccion, setSeleccion] = useState<string[]>(rolesActuales);
  const cambiado = JSON.stringify([...seleccion].sort()) !== JSON.stringify([...rolesActuales].sort());

  return (
    <tr className="hover:bg-slate-50">
      <td className="px-6 py-3 font-medium text-slate-800">
        {ACCION_LABEL[accion] || accion}
        {personalizado && (
          <span className="ml-2 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-semibold text-purple-700">
            Personalizado
          </span>
        )}
      </td>
      {roles.map((r) => (
        <td key={r} className="px-4 py-3 text-center">
          <input
            type="checkbox"
            checked={seleccion.includes(r)}
            onChange={(e) =>
              setSeleccion((prev) => (e.target.checked ? [...prev, r] : prev.filter((x) => x !== r)))
            }
            className="h-4 w-4 accent-purple-600"
          />
        </td>
      ))}
      <td className="px-4 py-3 text-right">
        <div className="flex justify-end gap-1.5">
          {personalizado && (
            <button
              onClick={onRestaurar}
              disabled={restaurando}
              title="Restaurar valor por defecto"
              className="rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-200 disabled:opacity-50"
            >
              {restaurando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            </button>
          )}
          <button
            onClick={() => onGuardar(seleccion)}
            disabled={!cambiado || guardando || seleccion.length === 0}
            className="flex items-center gap-1 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-40"
          >
            {guardando && <Loader2 className="h-3 w-3 animate-spin" />}
            Guardar
          </button>
        </div>
      </td>
    </tr>
  );
}

function RolesPermisosView({
  datos,
  cargando,
  empresas,
  empresaSeleccionadaId,
  onSeleccionarEmpresa,
  datosEmpresa,
  cargandoEmpresa,
  guardandoAccion,
  onGuardarAccion,
  restaurandoAccion,
  onRestaurarAccion,
}: {
  datos: { roles: string[]; permisos: Record<string, string[]> } | null;
  cargando: boolean;
  empresas: Empresa[];
  empresaSeleccionadaId: string | null;
  onSeleccionarEmpresa: (id: string) => void;
  datosEmpresa: PermisosEmpresaDatos | null;
  cargandoEmpresa: boolean;
  guardandoAccion: string | null;
  onGuardarAccion: (accion: string, roles: string[]) => void;
  restaurandoAccion: string | null;
  onRestaurarAccion: (accion: string) => void;
}) {
  const efectivo = empresaSeleccionadaId ? datosEmpresa : datos;
  const cargandoActual = empresaSeleccionadaId ? cargandoEmpresa : cargando;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-800">Roles y permisos</h2>
          <p className="text-xs text-slate-500">
            {empresaSeleccionadaId
              ? "Editando solo para esta empresa — las demás no cambian."
              : "Matriz global por defecto. Elige una empresa para personalizarla solo para ella."}
          </p>
        </div>
        <SelectorEmpresaBuscable
          empresas={empresas}
          valor={empresaSeleccionadaId}
          onSeleccionar={onSeleccionarEmpresa}
          placeholderVacio="Ver matriz global (todas las empresas)"
        />
      </div>

      {cargandoActual || !efectivo ? (
        <div className="flex items-center gap-2 px-6 py-10 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-6 py-3 font-medium">Acción</th>
                {efectivo.roles.map((r) => (
                  <th key={r} className="px-4 py-3 text-center font-medium">
                    {ROL_LABEL[r] || r}
                  </th>
                ))}
                {empresaSeleccionadaId && <th className="px-4 py-3"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {Object.keys(efectivo.permisos).map((accion) =>
                empresaSeleccionadaId && datosEmpresa ? (
                  <FilaPermisoEditable
                    key={accion}
                    accion={accion}
                    roles={efectivo.roles}
                    rolesActuales={efectivo.permisos[accion]}
                    personalizado={datosEmpresa.personalizados.includes(accion)}
                    guardando={guardandoAccion === accion}
                    restaurando={restaurandoAccion === accion}
                    onGuardar={(roles) => onGuardarAccion(accion, roles)}
                    onRestaurar={() => onRestaurarAccion(accion)}
                  />
                ) : (
                  <tr key={accion} className="hover:bg-slate-50">
                    <td className="px-6 py-3 font-medium text-slate-800">{ACCION_LABEL[accion] || accion}</td>
                    {efectivo.roles.map((r) => (
                      <td key={r} className="px-4 py-3 text-center">
                        {efectivo.permisos[accion].includes(r) ? (
                          <Check className="mx-auto h-4 w-4 text-emerald-600" />
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    ))}
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type PlanConfig = {
  id: string;
  nombre: string;
  precio_mensual: number | string;
  activo: boolean;
};

function FilaPlan({
  plan,
  guardando,
  onGuardar,
}: {
  plan: PlanConfig;
  guardando: boolean;
  onGuardar: (datos: { nombre: string; precio_mensual: number; activo: boolean }) => void;
}) {
  const [nombre, setNombre] = useState(plan.nombre);
  const [precio, setPrecio] = useState(String(plan.precio_mensual));
  const [activo, setActivo] = useState(plan.activo);

  const cambiado = nombre !== plan.nombre || Number(precio) !== Number(plan.precio_mensual) || activo !== plan.activo;

  return (
    <tr className="hover:bg-slate-50">
      <td className="px-6 py-3 font-mono text-xs text-slate-400">{plan.id}</td>
      <td className="px-4 py-3">
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-purple-400 focus:outline-none"
        />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1">
          <span className="text-slate-400">S/</span>
          <input
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            type="number"
            min="0"
            step="0.01"
            className="w-24 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-purple-400 focus:outline-none"
          />
          <span className="text-slate-400">/ mes</span>
        </div>
      </td>
      <td className="px-4 py-3 text-center">
        <button
          onClick={() => setActivo((v) => !v)}
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            activo ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"
          }`}
        >
          {activo ? "Activo" : "Inactivo"}
        </button>
      </td>
      <td className="px-4 py-3 text-right">
        <button
          onClick={() => onGuardar({ nombre, precio_mensual: Number(precio), activo })}
          disabled={!cambiado || guardando || !nombre.trim() || !(Number(precio) > 0)}
          className="flex items-center gap-1 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-40"
        >
          {guardando && <Loader2 className="h-3 w-3 animate-spin" />}
          Guardar
        </button>
      </td>
    </tr>
  );
}

function NuevoPlanForm({ guardando, onCrear }: { guardando: boolean; onCrear: (datos: { id: string; nombre: string; precio_mensual: number }) => Promise<boolean> }) {
  const [abierto, setAbierto] = useState(false);
  const [id, setId] = useState("");
  const [nombre, setNombre] = useState("");
  const [precio, setPrecio] = useState("");

  if (!abierto) {
    return (
      <button
        onClick={() => setAbierto(true)}
        className="flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-4 py-2 text-xs font-medium text-slate-500 hover:border-purple-300 hover:text-purple-600"
      >
        <Tag className="h-3.5 w-3.5" /> Nuevo plan
      </button>
    );
  }

  const puedeCrear = /^[a-z][a-z0-9_]{1,19}$/.test(id) && nombre.trim() && Number(precio) > 0;

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!puedeCrear) return;
        const ok = await onCrear({ id, nombre: nombre.trim(), precio_mensual: Number(precio) });
        if (ok) {
          setAbierto(false);
          setId("");
          setNombre("");
          setPrecio("");
        }
      }}
      className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3"
    >
      <div>
        <label className="mb-1 block text-[11px] font-medium text-slate-500">ID (sin espacios)</label>
        <input
          value={id}
          onChange={(e) => setId(e.target.value.toLowerCase().replace(/\s+/g, "_"))}
          placeholder="ej. corporativo"
          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs focus:border-purple-400 focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-1 block text-[11px] font-medium text-slate-500">Nombre visible</label>
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Corporativo"
          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs focus:border-purple-400 focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-1 block text-[11px] font-medium text-slate-500">Precio mensual (S/)</label>
        <input
          value={precio}
          onChange={(e) => setPrecio(e.target.value)}
          type="number"
          min="0"
          step="0.01"
          placeholder="199"
          className="w-24 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs focus:border-purple-400 focus:outline-none"
        />
      </div>
      <button
        type="button"
        onClick={() => setAbierto(false)}
        className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100"
      >
        Cancelar
      </button>
      <button
        type="submit"
        disabled={!puedeCrear || guardando}
        className="flex items-center gap-1 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
      >
        {guardando && <Loader2 className="h-3 w-3 animate-spin" />}
        Crear plan
      </button>
    </form>
  );
}

function PlanesView({
  planes,
  cargando,
  guardandoId,
  onGuardar,
  creando,
  onCrear,
}: {
  planes: PlanConfig[] | null;
  cargando: boolean;
  guardandoId: string | null;
  onGuardar: (id: string, datos: { nombre: string; precio_mensual: number; activo: boolean }) => void;
  creando: boolean;
  onCrear: (datos: { id: string; nombre: string; precio_mensual: number }) => Promise<boolean>;
}) {
  if (cargando || !planes) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando planes…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-800">Planes de suscripción</h2>
          <p className="text-xs text-slate-500">
            Estos precios son los que se ofrecen a empresas nuevas y se usan para calcular el MRR. Un plan
            "Inactivo" sigue funcionando para quien ya lo tiene, solo deja de ofrecerse a clientes nuevos.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-6 py-3 font-medium">ID</th>
                <th className="px-4 py-3 font-medium">Nombre</th>
                <th className="px-4 py-3 font-medium">Precio</th>
                <th className="px-4 py-3 text-center font-medium">Estado</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {planes.map((p) => (
                <FilaPlan
                  key={p.id}
                  plan={p}
                  guardando={guardandoId === p.id}
                  onGuardar={(datos) => onGuardar(p.id, datos)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <NuevoPlanForm guardando={creando} onCrear={onCrear} />
    </div>
  );
}

type AlertaFacturacion = {
  id: string;
  tipo_comprobante: string;
  serie: string;
  correlativo: number;
  estado_sunat: string;
  codigo_respuesta_sunat: string | null;
  descripcion_respuesta: string | null;
  intentos_envio: number;
  total: number;
  creado_en: string;
  enviado_en: string | null;
  company_id: string;
  ruc: string;
  razon_social: string;
  nombre_comercial: string | null;
};

const ESTADO_SUNAT_LABEL: Record<string, string> = {
  error_envio: "Error de envío",
  rechazado: "Rechazado por SUNAT",
};

function AlertasFacturacionView({
  alertas,
  cargando,
  onVerEmpresa,
  onVerFactura,
  onReintentar,
  reintentandoId,
}: {
  alertas: AlertaFacturacion[] | null;
  cargando: boolean;
  onVerEmpresa: (ruc: string) => void;
  onVerFactura: (id: string) => void;
  onReintentar: (id: string) => void;
  reintentandoId: string | null;
}) {
  if (cargando || !alertas) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando alertas…
      </div>
    );
  }

  const porError = alertas.filter((a) => a.estado_sunat === "error_envio").length;
  const porRechazo = alertas.filter((a) => a.estado_sunat === "rechazado").length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          icon={AlertTriangle}
          label="Total sin llegar a SUNAT"
          value={String(alertas.length)}
          hint="De todas las empresas"
        />
        <MetricCard icon={AlertTriangle} label="Error de envío" value={String(porError)} hint="Falla de red/timeout — reintentable" />
        <MetricCard icon={Ban} label="Rechazados por SUNAT" value={String(porRechazo)} hint="SUNAT los rechazó de verdad" />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-800">Comprobantes que no llegaron a SUNAT</h2>
          <p className="text-xs text-slate-500">
            Facturas, boletas y notas ya emitidas al cliente, pero que legalmente todavía no están declaradas ante SUNAT.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-6 py-3 font-medium">Empresa</th>
                <th className="px-4 py-3 font-medium">Comprobante</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium">Motivo</th>
                <th className="px-4 py-3 font-medium">Intentos</th>
                <th className="px-4 py-3 font-medium">Fecha</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {alertas.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-slate-400">
                    Ningún comprobante pendiente — todo llegó a SUNAT.
                  </td>
                </tr>
              )}
              {alertas.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <td className="px-6 py-3">
                    <p className="font-medium text-slate-800">{a.nombre_comercial || a.razon_social}</p>
                    <p className="text-xs text-slate-500">{a.ruc}</p>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">
                    {a.serie}-{String(a.correlativo).padStart(6, "0")}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        a.estado_sunat === "rechazado" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {ESTADO_SUNAT_LABEL[a.estado_sunat] || a.estado_sunat}
                    </span>
                  </td>
                  <td className="max-w-xs truncate px-4 py-3 text-xs text-slate-500" title={a.descripcion_respuesta || ""}>
                    {a.descripcion_respuesta || "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{a.intentos_envio}</td>
                  <td className="px-4 py-3 text-slate-500">{formatFecha(a.creado_en)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => onVerFactura(a.id)}
                        className="rounded-lg px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                      >
                        Ver factura
                      </button>
                      <button
                        onClick={() => onReintentar(a.id)}
                        disabled={reintentandoId === a.id}
                        className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                      >
                        {reintentandoId === a.id && <Loader2 className="h-3 w-3 animate-spin" />}
                        Reintentar
                      </button>
                      <button
                        onClick={() => onVerEmpresa(a.ruc)}
                        className="rounded-lg px-2 py-1.5 text-xs font-medium text-purple-600 hover:bg-purple-50"
                      >
                        Ver empresa
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const INTEGRACIONES_PLATAFORMA: { categoria: string; detalle: string }[] = [
  { categoria: "Email", detalle: "No configurada — no hay envío de correos automatizado todavía." },
  { categoria: "SMS", detalle: "No configurada." },
  { categoria: "Almacenamiento", detalle: "No configurada — los archivos (comprobantes de pago) se guardan en la base de datos." },
  { categoria: "Pasarela de pagos", detalle: "No configurada — los pagos se registran manualmente o vía comprobante subido." },
  { categoria: "Notificaciones push", detalle: "No configurada." },
  { categoria: "Webhooks", detalle: "No configurados." },
  { categoria: "Servicios externos", detalle: "Ninguno configurado." },
];

function ConfiguracionView() {
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMensaje(null);
    if (nueva.length < 8) {
      setMensaje({ tipo: "error", texto: "La nueva contraseña debe tener al menos 8 caracteres." });
      return;
    }
    if (nueva !== confirmacion) {
      setMensaje({ tipo: "error", texto: "La confirmación no coincide con la nueva contraseña." });
      return;
    }
    setGuardando(true);
    try {
      const token = localStorage.getItem(ADMIN_TOKEN_KEY);
      const res = await fetch(`${API_BASE}/auth/cambiar-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ password_actual: actual, password_nueva: nueva }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.mensaje || "No se pudo cambiar la contraseña.");
      setMensaje({ tipo: "ok", texto: "Contraseña actualizada correctamente." });
      setActual("");
      setNueva("");
      setConfirmacion("");
    } catch (err) {
      setMensaje({ tipo: "error", texto: err instanceof Error ? err.message : "Ocurrió un error inesperado." });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold text-slate-800">Cambiar tu contraseña</h2>
      <p className="mt-1 text-sm text-slate-500">Aplica solo a tu cuenta de super admin.</p>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Contraseña actual</label>
          <input
            type="password"
            required
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Nueva contraseña</label>
          <input
            type="password"
            required
            minLength={8}
            value={nueva}
            onChange={(e) => setNueva(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Confirmar nueva contraseña</label>
          <input
            type="password"
            required
            minLength={8}
            value={confirmacion}
            onChange={(e) => setConfirmacion(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
          />
        </div>

        {mensaje && (
          <p
            className={`rounded-lg px-3 py-2 text-sm ${
              mensaje.tipo === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
            }`}
          >
            {mensaje.texto}
          </p>
        )}

        <button
          type="submit"
          disabled={guardando}
          className="flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
        >
          {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
          Guardar contraseña
        </button>
      </form>
    </div>
  );
}

/** Estado real de las integraciones de la plataforma — a propósito NO
 * simula credenciales ni "probar conexión" para nada que no exista de
 * verdad. Las credenciales sensibles (NubeFacT) nunca se mandan al
 * frontend — ver obtenerNubefact en qolqa-backend/admin.controller.js,
 * que solo devuelve un booleano "configurado", nunca el token. */
function IntegracionesPlataformaView({ onIrAEmpresas }: { onIrAEmpresas: () => void }) {
  return (
    <div className="max-w-2xl space-y-6">
      <div className="rounded-xl border border-green-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800">Integraciones activas</h2>
        <p className="mt-1 text-sm text-slate-500">Lo que ya está conectado y en uso real hoy.</p>

        <div className="mt-4 flex items-start justify-between gap-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-slate-800">Facturación electrónica (NubeFacT)</p>
            <p className="mt-0.5 text-xs text-slate-600">
              Real y en uso — se configura por empresa (cada una tiene sus propias credenciales, aisladas). El
              token nunca se muestra ni se envía a este panel una vez guardado.
            </p>
          </div>
          <button
            onClick={onIrAEmpresas}
            className="whitespace-nowrap rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-green-700 shadow-sm ring-1 ring-green-300 hover:bg-green-100"
          >
            Ir a Empresas →
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800">Integraciones disponibles</h2>
        <p className="mt-1 text-sm text-slate-500">
          Ninguna simula una conexión que no existe — todas dicen claramente que no están configuradas.
        </p>

        <div className="mt-4 space-y-3">
          {INTEGRACIONES_PLATAFORMA.map((i) => (
            <div key={i.categoria} className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-slate-800">{i.categoria}</p>
                <p className="mt-0.5 text-xs text-slate-500">{i.detalle}</p>
              </div>
              <span className="whitespace-nowrap rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
                No configurada
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Alta de una empresa nueva. Crea la empresa REAL en el sistema de
 * ventas (pos-backend) y la espeja aquí para que aparezca en este panel
 * — ver la nota en el backend (qolqa-backend/admin.controller.js
 * crearEmpresa) sobre por qué son dos pasos y qué pasa si el segundo
 * falla. */
function NuevaEmpresaModal({
  onClose,
  onConfirm,
  guardando,
  error,
}: {
  onClose: () => void;
  onConfirm: (datos: {
    ruc: string;
    razon_social: string;
    nombre_comercial: string;
    ubigeo: string;
    direccion: string;
    admin: { nombre: string; email: string; password: string };
    plan_inicial: PlanId;
  }) => void;
  guardando: boolean;
  error: string;
}) {
  const [ruc, setRuc] = useState("");
  const [razonSocial, setRazonSocial] = useState("");
  const [nombreComercial, setNombreComercial] = useState("");
  const [ubigeo, setUbigeo] = useState("");
  const [direccion, setDireccion] = useState("");
  const [adminNombre, setAdminNombre] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [planInicial, setPlanInicial] = useState<PlanId>("trial");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onConfirm({
      ruc,
      razon_social: razonSocial,
      nombre_comercial: nombreComercial,
      ubigeo,
      direccion,
      admin: { nombre: adminNombre, email: adminEmail, password: adminPassword },
      plan_inicial: planInicial,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-8">
      <div className="max-h-full w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-bold text-slate-800">Nueva empresa</h3>
        <p className="mt-1 text-sm text-slate-500">
          Crea la empresa en el sistema de ventas y la da de alta aquí.
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">RUC</label>
            <input
              required
              pattern="\d{11}"
              title="11 dígitos"
              value={ruc}
              onChange={(e) => setRuc(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Razón social</label>
            <input
              required
              value={razonSocial}
              onChange={(e) => setRazonSocial(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Nombre comercial (opcional)</label>
            <input
              value={nombreComercial}
              onChange={(e) => setNombreComercial(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Ubigeo</label>
              <input
                required
                pattern="\d{6}"
                title="Código INEI, 6 dígitos"
                placeholder="150101"
                value={ubigeo}
                onChange={(e) => setUbigeo(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Dirección</label>
              <input
                required
                value={direccion}
                onChange={(e) => setDireccion(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Plan inicial</label>
            <select
              value={planInicial}
              onChange={(e) => setPlanInicial(e.target.value as PlanId)}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
            >
              <option value="trial">Trial (sin cobro)</option>
              <option value="emprendedor">Emprendedor — S/ 39/mes</option>
              <option value="negocios">Negocios — S/ 79/mes</option>
              <option value="empresarial">Empresarial — S/ 149/mes</option>
            </select>
            {planInicial !== "trial" && (
              <p className="mt-1.5 text-xs text-slate-400">
                Arranca activa con 30 días — usa "Registrar pago" después para renovarla.
              </p>
            )}
          </div>

          <hr className="border-slate-100" />
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Primer usuario (admin)</p>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Nombre</label>
            <input
              required
              value={adminNombre}
              onChange={(e) => setAdminNombre(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Correo</label>
            <input
              type="email"
              required
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Contraseña</label>
            <input
              type="text"
              required
              minLength={8}
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
            >
              {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
              Crear empresa
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RegistrarPagoModal({
  empresa,
  onClose,
  onConfirm,
  guardando,
}: {
  empresa: Empresa;
  onClose: () => void;
  onConfirm: (plan: PlanPagado, dias: number, monto: number, metodoPago: MetodoPago) => void;
  guardando: boolean;
}) {
  const [plan, setPlan] = useState<PlanPagado>(
    empresa.plan === "trial" ? "emprendedor" : (empresa.plan as PlanPagado)
  );
  const [periodo, setPeriodo] = useState<30 | 365>(30);
  const sugerido = PRECIO_MENSUAL_PLAN[plan] * (periodo === 365 ? 12 : 1);
  const [monto, setMonto] = useState(sugerido);
  const [metodoPago, setMetodoPago] = useState<MetodoPago>("yape");

  useEffect(() => {
    setMonto(PRECIO_MENSUAL_PLAN[plan] * (periodo === 365 ? 12 : 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, periodo]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-bold text-slate-800">Registrar Pago Manual</h3>
        <p className="mt-1 text-sm text-slate-500">
          {empresa.razon_social} — RUC {empresa.ruc}
        </p>

        <div className="mt-5 space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Plan pagado</label>
            <select
              value={plan}
              onChange={(e) => setPlan(e.target.value as PlanPagado)}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
            >
              <option value="emprendedor">Emprendedor — S/ 39/mes</option>
              <option value="negocios">Negocios — S/ 79/mes</option>
              <option value="empresarial">Empresarial — S/ 149/mes</option>
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Periodo cubierto</label>
            <div className="flex gap-2">
              <button
                onClick={() => setPeriodo(30)}
                className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors ${
                  periodo === 30
                    ? "border-blue-700 bg-blue-50 text-blue-700"
                    : "border-slate-300 text-slate-600 hover:bg-slate-50"
                }`}
              >
                +30 días
              </button>
              <button
                onClick={() => setPeriodo(365)}
                className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors ${
                  periodo === 365
                    ? "border-blue-700 bg-blue-50 text-blue-700"
                    : "border-slate-300 text-slate-600 hover:bg-slate-50"
                }`}
              >
                +1 año
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Monto cobrado (S/)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={monto}
              onChange={(e) => setMonto(Number(e.target.value))}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Método de pago</label>
            <select
              value={metodoPago}
              onChange={(e) => setMetodoPago(e.target.value as MetodoPago)}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
            >
              <option value="yape">Yape</option>
              <option value="plin">Plin</option>
              <option value="transferencia">Transferencia BCP</option>
              <option value="efectivo">Efectivo</option>
            </select>
          </div>

          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Nueva fecha de vencimiento: {formatFecha(addDays(empresa.suscripcion_vencimiento, periodo))}
          </p>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            onClick={onClose}
            disabled={guardando}
            className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            onClick={() => onConfirm(plan, periodo, monto, metodoPago)}
            disabled={guardando || monto <= 0}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
          >
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirmar pago
          </button>
        </div>
      </div>
    </div>
  );
}

function NubefactForm({
  estado,
  cargando,
  guardando,
  onGuardar,
}: {
  estado: EstadoNubefact | null;
  cargando: boolean;
  guardando: boolean;
  onGuardar: (ruta: string, token: string) => void;
}) {
  const [ruta, setRuta] = useState("");
  const [token, setToken] = useState("");

  if (cargando) return <p className="text-xs text-slate-400">Consultando el sistema de ventas…</p>;
  if (!estado) return null;

  if (!estado.existe_en_ventas) {
    return (
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
        Esta empresa todavía no tiene una cuenta en el sistema de ventas (pos-backend) — no hay dónde guardar
        credenciales hasta que se dé de alta ahí.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p
        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
          estado.configurado ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"
        }`}
      >
        {estado.configurado ? `Configurado — ${estado.nubefact_ruta}` : "No configurado"}
      </p>
      <input
        type="text"
        value={ruta}
        onChange={(e) => setRuta(e.target.value)}
        placeholder="Ruta (URL de la API de NubeFacT)"
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
      />
      <input
        type="text"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="Token"
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
      />
      <button
        onClick={() => onGuardar(ruta, token)}
        disabled={guardando || !ruta || !token}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-60"
      >
        {guardando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Guardar credenciales
      </button>
    </div>
  );
}

function DatosContactoForm({
  empresa,
  guardando,
  onGuardar,
}: {
  empresa: Empresa;
  guardando: boolean;
  onGuardar: (correo: string, telefono: string, direccion: string) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [correo, setCorreo] = useState(empresa.correo || "");
  const [telefono, setTelefono] = useState(empresa.telefono || "");
  const [direccion, setDireccion] = useState(empresa.direccion || "");

  if (!editando) {
    return (
      <div className="space-y-3 text-sm">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <span className="text-slate-500">Correo</span>
          <span className="font-medium text-slate-800">{empresa.correo || "—"}</span>
        </div>
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <span className="text-slate-500">Teléfono</span>
          <span className="font-medium text-slate-800">{empresa.telefono || "—"}</span>
        </div>
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <span className="text-slate-500">Dirección</span>
          <span className="font-medium text-slate-800">{empresa.direccion || "—"}</span>
        </div>
        <button
          onClick={() => {
            setCorreo(empresa.correo || "");
            setTelefono(empresa.telefono || "");
            setDireccion(empresa.direccion || "");
            setEditando(true);
          }}
          className="flex items-center gap-1.5 text-xs font-semibold text-blue-700 hover:text-blue-800"
        >
          <Pencil className="h-3.5 w-3.5" /> Editar datos de contacto
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <input
        type="email"
        value={correo}
        onChange={(e) => setCorreo(e.target.value)}
        placeholder="Correo de contacto"
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
      />
      <input
        type="text"
        value={telefono}
        onChange={(e) => setTelefono(e.target.value)}
        placeholder="Teléfono"
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
      />
      <input
        type="text"
        value={direccion}
        onChange={(e) => setDireccion(e.target.value)}
        placeholder="Dirección"
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
      />
      <div className="flex gap-2">
        <button
          onClick={() => setEditando(false)}
          disabled={guardando}
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
        >
          Cancelar
        </button>
        <button
          onClick={() => {
            onGuardar(correo, telefono, direccion);
            setEditando(false);
          }}
          disabled={guardando}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-60"
        >
          {guardando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Guardar
        </button>
      </div>
    </div>
  );
}

const ROLES_STAFF: string[] = ["admin", "vendedor", "cajero", "contador"];

function FormUsuarioStaff({
  inicial,
  guardando,
  onGuardar,
  onCancelar,
}: {
  inicial?: UsuarioStaff;
  guardando: boolean;
  onGuardar: (datos: { nombre: string; email: string; rol: string; password?: string }) => void;
  onCancelar: () => void;
}) {
  const [nombre, setNombre] = useState(inicial?.nombre || "");
  const [email, setEmail] = useState(inicial?.email || "");
  const [rol, setRol] = useState(inicial?.rol || "vendedor");
  const [password, setPassword] = useState("");

  const esNuevo = !inicial;
  const puedeGuardar = nombre.trim() && email.trim() && (!esNuevo || password.length >= 8);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!puedeGuardar) return;
        onGuardar({ nombre: nombre.trim(), email: email.trim(), rol, ...(esNuevo ? { password } : {}) });
      }}
      className="space-y-2 rounded-lg border border-slate-200 bg-white p-3"
    >
      <div className="grid grid-cols-2 gap-2">
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Nombre"
          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs focus:border-purple-400 focus:outline-none"
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          placeholder="Email"
          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs focus:border-purple-400 focus:outline-none"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select
          value={rol}
          onChange={(e) => setRol(e.target.value)}
          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs focus:border-purple-400 focus:outline-none"
        >
          {ROLES_STAFF.map((r) => (
            <option key={r} value={r}>
              {ROL_LABEL[r] || r}
            </option>
          ))}
        </select>
        {esNuevo && (
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="text"
            placeholder="Contraseña (mín. 8)"
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs focus:border-purple-400 focus:outline-none"
          />
        )}
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancelar}
          className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={!puedeGuardar || guardando}
          className="flex items-center gap-1 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
        >
          {guardando && <Loader2 className="h-3 w-3 animate-spin" />}
          {esNuevo ? "Crear usuario" : "Guardar cambios"}
        </button>
      </div>
    </form>
  );
}

function UsuariosStaffSection({
  usuarios,
  cargando,
  resetenado,
  resultadoReset,
  onResetear,
  guardandoUsuario,
  onCrear,
  onEditar,
  onAlternarEstado,
  onEliminar,
}: {
  usuarios: UsuarioStaff[] | null;
  cargando: boolean;
  resetenado: string | null;
  resultadoReset: { usuarioId: string; password: string } | null;
  onResetear: (usuario: UsuarioStaff) => void;
  guardandoUsuario: boolean;
  onCrear: (datos: { nombre: string; email: string; rol: string; password?: string }) => Promise<boolean>;
  onEditar: (usuario: UsuarioStaff, datos: { nombre: string; email: string; rol: string }) => Promise<boolean>;
  onAlternarEstado: (usuario: UsuarioStaff) => void;
  onEliminar: (usuario: UsuarioStaff) => void;
}) {
  const [copiado, setCopiado] = useState(false);
  const [creando, setCreando] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [cambiandoEstadoId, setCambiandoEstadoId] = useState<string | null>(null);
  const [eliminandoId, setEliminandoId] = useState<string | null>(null);

  if (cargando) return <p className="text-xs text-slate-400">Consultando el sistema de ventas…</p>;

  return (
    <div className="space-y-2">
      {(!usuarios || usuarios.length === 0) && (
        <p className="text-xs text-slate-400">Esta empresa todavía no tiene usuarios en el sistema de ventas.</p>
      )}
      <ul className="space-y-2">
        {(usuarios || []).map((u) =>
          editandoId === u.id ? (
            <FormUsuarioStaff
              key={u.id}
              inicial={u}
              guardando={guardandoUsuario}
              onCancelar={() => setEditandoId(null)}
              onGuardar={async (datos) => {
                const ok = await onEditar(u, { nombre: datos.nombre, email: datos.email, rol: datos.rol });
                if (ok) setEditandoId(null);
              }}
            />
          ) : (
            <li key={u.id} className="rounded-lg bg-slate-50 px-3 py-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-800">{u.nombre}</p>
                  <p className="text-xs text-slate-500">
                    {u.email} · {ROL_LABEL[u.rol] || u.rol}
                    {!u.activo && " · Bloqueado"}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setEditandoId(u.id)}
                    title="Editar datos"
                    className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-200 hover:text-slate-800"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={async () => {
                      setCambiandoEstadoId(u.id);
                      await onAlternarEstado(u);
                      setCambiandoEstadoId(null);
                    }}
                    disabled={cambiandoEstadoId === u.id}
                    title={u.activo ? "Bloquear acceso" : "Desbloquear acceso"}
                    className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium hover:bg-slate-200 disabled:opacity-60 ${
                      u.activo ? "text-slate-500 hover:text-red-600" : "text-red-500 hover:text-emerald-600"
                    }`}
                  >
                    {cambiandoEstadoId === u.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : u.activo ? (
                      <Lock className="h-3.5 w-3.5" />
                    ) : (
                      <Unlock className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    onClick={() => onResetear(u)}
                    disabled={resetenado === u.id}
                    title="Resetear contraseña"
                    className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-200 hover:text-slate-800 disabled:opacity-60"
                  >
                    {resetenado === u.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    onClick={async () => {
                      setEliminandoId(u.id);
                      await onEliminar(u);
                      setEliminandoId(null);
                    }}
                    disabled={eliminandoId === u.id}
                    title="Eliminar usuario"
                    className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-red-100 hover:text-red-600 disabled:opacity-60"
                  >
                    {eliminandoId === u.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
              {resultadoReset && resultadoReset.usuarioId === u.id && (
                <div className="mt-2 flex items-center justify-between rounded-lg bg-amber-50 px-2.5 py-2 text-xs">
                  <div>
                    <p className="font-medium text-amber-800">Contraseña temporal — cópiala ahora:</p>
                    <p className="font-mono text-amber-900">{resultadoReset.password}</p>
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(resultadoReset.password);
                      setCopiado(true);
                      setTimeout(() => setCopiado(false), 1500);
                    }}
                    className="rounded-md p-1.5 text-amber-700 hover:bg-amber-100"
                    title="Copiar"
                  >
                    {copiado ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              )}
            </li>
          )
        )}
      </ul>

      {creando ? (
        <FormUsuarioStaff
          guardando={guardandoUsuario}
          onCancelar={() => setCreando(false)}
          onGuardar={async (datos) => {
            const ok = await onCrear(datos);
            if (ok) setCreando(false);
          }}
        />
      ) : (
        <button
          onClick={() => setCreando(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2 text-xs font-medium text-slate-500 hover:border-purple-300 hover:text-purple-600"
        >
          <UserPlus className="h-3.5 w-3.5" /> Nuevo usuario
        </button>
      )}
    </div>
  );
}

function DetalleModal({
  empresa,
  pagos,
  cargandoPagos,
  nubefact,
  cargandoNubefact,
  guardandoNubefact,
  onGuardarNubefact,
  guardandoDatosEmpresa,
  onGuardarDatosEmpresa,
  usuariosStaff,
  cargandoUsuarios,
  resetenado,
  resultadoReset,
  onResetearPassword,
  guardandoUsuario,
  onCrearUsuario,
  onEditarUsuario,
  onAlternarEstadoUsuario,
  onEliminarUsuario,
  onClose,
}: {
  empresa: Empresa;
  pagos: Pago[] | null;
  cargandoPagos: boolean;
  nubefact: EstadoNubefact | null;
  cargandoNubefact: boolean;
  guardandoNubefact: boolean;
  onGuardarNubefact: (ruta: string, token: string) => void;
  guardandoDatosEmpresa: boolean;
  onGuardarDatosEmpresa: (correo: string, telefono: string, direccion: string) => void;
  usuariosStaff: UsuarioStaff[] | null;
  cargandoUsuarios: boolean;
  resetenado: string | null;
  resultadoReset: { usuarioId: string; password: string } | null;
  onResetearPassword: (usuario: UsuarioStaff) => void;
  guardandoUsuario: boolean;
  onCrearUsuario: (datos: { nombre: string; email: string; rol: string; password?: string }) => Promise<boolean>;
  onEditarUsuario: (usuario: UsuarioStaff, datos: { nombre: string; email: string; rol: string }) => Promise<boolean>;
  onAlternarEstadoUsuario: (usuario: UsuarioStaff) => void;
  onEliminarUsuario: (usuario: UsuarioStaff) => void;
  onClose: () => void;
}) {
  const cercaDelLimite =
    empresa.limite_usuarios !== null && empresa.usuarios_activos / empresa.limite_usuarios >= 0.85;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-bold text-slate-800">{empresa.razon_social}</h3>
        <p className="mt-1 text-sm text-slate-500">RUC {empresa.ruc}</p>

        <div className="mt-5">
          <DatosContactoForm empresa={empresa} guardando={guardandoDatosEmpresa} onGuardar={onGuardarDatosEmpresa} />
        </div>

        <div className="mt-4 space-y-3 text-sm">
          <div className="flex justify-between border-b border-slate-100 pb-2">
            <span className="text-slate-500">Usuarios activos</span>
            <span className="font-medium text-slate-800">
              {empresa.usuarios_activos}
              {empresa.limite_usuarios ? ` / ${empresa.limite_usuarios}` : " (ilimitado)"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Cliente desde</span>
            <span className="font-medium text-slate-800">{formatFecha(empresa.creado_en)}</span>
          </div>
        </div>

        {cercaDelLimite && (
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
            Está cerca de su límite de usuarios — buena oportunidad para ofrecerle subir de plan.
          </p>
        )}

        <div className="mt-5">
          <h4 className="mb-2 text-sm font-semibold text-slate-700">Historial de pagos</h4>
          {cargandoPagos && <p className="text-xs text-slate-400">Cargando…</p>}
          {!cargandoPagos && pagos && pagos.length === 0 && (
            <p className="text-xs text-slate-400">Sin pagos registrados todavía.</p>
          )}
          {!cargandoPagos && pagos && pagos.length > 0 && (
            <ul className="space-y-1.5 text-xs">
              {pagos.map((p) => (
                <li key={p.id} className="flex justify-between rounded-lg bg-slate-50 px-3 py-2">
                  <span className="text-slate-600">
                    {PLAN_LABEL[p.plan]} · {p.dias_agregados} días
                    {p.metodo_pago ? ` · ${METODO_PAGO_LABEL[p.metodo_pago]}` : ""} · {formatFecha(p.creado_en)}
                  </span>
                  <span className="font-semibold text-slate-800">S/ {Number(p.monto).toFixed(2)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-5">
          <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
            <Zap className="h-3.5 w-3.5" /> Facturación electrónica (NubeFacT)
          </h4>
          <NubefactForm
            estado={nubefact}
            cargando={cargandoNubefact}
            guardando={guardandoNubefact}
            onGuardar={onGuardarNubefact}
          />
        </div>

        <div className="mt-5">
          <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
            <Users className="h-3.5 w-3.5" /> Usuarios del sistema de ventas
          </h4>
          <UsuariosStaffSection
            usuarios={usuariosStaff}
            cargando={cargandoUsuarios}
            resetenado={resetenado}
            resultadoReset={resultadoReset}
            onResetear={onResetearPassword}
            guardandoUsuario={guardandoUsuario}
            onCrear={onCrearUsuario}
            onEditar={onEditarUsuario}
            onAlternarEstado={onAlternarEstadoUsuario}
            onEliminar={onEliminarUsuario}
          />
        </div>

        <button
          onClick={onClose}
          className="mt-6 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Cerrar
        </button>
      </div>
    </div>
  );
}

export default function SuperAdmin() {
  const [token] = useState<string | null>(() => localStorage.getItem(ADMIN_TOKEN_KEY));
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [metricas, setMetricas] = useState<Metricas | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pagoEmpresaId, setPagoEmpresaId] = useState<string | null>(null);
  const [detalleEmpresaId, setDetalleEmpresaId] = useState<string | null>(null);
  const [guardandoPago, setGuardandoPago] = useState(false);
  const [pagosHistorial, setPagosHistorial] = useState<Pago[] | null>(null);
  const [cargandoPagos, setCargandoPagos] = useState(false);
  const [nubefact, setNubefact] = useState<EstadoNubefact | null>(null);
  const [cargandoNubefact, setCargandoNubefact] = useState(false);
  const [guardandoNubefact, setGuardandoNubefact] = useState(false);
  const [guardandoDatosEmpresa, setGuardandoDatosEmpresa] = useState(false);
  const [usuariosStaff, setUsuariosStaff] = useState<UsuarioStaff[] | null>(null);
  const [cargandoUsuarios, setCargandoUsuarios] = useState(false);
  const [resetenado, setResetenado] = useState<string | null>(null);
  const [resultadoReset, setResultadoReset] = useState<{ usuarioId: string; password: string } | null>(null);
  const [guardandoUsuario, setGuardandoUsuario] = useState(false);
  const [vista, setVista] = useState<Vista>("dashboard");
  const [pagosGlobal, setPagosGlobal] = useState<PagoGlobal[] | null>(null);
  const [cargandoPagosGlobal, setCargandoPagosGlobal] = useState(false);
  const [auditoriaEmpresaId, setAuditoriaEmpresaId] = useState<string | null>(null);
  const [auditoriaLogs, setAuditoriaLogs] = useState<AuditoriaLog[] | null>(null);
  const [cargandoAuditoria, setCargandoAuditoria] = useState(false);
  const [rolesPermisos, setRolesPermisos] = useState<{ roles: string[]; permisos: Record<string, string[]> } | null>(null);
  const [cargandoRoles, setCargandoRoles] = useState(false);
  const [permisosEmpresaId, setPermisosEmpresaId] = useState<string | null>(null);
  const [permisosEmpresa, setPermisosEmpresa] = useState<PermisosEmpresaDatos | null>(null);
  const [cargandoPermisosEmpresa, setCargandoPermisosEmpresa] = useState(false);
  const [guardandoPermisoAccion, setGuardandoPermisoAccion] = useState<string | null>(null);
  const [restaurandoPermisoAccion, setRestaurandoPermisoAccion] = useState<string | null>(null);
  const [planes, setPlanes] = useState<PlanConfig[] | null>(null);
  const [cargandoPlanes, setCargandoPlanes] = useState(false);
  const [alertasFacturacion, setAlertasFacturacion] = useState<AlertaFacturacion[] | null>(null);
  const [cargandoAlertas, setCargandoAlertas] = useState(false);
  const [reintentandoComprobanteId, setReintentandoComprobanteId] = useState<string | null>(null);
  const [guardandoPlanId, setGuardandoPlanId] = useState<string | null>(null);
  const [creandoPlan, setCreandoPlan] = useState(false);
  const [comprobantes, setComprobantes] = useState<ComprobantePago[] | null>(null);
  const [cargandoComprobantes, setCargandoComprobantes] = useState(false);
  const [procesandoComprobante, setProcesandoComprobante] = useState<string | null>(null);
  const [busquedaEmpresa, setBusquedaEmpresa] = useState("");
  const [mostrarNuevaEmpresa, setMostrarNuevaEmpresa] = useState(false);
  const [creandoEmpresa, setCreandoEmpresa] = useState(false);
  const [errorNuevaEmpresa, setErrorNuevaEmpresa] = useState("");

  function cerrarSesion() {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    localStorage.removeItem(ADMIN_USUARIO_KEY);
    window.location.href = "/#/login";
  }

  async function authFetch(path: string, init?: RequestInit) {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init?.headers || {}) },
    });
    if (res.status === 401 || res.status === 403) {
      cerrarSesion();
      throw new Error("No autorizado.");
    }
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error?.mensaje || "Ocurrió un error inesperado.");
    return data;
  }

  async function cargarTodo() {
    setCargando(true);
    setError("");
    try {
      const [emp, met] = await Promise.all([authFetch("/admin/companies"), authFetch("/admin/metrics")]);
      setEmpresas(emp);
      setMetricas(met);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo conectar con el servidor.");
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    if (!token) {
      window.location.href = "/#/login";
      return;
    }
    cargarTodo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function cargarAlertasFacturacion() {
    setCargandoAlertas(true);
    try {
      setAlertasFacturacion(await authFetch("/admin/facturacion/alertas"));
    } catch {
      setAlertasFacturacion([]);
    } finally {
      setCargandoAlertas(false);
    }
  }

  useEffect(() => {
    if (!token) return;
    cargarAlertasFacturacion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function verFacturaComprobante(id: string) {
    try {
      const res = await fetch(`${API_BASE}/admin/comprobantes-electronicos/${id}/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("No se pudo abrir la factura.");
      const blob = await res.blob();
      window.open(URL.createObjectURL(blob), "_blank");
    } catch (err) {
      alert(err instanceof Error ? err.message : "No se pudo abrir la factura.");
    }
  }

  async function reintentarEnvioComprobante(id: string) {
    setReintentandoComprobanteId(id);
    try {
      const data = await authFetch(`/admin/comprobantes-electronicos/${id}/reintentar`, { method: "POST" });
      if (data.estado === "aceptado" || data.estado === "aceptado_con_observaciones") {
        alert("SUNAT aceptó el comprobante.");
      } else if (data.estado === "rechazado") {
        alert(`SUNAT lo rechazó: ${data.descripcion || "sin detalle"}`);
      } else {
        alert(`Sigue sin poder enviarse: ${data.error || data.descripcion || "error desconocido"}`);
      }
      await cargarAlertasFacturacion();
    } catch (err) {
      alert(err instanceof Error ? err.message : "No se pudo reintentar el envío.");
    } finally {
      setReintentandoComprobanteId(null);
    }
  }

  useEffect(() => {
    if (vista !== "pagos" || pagosGlobal !== null) return;
    setCargandoPagosGlobal(true);
    authFetch("/admin/pagos")
      .then(setPagosGlobal)
      .catch(() => setPagosGlobal([]))
      .finally(() => setCargandoPagosGlobal(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista]);

  async function cargarComprobantes() {
    setCargandoComprobantes(true);
    try {
      setComprobantes(await authFetch("/admin/comprobantes?estado=pendiente"));
    } catch {
      setComprobantes([]);
    } finally {
      setCargandoComprobantes(false);
    }
  }

  useEffect(() => {
    if (vista !== "pagos" || comprobantes !== null) return;
    cargarComprobantes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista]);

  useEffect(() => {
    if (!auditoriaEmpresaId) return;
    setCargandoAuditoria(true);
    authFetch(`/admin/companies/${auditoriaEmpresaId}/auditoria`)
      .then(setAuditoriaLogs)
      .catch(() => setAuditoriaLogs([]))
      .finally(() => setCargandoAuditoria(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditoriaEmpresaId]);

  useEffect(() => {
    if (vista !== "roles" || rolesPermisos !== null) return;
    setCargandoRoles(true);
    authFetch("/admin/permisos")
      .then(setRolesPermisos)
      .catch(() => setRolesPermisos({ roles: [], permisos: {} }))
      .finally(() => setCargandoRoles(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista]);

  async function cargarPermisosEmpresa() {
    if (!permisosEmpresaId) return;
    setCargandoPermisosEmpresa(true);
    try {
      setPermisosEmpresa(await authFetch(`/admin/companies/${permisosEmpresaId}/permisos`));
    } catch {
      setPermisosEmpresa(null);
    } finally {
      setCargandoPermisosEmpresa(false);
    }
  }

  useEffect(() => {
    if (!permisosEmpresaId) {
      setPermisosEmpresa(null);
      return;
    }
    cargarPermisosEmpresa();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permisosEmpresaId]);

  async function guardarPermisoAccion(accion: string, roles: string[]) {
    if (!permisosEmpresaId) return;
    setGuardandoPermisoAccion(accion);
    try {
      await authFetch(`/admin/companies/${permisosEmpresaId}/permisos/${accion}`, {
        method: "PUT",
        body: JSON.stringify({ roles }),
      });
      await cargarPermisosEmpresa();
    } catch (err) {
      alert(err instanceof Error ? err.message : "No se pudo guardar el permiso.");
    } finally {
      setGuardandoPermisoAccion(null);
    }
  }

  async function restaurarPermisoAccion(accion: string) {
    if (!permisosEmpresaId) return;
    setRestaurandoPermisoAccion(accion);
    try {
      await authFetch(`/admin/companies/${permisosEmpresaId}/permisos/${accion}`, { method: "DELETE" });
      await cargarPermisosEmpresa();
    } catch (err) {
      alert(err instanceof Error ? err.message : "No se pudo restaurar el permiso.");
    } finally {
      setRestaurandoPermisoAccion(null);
    }
  }

  async function cargarPlanes() {
    setCargandoPlanes(true);
    try {
      setPlanes(await authFetch("/admin/planes"));
    } catch {
      setPlanes([]);
    } finally {
      setCargandoPlanes(false);
    }
  }

  useEffect(() => {
    if (vista !== "planes" || planes !== null) return;
    cargarPlanes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista]);

  async function guardarPlan(id: string, datos: { nombre: string; precio_mensual: number; activo: boolean }) {
    setGuardandoPlanId(id);
    try {
      await authFetch(`/admin/planes/${id}`, { method: "PUT", body: JSON.stringify(datos) });
      await cargarPlanes();
    } catch (err) {
      alert(err instanceof Error ? err.message : "No se pudo guardar el plan.");
    } finally {
      setGuardandoPlanId(null);
    }
  }

  async function crearPlanNuevo(datos: { id: string; nombre: string; precio_mensual: number }) {
    setCreandoPlan(true);
    try {
      await authFetch("/admin/planes", { method: "POST", body: JSON.stringify(datos) });
      await cargarPlanes();
      return true;
    } catch (err) {
      alert(err instanceof Error ? err.message : "No se pudo crear el plan.");
      return false;
    } finally {
      setCreandoPlan(false);
    }
  }

  async function verComprobante(id: string) {
    try {
      const res = await fetch(`${API_BASE}/admin/comprobantes/${id}/archivo`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("No se pudo abrir el comprobante.");
      const blob = await res.blob();
      window.open(URL.createObjectURL(blob), "_blank");
    } catch (err) {
      alert(err instanceof Error ? err.message : "No se pudo abrir el comprobante.");
    }
  }

  async function aprobarComprobante(id: string) {
    if (!window.confirm("¿Aprobar este comprobante? Esto activa el plan de la empresa por 30 días.")) return;
    setProcesandoComprobante(id);
    try {
      await authFetch(`/admin/comprobantes/${id}/aprobar`, { method: "POST" });
      await cargarComprobantes();
      await cargarTodo();
      setPagosGlobal(await authFetch("/admin/pagos"));
    } catch (err) {
      alert(err instanceof Error ? err.message : "No se pudo aprobar el comprobante.");
    } finally {
      setProcesandoComprobante(null);
    }
  }

  async function rechazarComprobante(id: string) {
    const motivo = window.prompt("¿Por qué se rechaza? (se lo mostramos a la empresa)");
    if (motivo === null) return;
    setProcesandoComprobante(id);
    try {
      await authFetch(`/admin/comprobantes/${id}/rechazar`, { method: "POST", body: JSON.stringify({ motivo }) });
      await cargarComprobantes();
    } catch (err) {
      alert(err instanceof Error ? err.message : "No se pudo rechazar el comprobante.");
    } finally {
      setProcesandoComprobante(null);
    }
  }

  useEffect(() => {
    if (!detalleEmpresaId) {
      setPagosHistorial(null);
      setNubefact(null);
      setUsuariosStaff(null);
      setResultadoReset(null);
      return;
    }
    setCargandoPagos(true);
    authFetch(`/admin/companies/${detalleEmpresaId}/pagos`)
      .then(setPagosHistorial)
      .catch(() => setPagosHistorial([]))
      .finally(() => setCargandoPagos(false));

    setCargandoNubefact(true);
    authFetch(`/admin/companies/${detalleEmpresaId}/nubefact`)
      .then(setNubefact)
      .catch(() => setNubefact(null))
      .finally(() => setCargandoNubefact(false));

    setCargandoUsuarios(true);
    authFetch(`/admin/companies/${detalleEmpresaId}/usuarios`)
      .then((data) => setUsuariosStaff(data.data))
      .catch(() => setUsuariosStaff([]))
      .finally(() => setCargandoUsuarios(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detalleEmpresaId]);

  async function guardarNubefact(ruta: string, token: string) {
    if (!detalleEmpresaId) return;
    setGuardandoNubefact(true);
    try {
      await authFetch(`/admin/companies/${detalleEmpresaId}/nubefact`, {
        method: "PUT",
        body: JSON.stringify({ ruta, token }),
      });
      const actualizado = await authFetch(`/admin/companies/${detalleEmpresaId}/nubefact`);
      setNubefact(actualizado);
    } catch (err) {
      alert(err instanceof Error ? err.message : "No se pudieron guardar las credenciales.");
    } finally {
      setGuardandoNubefact(false);
    }
  }

  async function guardarDatosEmpresa(correo: string, telefono: string, direccion: string) {
    if (!detalleEmpresaId) return;
    setGuardandoDatosEmpresa(true);
    try {
      const actualizado = await authFetch(`/admin/companies/${detalleEmpresaId}`, {
        method: "PUT",
        body: JSON.stringify({ correo: correo || null, telefono: telefono || null, direccion: direccion || null }),
      });
      setEmpresas((prev) => prev.map((e) => (e.id === detalleEmpresaId ? { ...e, ...actualizado } : e)));
    } catch (err) {
      alert(err instanceof Error ? err.message : "No se pudieron guardar los datos de contacto.");
    } finally {
      setGuardandoDatosEmpresa(false);
    }
  }

  async function resetearPassword(usuario: UsuarioStaff) {
    if (!detalleEmpresaId) return;
    const ok = window.confirm(
      `¿Resetear la contraseña de "${usuario.nombre}" (${usuario.email})? La contraseña anterior dejará de funcionar de inmediato.`
    );
    if (!ok) return;
    setResetenado(usuario.id);
    setResultadoReset(null);
    try {
      const data = await authFetch(`/admin/companies/${detalleEmpresaId}/usuarios/${usuario.id}/reset-password`, {
        method: "PATCH",
      });
      setResultadoReset({ usuarioId: usuario.id, password: data.password_temporal });
    } catch (err) {
      alert(err instanceof Error ? err.message : "No se pudo resetear la contraseña.");
    } finally {
      setResetenado(null);
    }
  }

  async function recargarUsuariosStaff() {
    if (!detalleEmpresaId) return;
    const data = await authFetch(`/admin/companies/${detalleEmpresaId}/usuarios`);
    setUsuariosStaff(data.data);
  }

  async function crearUsuarioStaff(datos: { nombre: string; email: string; rol: string; password?: string }) {
    if (!detalleEmpresaId) return false;
    setGuardandoUsuario(true);
    try {
      await authFetch(`/admin/companies/${detalleEmpresaId}/usuarios`, {
        method: "POST",
        body: JSON.stringify(datos),
      });
      await recargarUsuariosStaff();
      return true;
    } catch (err) {
      alert(err instanceof Error ? err.message : "No se pudo crear el usuario.");
      return false;
    } finally {
      setGuardandoUsuario(false);
    }
  }

  async function editarUsuarioStaff(usuario: UsuarioStaff, datos: { nombre: string; email: string; rol: string }) {
    if (!detalleEmpresaId) return false;
    setGuardandoUsuario(true);
    try {
      await authFetch(`/admin/companies/${detalleEmpresaId}/usuarios/${usuario.id}`, {
        method: "PATCH",
        body: JSON.stringify(datos),
      });
      await recargarUsuariosStaff();
      return true;
    } catch (err) {
      alert(err instanceof Error ? err.message : "No se pudieron guardar los cambios.");
      return false;
    } finally {
      setGuardandoUsuario(false);
    }
  }

  async function eliminarUsuarioStaff(usuario: UsuarioStaff) {
    if (!detalleEmpresaId) return;
    const ok = window.confirm(
      `¿Eliminar a "${usuario.nombre}" (${usuario.email})? Esto no se puede deshacer. Si ya tiene ventas u otros movimientos registrados, no se podrá eliminar — habrá que bloquearlo en su lugar.`
    );
    if (!ok) return;
    try {
      await authFetch(`/admin/companies/${detalleEmpresaId}/usuarios/${usuario.id}`, { method: "DELETE" });
      await recargarUsuariosStaff();
    } catch (err) {
      alert(err instanceof Error ? err.message : "No se pudo eliminar el usuario.");
    }
  }

  async function alternarEstadoUsuarioStaff(usuario: UsuarioStaff) {
    if (!detalleEmpresaId) return;
    const bloqueando = usuario.activo;
    const ok = window.confirm(
      bloqueando
        ? `¿Bloquear el acceso de "${usuario.nombre}"? No podrá iniciar sesión hasta que lo desbloquees.`
        : `¿Desbloquear el acceso de "${usuario.nombre}"?`
    );
    if (!ok) return;
    try {
      await authFetch(`/admin/companies/${detalleEmpresaId}/usuarios/${usuario.id}/estado`, {
        method: "PATCH",
        body: JSON.stringify({ activo: !usuario.activo }),
      });
      await recargarUsuariosStaff();
    } catch (err) {
      alert(err instanceof Error ? err.message : "No se pudo cambiar el estado del usuario.");
    }
  }

  const empresaPago = empresas.find((e) => e.id === pagoEmpresaId) || null;
  const empresaDetalle = empresas.find((e) => e.id === detalleEmpresaId) || null;

  async function confirmarPago(plan: PlanPagado, dias: number, monto: number, metodoPago: MetodoPago) {
    if (!pagoEmpresaId) return;
    setGuardandoPago(true);
    try {
      await authFetch(`/admin/companies/${pagoEmpresaId}/pagos`, {
        method: "POST",
        body: JSON.stringify({ plan, dias_agregados: dias, monto, metodo_pago: metodoPago }),
      });
      setPagoEmpresaId(null);
      await cargarTodo();
    } catch (err) {
      alert(err instanceof Error ? err.message : "No se pudo registrar el pago.");
    } finally {
      setGuardandoPago(false);
    }
  }

  async function alternarSuspension(empresa: Empresa) {
    const suspendiendo = empresa.estado_suscripcion !== "suspendido";
    const ok = window.confirm(
      suspendiendo
        ? `¿Suspender el acceso de ${empresa.razon_social}? No podrá usar el sistema hasta que se reactive.`
        : `¿Reactivar el acceso de ${empresa.razon_social}?`
    );
    if (!ok) return;
    try {
      await authFetch(`/admin/companies/${empresa.id}/${suspendiendo ? "suspender" : "reactivar"}`, {
        method: "POST",
      });
      await cargarTodo();
    } catch (err) {
      alert(err instanceof Error ? err.message : "No se pudo actualizar el estado.");
    }
  }

  async function crearEmpresa(datos: {
    ruc: string;
    razon_social: string;
    nombre_comercial: string;
    ubigeo: string;
    direccion: string;
    admin: { nombre: string; email: string; password: string };
    plan_inicial: PlanId;
  }) {
    setCreandoEmpresa(true);
    setErrorNuevaEmpresa("");
    try {
      await authFetch("/admin/companies", { method: "POST", body: JSON.stringify(datos) });
      setMostrarNuevaEmpresa(false);
      await cargarTodo();
    } catch (err) {
      setErrorNuevaEmpresa(err instanceof Error ? err.message : "No se pudo crear la empresa.");
    } finally {
      setCreandoEmpresa(false);
    }
  }

  if (!token) return null;

  const busquedaNormalizada = busquedaEmpresa.trim().toLowerCase();
  const empresasFiltradas = busquedaNormalizada
    ? empresas.filter(
        (e) =>
          e.ruc.toLowerCase().includes(busquedaNormalizada) ||
          e.razon_social.toLowerCase().includes(busquedaNormalizada) ||
          (e.nombre_comercial || "").toLowerCase().includes(busquedaNormalizada)
      )
    : empresas;
  const totalActivas = empresas.filter((e) => e.estado_suscripcion === "activo").length;

  const empresasTabla = (
    <div className="mt-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
        <div>
          <h2 className="text-base font-semibold text-slate-800">Gestión de Empresas Suscritas</h2>
          <p className="text-xs text-slate-400">
            Total: {empresas.length} empresas · {totalActivas} activas
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={busquedaEmpresa}
              onChange={(e) => setBusquedaEmpresa(e.target.value)}
              placeholder="Buscar por RUC o razón social…"
              className="w-64 rounded-lg border border-slate-300 py-1.5 pl-9 pr-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <button
            onClick={() => {
              setErrorNuevaEmpresa("");
              setMostrarNuevaEmpresa(true);
            }}
            className="whitespace-nowrap rounded-lg bg-blue-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-800"
          >
            + Nueva empresa
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-6 py-3 font-medium">RUC / Razón Social</th>
              <th className="px-6 py-3 font-medium">Plan Actual</th>
              <th className="px-6 py-3 font-medium">Estado</th>
              <th className="px-6 py-3 font-medium">Vencimiento</th>
              <th className="px-6 py-3 font-medium text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {empresasFiltradas.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-slate-400">
                  Ninguna empresa coincide con "{busquedaEmpresa}".
                </td>
              </tr>
            )}
            {empresasFiltradas.map((e) => (
              <tr key={e.id} className="hover:bg-slate-50">
                <td className="px-6 py-4">
                  <p className="font-medium text-slate-800">{e.nombre_comercial || e.razon_social}</p>
                  <p className="text-xs text-slate-500">{e.ruc}</p>
                </td>
                <td className="px-6 py-4 text-slate-600">{PLAN_LABEL[e.plan]}</td>
                <td className="px-6 py-4">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${ESTADO_BADGE[e.estado_suscripcion].className}`}
                  >
                    {ESTADO_BADGE[e.estado_suscripcion].label}
                  </span>
                </td>
                <td className="px-6 py-4 text-slate-600">
                  <p>{formatFecha(e.suscripcion_vencimiento)}</p>
                  {e.estado_suscripcion !== "suspendido" &&
                    e.suscripcion_vencimiento &&
                    (() => {
                      const dias = diasRestantes(e.suscripcion_vencimiento) as number;
                      if (dias > 2) return null;
                      const { texto, className } = textoVencimiento(dias);
                      return <p className={`text-xs font-semibold ${className}`}>{texto}</p>;
                    })()}
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => setDetalleEmpresaId(e.id)}
                      title="Ver detalles"
                      className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-blue-700"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setPagoEmpresaId(e.id)}
                      title="Registrar pago manual"
                      className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-green-700"
                    >
                      <DollarSign className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setDetalleEmpresaId(e.id)}
                      title="Editar datos del cliente"
                      className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => alternarSuspension(e)}
                      title={e.estado_suscripcion === "suspendido" ? "Reactivar cuenta" : "Bloquear / Suspender cuenta"}
                      className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-red-700"
                    >
                      {e.estado_suscripcion === "suspendido" ? (
                        <RotateCcw className="h-4 w-4" />
                      ) : (
                        <Ban className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar
        vistaActiva={vista}
        onNavegar={setVista}
        mobileOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onLogout={cerrarSesion}
        badges={{ alertas: alertasFacturacion?.length || 0 }}
      />

      <div className="flex-1">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-4 sm:px-6 lg:px-8">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-slate-600 lg:hidden"
            aria-label="Abrir menú"
          >
            <Menu className="h-6 w-6" />
          </button>
          <h1 className="text-lg font-bold text-slate-800">
            {NAV_ITEMS.find((i) => i.vista === vista)?.label}
          </h1>
        </header>

        <main className="px-4 py-6 sm:px-6 lg:px-8">
          {(vista === "dashboard" || vista === "empresas") && error && (
            <div className="mb-6 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <span>{error}</span>
              <button onClick={cargarTodo} className="font-semibold underline">
                Reintentar
              </button>
            </div>
          )}

          {(vista === "dashboard" || vista === "empresas") && cargando && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando empresas…
            </div>
          )}

          {vista === "dashboard" && !cargando && (
            <>
              <AlertasCobro
                empresas={empresas}
                onRegistrarPago={setPagoEmpresaId}
                onVerDetalle={setDetalleEmpresaId}
              />

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <MetricCard
                  icon={TrendingUp}
                  label="Ingresos Mensuales (MRR)"
                  value={`S/ ${(metricas?.mrr ?? 0).toLocaleString("es-PE")}`}
                  hint="Suma de planes con suscripción activa"
                />
                <MetricCard
                  icon={Building2}
                  label="Empresas Activas"
                  value={String(metricas?.por_estado.activo ?? 0)}
                  hint="Suscritas y al día"
                />
                <MetricCard
                  icon={Clock}
                  label="En Prueba (Trial)"
                  value={String(metricas?.por_estado.trial ?? 0)}
                  hint="Cuentas nuevas por convertir"
                />
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-slate-400">
                <span className="flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" /> {empresas.length} empresas registradas
                </span>
                <button
                  onClick={() => setVista("empresas")}
                  className="font-semibold text-blue-700 hover:text-blue-800"
                >
                  Ver todas las empresas →
                </button>
              </div>
            </>
          )}

          {vista === "empresas" && !cargando && (
            <>
              <AlertasCobro
                empresas={empresas}
                onRegistrarPago={setPagoEmpresaId}
                onVerDetalle={setDetalleEmpresaId}
              />
              {empresasTabla}
            </>
          )}

          {vista === "pagos" && (
            <>
              <ComprobantesPendientesCard
                comprobantes={comprobantes}
                cargando={cargandoComprobantes}
                procesando={procesandoComprobante}
                onVer={verComprobante}
                onAprobar={aprobarComprobante}
                onRechazar={rechazarComprobante}
              />
              <PagosGlobalView pagos={pagosGlobal} cargando={cargandoPagosGlobal} />
            </>
          )}

          {vista === "auditoria" && (
            <AuditoriaView
              empresas={empresas}
              empresaSeleccionadaId={auditoriaEmpresaId}
              onSeleccionar={setAuditoriaEmpresaId}
              logs={auditoriaLogs}
              cargando={cargandoAuditoria}
            />
          )}

          {vista === "roles" && (
            <RolesPermisosView
              datos={rolesPermisos}
              cargando={cargandoRoles}
              empresas={empresas}
              empresaSeleccionadaId={permisosEmpresaId}
              onSeleccionarEmpresa={(id) => setPermisosEmpresaId(id || null)}
              datosEmpresa={permisosEmpresa}
              cargandoEmpresa={cargandoPermisosEmpresa}
              guardandoAccion={guardandoPermisoAccion}
              onGuardarAccion={guardarPermisoAccion}
              restaurandoAccion={restaurandoPermisoAccion}
              onRestaurarAccion={restaurarPermisoAccion}
            />
          )}

          {vista === "alertas" && (
            <AlertasFacturacionView
              alertas={alertasFacturacion}
              cargando={cargandoAlertas}
              onVerEmpresa={(ruc) => {
                const empresa = empresas.find((e) => e.ruc === ruc);
                if (!empresa) {
                  alert("Esta empresa ya no aparece en el panel (puede haber sido eliminada).");
                  return;
                }
                setVista("empresas");
                setDetalleEmpresaId(empresa.id);
              }}
              onVerFactura={verFacturaComprobante}
              onReintentar={reintentarEnvioComprobante}
              reintentandoId={reintentandoComprobanteId}
            />
          )}

          {vista === "planes" && (
            <PlanesView
              planes={planes}
              cargando={cargandoPlanes}
              guardandoId={guardandoPlanId}
              onGuardar={guardarPlan}
              creando={creandoPlan}
              onCrear={crearPlanNuevo}
            />
          )}

          {vista === "configuracion" && (
            <div className="space-y-6">
              <ConfiguracionView />
              <IntegracionesPlataformaView onIrAEmpresas={() => setVista("empresas")} />
            </div>
          )}
        </main>
      </div>

      {mostrarNuevaEmpresa && (
        <NuevaEmpresaModal
          onClose={() => setMostrarNuevaEmpresa(false)}
          onConfirm={crearEmpresa}
          guardando={creandoEmpresa}
          error={errorNuevaEmpresa}
        />
      )}
      {empresaPago && (
        <RegistrarPagoModal
          empresa={empresaPago}
          onClose={() => setPagoEmpresaId(null)}
          onConfirm={confirmarPago}
          guardando={guardandoPago}
        />
      )}
      {empresaDetalle && (
        <DetalleModal
          empresa={empresaDetalle}
          pagos={pagosHistorial}
          cargandoPagos={cargandoPagos}
          nubefact={nubefact}
          cargandoNubefact={cargandoNubefact}
          guardandoNubefact={guardandoNubefact}
          onGuardarNubefact={guardarNubefact}
          guardandoDatosEmpresa={guardandoDatosEmpresa}
          onGuardarDatosEmpresa={guardarDatosEmpresa}
          usuariosStaff={usuariosStaff}
          cargandoUsuarios={cargandoUsuarios}
          resetenado={resetenado}
          resultadoReset={resultadoReset}
          onResetearPassword={resetearPassword}
          guardandoUsuario={guardandoUsuario}
          onCrearUsuario={crearUsuarioStaff}
          onEditarUsuario={editarUsuarioStaff}
          onAlternarEstadoUsuario={alternarEstadoUsuarioStaff}
          onEliminarUsuario={eliminarUsuarioStaff}
          onClose={() => setDetalleEmpresaId(null)}
        />
      )}
    </div>
  );
}
