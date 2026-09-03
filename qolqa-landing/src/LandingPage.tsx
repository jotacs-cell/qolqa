import { useEffect, useRef, useState } from "react";
import {
  Menu,
  X,
  Check,
  MessageCircle,
  Receipt,
  Warehouse,
  Users,
  PackageX,
  Moon,
  ShieldCheck,
  Wrench,
  Shirt,
  Pill,
  Coffee,
  Store,
  ShoppingBag,
  Scissors,
  UtensilsCrossed,
  Car,
  Building2,
  PawPrint,
  Smartphone,
  Bike,
  BedDouble,
  Package,
  ChevronDown,
  ArrowRight,
  Globe,
  Lock,
  MonitorSmartphone,
  Headset,
  Contact,
  Boxes,
  BarChart3,
} from "lucide-react";

/**
 * URL del sistema de ventas / ERP para clientes ya existentes ("Iniciar
 * Sesión"). El resto de CTAs de esta landing apuntan a la sección de
 * contacto o a WhatsApp — el objetivo no es autorregistro, es agendar una
 * demo con un asesor.
 */
const APP_LOGIN_URL = import.meta.env.VITE_APP_LOGIN_URL || "/#/login";
const LEADS_API_URL = import.meta.env.VITE_LEADS_API_URL || "";
const WHATSAPP_NUMBER = import.meta.env.VITE_WHATSAPP_NUMBER || "51999999999";

const NAV_LINKS = [
  { label: "Funcionalidades", href: "#funcionalidades" },
  { label: "Cómo funciona", href: "#como-funciona" },
  { label: "Planes", href: "#planes" },
  { label: "Preguntas frecuentes", href: "#faq" },
];

const TRUST_ITEMS = [
  { icon: ShieldCheck, label: "Homologado con SUNAT" },
  { icon: Globe, label: "100% web" },
  { icon: Lock, label: "Datos protegidos" },
  { icon: MonitorSmartphone, label: "Multidispositivo" },
  { icon: Headset, label: "Soporte por WhatsApp" },
];

const PAIN_POINTS = [
  {
    icon: Users,
    title: "Filas eternas para facturar",
    description:
      "Cada venta demora minutos que tus clientes no quieren esperar, y la fila sigue creciendo.",
  },
  {
    icon: PackageX,
    title: "Inventario a ciegas",
    description:
      "No sabes cuánto stock real tienes hasta que un cliente pide algo que en el papel existe, pero en el almacén ya se acabó.",
  },
  {
    icon: Moon,
    title: "Noches enteras cuadrando caja",
    description:
      "Te quedas hasta tarde revisando números a mano y, aun así, no cuadran.",
  },
];

type BentoItem = {
  icon: typeof Receipt;
  title: string;
  description: string;
  // Grid de 6 columnas: "lg" ocupa la fila completa, "md" va en pareja
  // (dos por fila) — cualquier otra combinación deja huecos vacíos.
  size: "lg" | "md";
  image?: string;
  imageAlt?: string;
};

const BENTO_ITEMS: BentoItem[] = [
  {
    icon: Receipt,
    title: "Ventas y punto de venta",
    description:
      "Emite boletas y facturas electrónicas validadas por SUNAT en segundos, directo desde el punto de venta.",
    size: "lg",
    image: "/screenshots/ventas.png",
    imageAlt: "Pantalla real de Ventas de FacturasPOS mostrando facturas y boletas emitidas",
  },
  {
    icon: Warehouse,
    title: "Control de inventario",
    description:
      "Conoce tu stock disponible antes de vender: cada almacén con su cantidad exacta, sin hojas de cálculo ni conteos manuales.",
    size: "md",
  },
  {
    icon: ShieldCheck,
    title: "Facturación electrónica",
    description:
      "Boletas, facturas y notas de crédito enviadas a SUNAT automáticamente, con su estado siempre visible.",
    size: "md",
  },
  {
    icon: Contact,
    title: "Clientes",
    description: "Historial de compras y datos de contacto de cada cliente, listos para facturar.",
    size: "md",
  },
  {
    icon: Boxes,
    title: "Productos",
    description: "Catálogo con precios, códigos y stock mínimo por producto.",
    size: "md",
  },
  {
    icon: BarChart3,
    title: "Reportes y cierre de caja",
    description:
      "Consulta ventas, ingresos y movimientos de caja desde un solo panel, listos para tu contador.",
    size: "lg",
  },
];

const STEPS = [
  {
    number: "01",
    title: "Registra tu negocio",
    description: "Creamos tu empresa en FacturasPOS con tus datos y tu RUC.",
  },
  {
    number: "02",
    title: "Configura tu catálogo",
    description:
      "Cargas tus productos, tus series de comprobantes y quedas listo para facturar — un asesor te ayuda si tienes muchos productos.",
  },
  {
    number: "03",
    title: "Empieza a vender",
    description:
      "Factura, controla tu stock y revisa tu caja desde el navegador, sin instalar nada.",
  },
];

const BUSINESS_TYPES = [
  { icon: Wrench, label: "Ferreterías" },
  { icon: Shirt, label: "Tiendas de ropa y calzado" },
  { icon: Pill, label: "Farmacias y policlínicos" },
  { icon: Coffee, label: "Cafeterías y pastelerías" },
  { icon: Store, label: "Minimarkets" },
  { icon: ShoppingBag, label: "Bodegas y tiendas" },
  { icon: Scissors, label: "Salones de belleza y barberías" },
  { icon: UtensilsCrossed, label: "Restaurantes" },
  { icon: Car, label: "Talleres, repuestos y autopartes" },
  { icon: Building2, label: "Comercio en general" },
  { icon: PawPrint, label: "Tiendas de mascotas" },
  { icon: Smartphone, label: "Tecnología" },
  { icon: Bike, label: "Tiendas de bicicletas y motos" },
  { icon: BedDouble, label: "Hoteles" },
  { icon: Package, label: "Servicios varios" },
];

type Plan = {
  name: string;
  description: string;
  regularMonthly: number;
  promoMonthly: number;
  features: string[];
  highlighted?: boolean;
  badge?: string;
};

const PLANS: Plan[] = [
  {
    name: "Emprendedor",
    description: "Para empezar a facturar y vender de forma ordenada.",
    regularMonthly: 59,
    promoMonthly: 39,
    features: [
      "Facturación y usuarios ilimitados",
      "1 caja de venta (POS)",
      "Inventario básico",
      "Soporte vía email",
    ],
  },
  {
    name: "Negocios",
    description: "Para negocios que necesitan mayor control del día a día.",
    regularMonthly: 99,
    promoMonthly: 69,
    highlighted: true,
    badge: "Recomendado",
    features: [
      "Facturación y usuarios ilimitados",
      "Hasta 3 cajas de venta",
      "Control de stock avanzado",
      "Soporte prioritario por WhatsApp",
      "Revisión contable de tu facturación por nuestro equipo de contadores",
    ],
  },
  {
    name: "Empresarial",
    description: "Para negocios con varias sucursales y necesidades contables.",
    regularMonthly: 169,
    promoMonthly: 99,
    features: [
      "Facturación y usuarios ilimitados",
      "Multisucursal y cajas ilimitadas",
      "Multialmacén y finanzas",
      "Exportación contable PCGE",
      "Revisión contable de tu facturación por nuestro equipo de contadores",
    ],
  },
];

const COMPARISON_ROWS: { label: string; values: [boolean | string, boolean | string, boolean | string] }[] = [
  { label: "Facturación electrónica SUNAT", values: [true, true, true] },
  { label: "Usuarios", values: ["Ilimitados", "Ilimitados", "Ilimitados"] },
  { label: "Cajas de venta (POS)", values: ["1", "Hasta 3", "Ilimitadas"] },
  { label: "Inventario", values: ["Básico", "Avanzado", "Multialmacén"] },
  { label: "Sucursales", values: ["1", "1", "Ilimitadas"] },
  { label: "Exportación contable PCGE", values: [false, false, true] },
  { label: "Revisión contable de tu facturación", values: [false, true, true] },
  { label: "Soporte", values: ["Email", "WhatsApp prioritario", "WhatsApp prioritario"] },
];

const FAQ_ITEMS = [
  {
    pregunta: "¿Cuánto tiempo toma implementar FacturasPOS en mi negocio?",
    respuesta:
      "La mayoría de negocios ya está facturando el mismo día: cargas tu catálogo de productos, configuras tus series de comprobantes y quedas listo. Si tienes muchos productos, un asesor te ayuda con la carga inicial para que no lo hagas fila por fila.",
  },
  {
    pregunta: "¿Necesito comprar equipos especiales para usarlo?",
    respuesta:
      "No. FacturasPOS funciona desde el navegador, en la computadora, tablet o celular que ya tienes. Una impresora térmica y un lector de código de barras son opcionales, no un requisito para empezar a vender.",
  },
  {
    pregunta: "¿Puedo tener varios usuarios con permisos distintos?",
    respuesta:
      "Sí. Puedes invitar vendedores, cajeros y contadores, y cada rol ve y hace solo lo que le corresponde — por ejemplo, un cajero no puede anular comprobantes ni ver reportes financieros completos.",
  },
  {
    pregunta: "¿Qué pasa si se va la luz o se corta el internet a mitad de una venta?",
    respuesta:
      "La venta queda guardada apenas la registras. Si se corta la conexión justo al enviar el comprobante a SUNAT, el sistema reintenta el envío automáticamente en cuanto vuelve — no tienes que rehacer nada.",
  },
  {
    pregunta: "¿Ofrecen soporte si tengo un problema o una duda?",
    respuesta:
      "Sí, por WhatsApp directo con un asesor — no es un formulario ni un chatbot. Los planes superiores tienen atención prioritaria, pero todos los clientes tienen a quién escribirle.",
  },
  {
    pregunta: "Si mi negocio crece, ¿puedo cambiar de plan más adelante?",
    respuesta:
      "Sí, en cualquier momento. Pasas de un plan a otro sin perder tu historial de ventas, clientes ni inventario — solo cambian los límites de usuarios, cajas y funciones disponibles.",
  },
];

function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ease-out motion-reduce:transition-none motion-reduce:!translate-y-0 motion-reduce:!opacity-100 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
      } ${className}`}
    >
      {children}
    </div>
  );
}

function Logo() {
  return (
    <div className="flex-shrink-0 flex items-center gap-2">
      <img
        src="/logo-facturapos.png"
        alt="FacturasPOS"
        className="h-20 w-auto object-contain"
      />
    </div>
  );
}

function Navbar() {
  const [open, setOpen] = useState(false);

  // Sin esto, la página de fondo sigue siendo scrolleable con el menú
  // móvil abierto — como el menú es parte del header (position: fixed) y
  // no empuja el contenido, si el usuario ya había bajado la página, el
  // menú aparece flotando encima de esa sección en vez de arriba del todo,
  // dando la sensación de que está "pegado" o roto.
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [open]);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-slate-200/60 bg-white/80 shadow-sm backdrop-blur-md">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
        <a href="#top">
          <Logo />
        </a>

        <div className="hidden items-center gap-7 md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-slate-600 transition-colors hover:text-blue-700"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="hidden items-center gap-4 md:flex">
          <a
            href={APP_LOGIN_URL}
            className="text-sm font-medium text-slate-700 transition-colors hover:text-blue-700"
          >
            Iniciar sesión
          </a>
          <a
            href="#contacto"
            className="group inline-flex items-center gap-1.5 rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:-translate-y-0.5 hover:bg-blue-800 hover:shadow-lg active:translate-y-0"
          >
            Solicitar demo
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </a>
        </div>

        <button
          className="text-slate-700 md:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Cerrar menú" : "Abrir menú"}
          aria-expanded={open}
        >
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </nav>

      {open && (
        <div className="absolute inset-x-0 top-full border-t border-slate-200 bg-white shadow-xl md:hidden">
          <div className="flex flex-col gap-4 px-4 py-6 sm:px-6">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="text-sm font-medium text-slate-700 hover:text-blue-700"
              >
                {link.label}
              </a>
            ))}
            <hr className="border-slate-200" />
            <a
              href={APP_LOGIN_URL}
              className="text-sm font-medium text-slate-700 hover:text-blue-700"
            >
              Iniciar sesión
            </a>
            <a
              href="#contacto"
              onClick={() => setOpen(false)}
              className="rounded-xl bg-blue-700 px-4 py-2 text-center text-sm font-semibold text-white shadow-md hover:bg-blue-800"
            >
              Solicitar demo
            </a>
          </div>
        </div>
      )}
    </header>
  );
}

function BrowserMockup({
  src,
  alt,
  className = "",
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-soft ${className}`}
    >
      <div className="flex items-center gap-1.5 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
      </div>
      <img src={src} alt={alt} loading="lazy" className="w-full object-cover object-top" />
    </div>
  );
}

type GlowBlob = {
  top: string;
  size: number;
  tone: "blue" | "emerald" | "amber";
  duration: string;
  delay: string;
};

const GLOW_TONE_CLASSES: Record<GlowBlob["tone"], string> = {
  blue: "bg-blue-400/25",
  emerald: "bg-emerald-400/20",
  amber: "bg-amber-400/20",
};

/**
 * Resplandores ambientales, puramente decorativos, para los márgenes
 * laterales en pantallas muy anchas (2xl: 1536px+). Se optó por manchas
 * de color difuminadas en vez de íconos o fotos: no hay fotografías de
 * stock reales disponibles para usar (habría sido contenido genérico
 * inventado) y los íconos sueltos no combinaban con el resto del diseño.
 * Un resplandor abstracto no necesita "representar" nada puntual, así
 * que siempre encaja. Invisible por debajo de 2xl para no competir con
 * el contenido real en laptops/tablets.
 */
function SideGlow({ side, blobs }: { side: "left" | "right"; blobs: GlowBlob[] }) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute top-0 hidden h-full w-40 overflow-hidden 2xl:block ${
        side === "left" ? "left-0" : "right-0"
      }`}
    >
      {blobs.map(({ top, size, tone, duration, delay }, i) => (
        <div
          key={i}
          className={`blob-pulse absolute left-1/2 rounded-full blur-3xl ${GLOW_TONE_CLASSES[tone]}`}
          style={
            {
              top,
              width: size,
              height: size,
              "--blob-duration": duration,
              "--blob-delay": delay,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

function Hero() {
  return (
    <section id="top" className="relative overflow-hidden bg-slate-50 pt-28 pb-12 sm:pt-36 sm:pb-14">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          backgroundImage:
            "radial-gradient(circle at 15% 20%, rgba(37,99,235,0.12), transparent 42%), radial-gradient(circle at 85% 5%, rgba(29,78,216,0.10), transparent 45%)",
        }}
      />
      <SideGlow
        side="left"
        blobs={[
          { top: "8%", size: 220, duration: "9s", delay: "0s", tone: "blue" },
          { top: "58%", size: 170, duration: "11s", delay: "1.5s", tone: "emerald" },
        ]}
      />
      <SideGlow
        side="right"
        blobs={[
          { top: "16%", size: 200, duration: "10s", delay: "0.8s", tone: "amber" },
          { top: "66%", size: 160, duration: "8.5s", delay: "0.3s", tone: "blue" },
        ]}
      />
      <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-14 px-4 sm:px-6 lg:grid-cols-2 lg:gap-10 lg:px-8">
        <Reveal>
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-4 py-1.5 text-xs font-semibold text-blue-700">
            <ShieldCheck className="h-4 w-4" />
            Facturación electrónica integrada con SUNAT
          </div>
          <h1 className="text-4xl font-extrabold leading-[1.08] tracking-tight text-slate-900 sm:text-5xl lg:text-[3.4rem]">
            El centro de control de tu negocio
          </h1>
          <p className="mt-4 text-xl font-semibold text-blue-700 sm:text-2xl">
            Ventas, inventario y SUNAT en un solo lugar
          </p>
          <p className="mt-5 max-w-lg text-lg text-slate-600">
            Administra ventas, productos, inventario, caja y facturación electrónica desde una
            plataforma rápida, segura y 100% web.
          </p>
          <div className="mt-9 flex flex-col gap-4 sm:flex-row">
            <a
              href="#contacto"
              className="group inline-flex items-center justify-center gap-2 rounded-xl bg-blue-700 px-8 py-3.5 text-base font-semibold text-white shadow-lg transition-all hover:-translate-y-0.5 hover:bg-blue-800 hover:shadow-xl active:translate-y-0"
            >
              Solicitar demostración
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </a>
            <a
              href="#planes"
              className="inline-flex items-center justify-center rounded-xl border-2 border-blue-700 px-8 py-3.5 text-base font-semibold text-blue-700 transition-all hover:-translate-y-0.5 hover:bg-blue-50 active:translate-y-0"
            >
              Ver planes
            </a>
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium text-slate-600">
            {["100% web", "Sin instalaciones", "Acceso desde cualquier dispositivo"].map((item) => (
              <li key={item} className="flex items-center gap-1.5">
                <Check className="h-4 w-4 text-blue-700" />
                {item}
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={150} className="relative">
          <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-br from-blue-100 via-transparent to-transparent opacity-70 blur-2xl" />
          <BrowserMockup
            src="/screenshots/ventas.png"
            alt="Pantalla real del sistema FacturasPOS mostrando el módulo de Ventas"
            className="lg:-rotate-1"
          />
          <div className="absolute -left-4 top-1/4 hidden items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-soft sm:flex motion-safe:animate-[float_6s_ease-in-out_infinite]">
            <ShieldCheck className="h-5 w-5 text-emerald-500" />
            <div>
              <p className="text-xs font-semibold text-slate-800">SUNAT</p>
              <p className="text-xs text-slate-500">Conectado</p>
            </div>
          </div>
          <div
            className="absolute -right-4 bottom-8 hidden items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-soft sm:flex motion-safe:animate-[float_7s_ease-in-out_infinite]"
            style={{ animationDelay: "1.2s" }}
          >
            <Globe className="h-5 w-5 text-blue-600" />
            <div>
              <p className="text-xs font-semibold text-slate-800">Acceso</p>
              <p className="text-xs text-slate-500">100% en la nube</p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function TrustBar() {
  return (
    <section className="border-y border-slate-100 bg-white py-6">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
          {TRUST_ITEMS.map((item) => (
            <div key={item.label} className="flex items-center gap-2 text-slate-500">
              <item.icon className="h-[18px] w-[18px] text-blue-700" />
              <span className="text-sm font-medium">{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProblemSection() {
  return (
    <section className="relative bg-white py-20 sm:py-28">
      <SideGlow
        side="left"
        blobs={[{ top: "28%", size: 190, duration: "7.5s", delay: "0.3s", tone: "amber" }]}
      />
      <SideGlow
        side="right"
        blobs={[{ top: "48%", size: 170, duration: "9.5s", delay: "0.9s", tone: "emerald" }]}
      />
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            ¿Todavía pierdes tiempo cuadrando caja?
          </h2>
          <p className="mt-4 text-lg text-slate-600">
            Así pierden tiempo y dinero la mayoría de negocios todos los días — hasta que
            centralizan ventas, inventario y comprobantes con FacturasPOS.
          </p>
        </Reveal>

        <div className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-3">
          {PAIN_POINTS.map((pain, i) => (
            <Reveal key={pain.title} delay={i * 100}>
              <div className="group h-full rounded-2xl border border-slate-100 bg-slate-50 p-8 transition-all duration-300 hover:-translate-y-1 hover:border-blue-100 hover:bg-white hover:shadow-elevated">
                <span className="mb-5 block text-xs font-bold tracking-wide text-blue-300">
                  0{i + 1}
                </span>
                <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-md">
                  <pain.icon className="h-7 w-7" strokeWidth={2} />
                </div>
                <h3 className="text-xl font-semibold text-slate-900">{pain.title}</h3>
                <p className="mt-3 text-slate-600">{pain.description}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function bentoSizeClasses(size: BentoItem["size"]) {
  if (size === "lg") return "md:col-span-6";
  return "md:col-span-3";
}

function Bento() {
  return (
    <section id="funcionalidades" className="scroll-mt-24 bg-slate-50 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Todo tu negocio desde una sola plataforma
          </h2>
          <p className="mt-4 text-lg text-slate-600">
            Diseñado para que factures, controles tu stock y sepas cuánto ganas, sin complicarte.
          </p>
        </Reveal>

        <div className="mt-16 grid grid-cols-1 gap-5 md:grid-cols-6">
          {BENTO_ITEMS.map((item, i) => (
            <Reveal
              key={item.title}
              delay={Math.min(i * 80, 320)}
              className={bentoSizeClasses(item.size)}
            >
              <div className="group flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-elevated">
                {item.image && (
                  <div className="border-b border-slate-100 p-4 pb-0">
                    <BrowserMockup src={item.image} alt={item.imageAlt ?? ""} className="border-slate-100 shadow-none" />
                  </div>
                )}
                <div
                  className={
                    item.size === "lg" && !item.image
                      ? "flex flex-1 flex-col gap-4 p-6 sm:flex-row sm:items-center"
                      : "flex flex-1 flex-col p-6"
                  }
                >
                  <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                    <item.icon className="h-[22px] w-[22px]" strokeWidth={2} />
                  </div>
                  <div className={item.size === "lg" && !item.image ? "mt-0" : "mt-4"}>
                    <h3 className="text-lg font-semibold text-slate-900">{item.title}</h3>
                    <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-600">{item.description}</p>
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section id="como-funciona" className="scroll-mt-24 bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Empieza en pocos minutos
          </h2>
          <p className="mt-4 text-lg text-slate-600">
            Sin instalaciones ni curvas de aprendizaje largas.
          </p>
        </Reveal>

        <div className="relative mt-16 grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-8">
          <div
            aria-hidden="true"
            className="absolute left-0 right-0 top-6 hidden h-px bg-slate-200 md:block"
          />
          {STEPS.map((step, i) => (
            <Reveal key={step.number} delay={i * 120} className="relative text-center md:text-left">
              <div className="relative z-10 mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-700 text-sm font-bold text-white shadow-md md:mx-0">
                {step.number}
              </div>
              <h3 className="mt-5 text-lg font-semibold text-slate-900">{step.title}</h3>
              <p className="mt-2 text-slate-600">{step.description}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function BusinessTypes() {
  return (
    <section className="border-t border-slate-200 bg-slate-50 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            FacturasPOS es para tu negocio
          </h2>
          <p className="mt-4 text-lg text-slate-600">
            No importa el rubro o el tamaño de tu emprendimiento.
          </p>
        </Reveal>

        <div className="mt-14 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {BUSINESS_TYPES.map((business, i) => (
            <Reveal key={business.label} delay={Math.min(i * 40, 400)}>
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-100 bg-white p-6 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 text-white">
                  <business.icon className="h-6 w-6" strokeWidth={2} />
                </div>
                <span className="text-sm font-medium text-slate-700">{business.label}</span>
              </div>
            </Reveal>
          ))}
        </div>

        <p className="mt-10 text-center text-lg font-semibold text-slate-800">
          ¡Y muchos rubros más!
        </p>
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section id="planes" className="relative scroll-mt-24 bg-blue-tint py-20 sm:py-28">
      <SideGlow
        side="left"
        blobs={[{ top: "14%", size: 200, duration: "8.2s", delay: "0.4s", tone: "blue" }]}
      />
      <SideGlow
        side="right"
        blobs={[{ top: "52%", size: 180, duration: "7.4s", delay: "0.1s", tone: "amber" }]}
      />
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Un plan para cada etapa de tu negocio
          </h2>
          <p className="mt-4 text-lg text-slate-600">
            Empieza con las herramientas que necesitas hoy y escala cuando tu negocio crezca. Sin
            contratos forzosos.
          </p>
        </Reveal>

        <div className="mt-14 grid grid-cols-1 items-center gap-8 md:grid-cols-3">
          {PLANS.map((plan, i) => (
            <Reveal key={plan.name} delay={i * 100}>
              <div
                className={
                  plan.highlighted
                    ? "relative rounded-2xl bg-slate-900 p-8 shadow-2xl ring-1 ring-blue-500/40 transition-all duration-300 hover:-translate-y-1.5 md:scale-105"
                    : "relative rounded-2xl border border-slate-200 bg-white p-8 shadow-sm transition-all duration-300 hover:-translate-y-1.5 hover:shadow-lg"
                }
              >
                {plan.badge && (
                  <span className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-4 py-1 text-xs font-semibold uppercase tracking-wide text-white shadow-md">
                    {plan.badge}
                  </span>
                )}
                <h3
                  className={
                    plan.highlighted
                      ? "text-lg font-semibold text-white"
                      : "text-lg font-semibold text-slate-900"
                  }
                >
                  {plan.name}
                </h3>
                <p className={plan.highlighted ? "mt-1.5 text-sm text-slate-400" : "mt-1.5 text-sm text-slate-500"}>
                  {plan.description}
                </p>

                <div className="mt-5 flex flex-col">
                  <span className="mb-1 text-sm font-medium text-slate-400 line-through">
                    Precio regular: S/ {plan.regularMonthly}
                  </span>
                  <span className="mb-2 text-xs font-bold uppercase tracking-wider text-orange-500">
                    Precio Super Promo
                  </span>
                  <div className="flex items-baseline gap-1">
                    <span
                      className={
                        plan.highlighted
                          ? "text-4xl font-extrabold text-white"
                          : "text-4xl font-extrabold text-slate-900"
                      }
                    >
                      S/ {plan.promoMonthly}
                    </span>
                    <span className={plan.highlighted ? "font-medium text-slate-300" : "font-medium text-slate-500"}>
                      /mes
                    </span>
                  </div>
                </div>

                <ul className="mt-8 space-y-3">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3">
                      <Check
                        className={
                          plan.highlighted
                            ? "mt-0.5 h-5 w-5 flex-shrink-0 text-blue-400"
                            : "mt-0.5 h-5 w-5 flex-shrink-0 text-blue-700"
                        }
                      />
                      <span className={plan.highlighted ? "text-slate-300" : "text-slate-600"}>
                        {feature}
                      </span>
                    </li>
                  ))}
                </ul>

                <a
                  href="#contacto"
                  className={
                    plan.highlighted
                      ? "mt-8 block w-full rounded-xl bg-blue-600 px-6 py-3 text-center text-sm font-semibold text-white shadow-md transition-all hover:-translate-y-0.5 hover:bg-blue-500 hover:shadow-lg active:translate-y-0"
                      : "mt-8 block w-full rounded-xl border-2 border-blue-700 px-6 py-3 text-center text-sm font-semibold text-blue-700 transition-all hover:-translate-y-0.5 hover:bg-blue-50 active:translate-y-0"
                  }
                >
                  Probar FacturasPOS
                </a>
                <a
                  href={`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
                    `Hola, quiero adquirir el plan ${plan.name} de FacturasPOS.`
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={
                    plan.highlighted
                      ? "mt-3 block text-center text-sm font-medium text-slate-400 hover:text-white"
                      : "mt-3 block text-center text-sm font-medium text-slate-500 hover:text-blue-700"
                  }
                >
                  ¿Ya decidiste? Adquiere este plan
                </a>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={200} className="mt-20">
          <h3 className="text-center text-2xl font-bold tracking-tight text-slate-900">
            Compara nuestros planes
          </h3>
          <div className="mt-8 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-5 py-4 text-left font-semibold text-slate-500">&nbsp;</th>
                  {PLANS.map((plan) => (
                    <th
                      key={plan.name}
                      className={`px-5 py-4 text-center font-semibold ${
                        plan.highlighted ? "text-blue-700" : "text-slate-700"
                      }`}
                    >
                      {plan.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row, i) => (
                  <tr key={row.label} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/60"}>
                    <td className="px-5 py-3.5 font-medium text-slate-700">{row.label}</td>
                    {row.values.map((value, idx) => (
                      <td key={idx} className="px-5 py-3.5 text-center">
                        {typeof value === "boolean" ? (
                          value ? (
                            <Check className="mx-auto h-[18px] w-[18px] text-blue-700" />
                          ) : (
                            <X className="mx-auto h-[18px] w-[18px] text-slate-300" />
                          )
                        ) : (
                          <span className="text-slate-700">{value}</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function FAQ() {
  const [abierto, setAbierto] = useState<number | null>(0);

  return (
    <section id="faq" className="scroll-mt-24 bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <Reveal className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Preguntas frecuentes
          </h2>
          <p className="mt-4 text-lg text-slate-600">
            Lo que más nos preguntan los negocios antes de empezar.
          </p>
        </Reveal>

        <div className="mt-12 space-y-3">
          {FAQ_ITEMS.map((item, i) => {
            const abiertoAqui = abierto === i;
            return (
              <Reveal key={item.pregunta} delay={Math.min(i * 60, 300)}>
                <div
                  className={`rounded-2xl border bg-white transition-colors ${
                    abiertoAqui ? "border-blue-300 shadow-sm" : "border-slate-200"
                  }`}
                >
                  <button
                    onClick={() => setAbierto(abiertoAqui ? null : i)}
                    aria-expanded={abiertoAqui}
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left sm:px-6"
                  >
                    <span className="font-semibold text-slate-800">{item.pregunta}</span>
                    <ChevronDown
                      className={`h-5 w-5 flex-shrink-0 text-slate-400 transition-transform duration-300 ${
                        abiertoAqui ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                  <div
                    className={`grid overflow-hidden transition-all duration-300 ease-out ${
                      abiertoAqui ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                    }`}
                  >
                    <div className="overflow-hidden">
                      <p className="px-5 pb-5 text-slate-600 sm:px-6">{item.respuesta}</p>
                    </div>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="relative overflow-hidden bg-slate-900 py-20 sm:py-24">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 30%, rgba(37,99,235,0.35), transparent 45%), radial-gradient(circle at 85% 70%, rgba(59,130,246,0.25), transparent 50%)",
        }}
      />
      <Reveal className="relative mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
        <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Empieza a tener el control de tu negocio
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-lg text-slate-300">
          Ventas, inventario y facturación electrónica desde una sola plataforma.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <a
            href="#contacto"
            className="group inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-8 py-3.5 text-base font-semibold text-white shadow-lg transition-all hover:-translate-y-0.5 hover:bg-blue-500 hover:shadow-xl active:translate-y-0 sm:w-auto"
          >
            Solicitar demostración
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </a>
          <a
            href="#planes"
            className="inline-flex w-full items-center justify-center rounded-xl border-2 border-slate-600 px-8 py-3.5 text-base font-semibold text-white transition-all hover:-translate-y-0.5 hover:border-slate-400 active:translate-y-0 sm:w-auto"
          >
            Ver planes
          </a>
        </div>
      </Reveal>
    </section>
  );
}

function ContactSection() {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = {
      nombre: (form.elements.namedItem("nombre") as HTMLInputElement).value,
      empresa: (form.elements.namedItem("empresa") as HTMLInputElement).value,
      telefono: (form.elements.namedItem("telefono") as HTMLInputElement)
        .value,
      correo: (form.elements.namedItem("correo") as HTMLInputElement).value,
    };

    if (!LEADS_API_URL) {
      // Sin backend de leads configurado (VITE_LEADS_API_URL): no hay a
      // dónde enviar el formulario todavía.
      setStatus("error");
      return;
    }

    setStatus("sending");
    try {
      const res = await fetch(LEADS_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("request failed");
      setStatus("sent");
      form.reset();
    } catch {
      setStatus("error");
    }
  }

  return (
    <section id="contacto" className="scroll-mt-24 bg-slate-50 py-20 sm:py-28">
      <Reveal className="mx-auto max-w-2xl px-4 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-xl sm:p-10">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900">
              Agenda tu demostración gratuita
            </h2>
            <p className="mt-3 text-slate-600">
              Déjanos tus datos y un asesor te mostrará en vivo cómo
              FacturasPOS puede optimizar tu negocio.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <div>
              <label htmlFor="nombre" className="mb-1.5 block text-sm font-medium text-slate-700">
                Nombre
              </label>
              <input
                id="nombre"
                name="nombre"
                type="text"
                required
                placeholder="Tu nombre completo"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 outline-none transition-colors focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div>
              <label htmlFor="empresa" className="mb-1.5 block text-sm font-medium text-slate-700">
                Empresa / RUC
              </label>
              <input
                id="empresa"
                name="empresa"
                type="text"
                placeholder="Nombre de tu empresa o RUC"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 outline-none transition-colors focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="telefono" className="mb-1.5 block text-sm font-medium text-slate-700">
                  Teléfono / WhatsApp
                </label>
                <input
                  id="telefono"
                  name="telefono"
                  type="tel"
                  required
                  placeholder="999 999 999"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 outline-none transition-colors focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <div>
                <label htmlFor="correo" className="mb-1.5 block text-sm font-medium text-slate-700">
                  Correo
                </label>
                <input
                  id="correo"
                  name="correo"
                  type="email"
                  required
                  placeholder="tu@empresa.pe"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 outline-none transition-colors focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={status === "sending"}
              className="w-full rounded-xl bg-blue-700 px-6 py-3 text-sm font-semibold text-white shadow-md transition-all hover:-translate-y-0.5 hover:bg-blue-800 hover:shadow-lg disabled:opacity-60"
            >
              {status === "sending" ? "Enviando..." : "Agendar mi demostración"}
            </button>

            {status === "sent" && (
              <p className="text-center text-sm text-emerald-600">
                ¡Gracias! Un asesor se comunicará contigo en breve para
                coordinar tu demo.
              </p>
            )}
            {status === "error" && (
              <p className="text-center text-sm text-amber-600">
                No se pudo enviar el formulario. Escríbenos directo por
                WhatsApp.
              </p>
            )}
          </form>

          <div className="mt-6 text-center">
            <a
              href={`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
                "Hola, quiero agendar una demo de FacturasPOS."
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm font-medium text-blue-700 hover:text-blue-800"
            >
              <MessageCircle className="h-4 w-4" />
              O escríbenos directo por WhatsApp
            </a>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-slate-900 text-slate-300">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          <div className="col-span-2 sm:col-span-1">
            <img
              src="/logo-facturapos.png"
              alt="FacturasPOS"
              className="h-12 w-auto object-contain"
            />
            <p className="mt-4 text-sm text-slate-400">
              Ventas, inventario y facturación electrónica para negocios peruanos.
            </p>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Producto
            </h4>
            <ul className="mt-4 space-y-3 text-sm">
              <li>
                <a href="#funcionalidades" className="transition-colors hover:text-white">
                  Funcionalidades
                </a>
              </li>
              <li>
                <a href="#planes" className="transition-colors hover:text-white">
                  Planes
                </a>
              </li>
              <li>
                <a href="#como-funciona" className="transition-colors hover:text-white">
                  Cómo funciona
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Soporte
            </h4>
            <ul className="mt-4 space-y-3 text-sm">
              <li>
                <a
                  href={`https://wa.me/${WHATSAPP_NUMBER}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-colors hover:text-white"
                >
                  WhatsApp
                </a>
              </li>
              <li>
                <a href="#faq" className="transition-colors hover:text-white">
                  Preguntas frecuentes
                </a>
              </li>
              <li>
                <a href="#contacto" className="transition-colors hover:text-white">
                  Contacto
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Legal
            </h4>
            <ul className="mt-4 space-y-3 text-sm">
              <li>
                <a href="/#/terminos" className="transition-colors hover:text-white">
                  Términos y condiciones
                </a>
              </li>
              <li>
                <a href="/#/privacidad" className="transition-colors hover:text-white">
                  Política de privacidad
                </a>
              </li>
              <li>
                <a href="mailto:juancarlosrojochavez1@gmail.com" className="break-all transition-colors hover:text-white">
                  juancarlosrojochavez1@gmail.com
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 border-t border-slate-800 pt-6 text-center text-xs text-slate-500">
          <p>© {new Date().getFullYear()} FacturasPOS. Todos los derechos reservados.</p>
        </div>
      </div>
    </footer>
  );
}

function WhatsAppButton() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setMounted(true), 400);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="group fixed bottom-4 right-4 z-50 sm:bottom-6 sm:right-6">
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-1/2 right-full mr-3 translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white opacity-0 shadow-md transition-opacity duration-200 group-hover:opacity-100"
      >
        ¿Necesitas ayuda?
      </span>
      <a
        href={`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
          "Hola, quiero más información sobre FacturasPOS."
        )}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Contactar por WhatsApp"
        className={`flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg transition-all duration-500 hover:-translate-y-1 hover:bg-emerald-600 hover:shadow-xl sm:h-14 sm:w-14 ${
          mounted ? "scale-100 opacity-100" : "scale-75 opacity-0"
        }`}
      >
        <MessageCircle className="h-6 w-6 sm:h-7 sm:w-7" fill="currentColor" strokeWidth={0} />
      </a>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white font-sans text-slate-800 antialiased">
      <Navbar />
      <main>
        <Hero />
        <TrustBar />
        <ProblemSection />
        <Bento />
        <HowItWorks />
        <BusinessTypes />
        <Pricing />
        <FAQ />
        <FinalCTA />
        <ContactSection />
      </main>
      <Footer />
      <WhatsAppButton />
    </div>
  );
}
