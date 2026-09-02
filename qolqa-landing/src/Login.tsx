import { useState } from "react";
import { ArrowLeft, Eye, EyeOff, Loader2 } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000/api/v1";

type Empresa = { id: string; razon_social: string; nombre_comercial: string | null };

type LoginOk = {
  token: string;
  usuario: { id: string; nombres: string; apellidos: string; correo: string; es_superadmin?: boolean };
  empresa: { id: string; razon_social: string };
};

type LoginNeedsCompany = { requiere_seleccion_empresa: true; empresas: Empresa[] };

export const ADMIN_TOKEN_KEY = "fp_admin_token";
export const ADMIN_USUARIO_KEY = "fp_admin_usuario";

/** Manda al usuario ya autenticado a su panel — el de super admin
 * (cross-tenant, mismo login que cualquier otro, pero sin empresa que
 * seleccionar de por medio) o el ERP normal de su empresa. El ERP
 * (qolqa-frontend) no lee localStorage: recibe el payload por el hash de
 * la URL vía el bootstrap de index.html. El panel de super admin sí usa
 * localStorage porque es una SPA de este mismo proyecto, no un puente a
 * otro sistema. */
function irAlPanel(data: LoginOk) {
  if (data.usuario.es_superadmin) {
    localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
    localStorage.setItem(ADMIN_USUARIO_KEY, JSON.stringify(data.usuario));
    window.location.href = "/#/admin";
    return;
  }
  const encoded = encodeURIComponent(btoa(JSON.stringify(data)));
  window.location.href = `/dashboard/index.html#auth=${encoded}`;
}

export default function Login() {
  const [showPassword, setShowPassword] = useState(false);
  const [correo, setCorreo] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [empresas, setEmpresas] = useState<Empresa[] | null>(null);

  async function intentarLogin(companyId?: string) {
    setStatus("loading");
    setError("");
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          correo,
          password,
          ...(companyId ? { company_id: companyId } : {}),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(
          data?.error?.mensaje || "Correo o contraseña incorrectos."
        );
      }

      if ((data as LoginNeedsCompany).requiere_seleccion_empresa) {
        setEmpresas((data as LoginNeedsCompany).empresas);
        setStatus("idle");
        return;
      }

      irAlPanel(data as LoginOk);
    } catch (err) {
      setStatus("error");
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo conectar con el servidor."
      );
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    intentarLogin();
  }

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      <div className="flex items-center justify-center px-4 py-12 sm:px-6 lg:px-16">
        <div className="w-full max-w-sm">
          <a
            href="/"
            className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver al inicio
          </a>

          <img
            src="/logo-facturapos.png"
            alt="FacturaPOS"
            className="mx-auto h-24 w-auto object-contain"
          />

          <h1 className="mt-10 text-2xl font-bold tracking-tight text-slate-800">
            Bienvenido de nuevo
          </h1>
          <p className="mt-2 text-slate-500">
            Ingresa a tu panel de facturación
          </p>

          {empresas ? (
            <div className="mt-8">
              <p className="mb-4 text-sm font-medium text-slate-700">
                Tu cuenta pertenece a varias empresas. Elige con cuál entrar:
              </p>
              <div className="space-y-2">
                {empresas.map((emp) => (
                  <button
                    key={emp.id}
                    onClick={() => intentarLogin(emp.id)}
                    disabled={status === "loading"}
                    className="flex w-full items-center justify-between rounded-xl border border-slate-300 px-4 py-3 text-left text-sm font-medium text-slate-800 transition-colors hover:border-blue-600 hover:bg-blue-50 disabled:opacity-60"
                  >
                    {emp.nombre_comercial || emp.razon_social}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setEmpresas(null)}
                className="mt-4 text-sm font-medium text-slate-500 hover:text-slate-700"
              >
                ← Volver
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
              <div>
                <label
                  htmlFor="correo"
                  className="mb-1.5 block text-sm font-medium text-slate-700"
                >
                  Correo electrónico
                </label>
                <input
                  id="correo"
                  name="correo"
                  type="email"
                  required
                  value={correo}
                  onChange={(e) => setCorreo(e.target.value)}
                  placeholder="tu@empresa.pe"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 outline-none transition-colors focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label
                    htmlFor="password"
                    className="block text-sm font-medium text-slate-700"
                  >
                    Contraseña
                  </label>
                  <a
                    href="#recuperar"
                    className="text-sm font-medium text-blue-700 hover:text-blue-800"
                  >
                    ¿Olvidaste tu contraseña?
                  </a>
                </div>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 pr-11 text-sm text-slate-800 placeholder-slate-400 outline-none transition-colors focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={
                      showPassword ? "Ocultar contraseña" : "Mostrar contraseña"
                    }
                    className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </div>

              {status === "error" && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={status === "loading"}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-700 px-6 py-3 text-sm font-semibold text-white shadow-md transition-all hover:-translate-y-0.5 hover:bg-blue-800 hover:shadow-lg disabled:translate-y-0 disabled:opacity-60"
              >
                {status === "loading" && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {status === "loading" ? "Ingresando..." : "Ingresar al Sistema"}
              </button>

              <p className="text-center text-sm text-slate-500">
                ¿No tienes cuenta?{" "}
                <a
                  href="/#planes"
                  className="font-semibold text-blue-700 hover:text-blue-800"
                >
                  Elige tu plan y empieza
                </a>
              </p>
            </form>
          )}
        </div>
      </div>

      <div className="relative hidden overflow-hidden bg-blue-600 lg:block">
        <img
          src="https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&q=80&w=1000"
          alt="Negocio usando un punto de venta moderno"
          className="h-full w-full object-cover opacity-80 mix-blend-multiply"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-blue-900/70 via-blue-700/20 to-transparent" />

        <div className="absolute bottom-10 left-10 right-10 rounded-2xl bg-white/95 p-6 shadow-xl backdrop-blur-sm">
          <p className="text-lg font-semibold text-slate-800">
            Únete a más de 500 empresas que automatizan sus ventas.
          </p>
          <p className="mt-2 text-sm text-slate-500">
            Facturación electrónica, inventario y reportes, todo en un solo
            sistema.
          </p>
        </div>
      </div>
    </div>
  );
}
