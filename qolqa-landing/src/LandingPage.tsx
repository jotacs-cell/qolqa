import { useEffect, useRef, useState } from "react";
import {
  Menu,
  X,
  Check,
  MessageCircle,
  Receipt,
  Warehouse,
  Calculator,
  Facebook,
  Instagram,
  Linkedin,
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
} from "lucide-react";

/**
 * URL del sistema de ventas / ERP para clientes ya existentes ("Iniciar
 * Sesión"). El resto de CTAs de esta landing apuntan a la sección de
 * contacto o a WhatsApp — el objetivo no es autorregistro, es agendar una
 * demo con un asesor.
 */
const APP_LOGIN_URL = import.meta.env.VITE_APP_LOGIN_URL || "/login";
const LEADS_API_URL = import.meta.env.VITE_LEADS_API_URL || "";
const WHATSAPP_NUMBER = import.meta.env.VITE_WHATSAPP_NUMBER || "51999999999";

const NAV_LINKS = [
  { label: "Funcionalidades", href: "#funcionalidades" },
  { label: "Planes", href: "#planes" },
  { label: "Contacto", href: "#contacto" },
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

const FEATURES = [
  {
    icon: Receipt,
    title: "Ventas Rápidas",
    description:
      "Emite boletas y facturas electrónicas validadas por SUNAT en segundos, directo desde el punto de venta.",
    image: "/screenshots/ventas.png",
    imageAlt: "Pantalla real de Ventas de FacturasPOS mostrando facturas y boletas emitidas",
  },
  {
    icon: Warehouse,
    title: "Control de Inventario",
    description:
      "Stock exacto de cada local en tiempo real, sin hojas de cálculo ni conteos manuales.",
    image:
      "https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&q=80&w=800",
    imageAlt: "Trabajador revisando inventario con una tablet en un almacén",
  },
  {
    icon: Calculator,
    title: "Reportes y Cierre",
    description:
      "Cuadra caja y revisa tus ganancias al instante, con reportes claros listos para tu contador.",
    image:
      "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&q=80&w=800",
    imageAlt: "Reportes financieros y gráficos de ventas en pantalla",
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
  regularMonthly: number;
  promoMonthly: number;
  features: string[];
  highlighted?: boolean;
  badge?: string;
};

const PLANS: Plan[] = [
  {
    name: "Emprendedor",
    regularMonthly: 59,
    promoMonthly: 39,
    features: [
      "Facturación y Usuarios Ilimitados.",
      "1 Caja de Venta (POS).",
      "Inventario Básico.",
      "Soporte vía Email.",
    ],
  },
  {
    name: "Negocios",
    regularMonthly: 99,
    promoMonthly: 69,
    highlighted: true,
    badge: "Recomendado",
    features: [
      "Facturación y Usuarios Ilimitados.",
      "Hasta 3 Cajas de Venta.",
      "Control de Stock Avanzado.",
      "Soporte Prioritario WhatsApp.",
      "Revisión contable de tu facturación por nuestro equipo de contadores.",
    ],
  },
  {
    name: "Empresarial",
    regularMonthly: 169,
    promoMonthly: 99,
    features: [
      "Facturación y Usuarios Ilimitados.",
      "Multisucursal y Cajas Ilimitadas.",
      "Multialmacén y Finanzas.",
      "Exportación Contable PCGE.",
      "Revisión contable de tu facturación por nuestro equipo de contadores.",
    ],
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
      className={`transition-all duration-700 ease-out ${
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
        className="h-16 w-auto object-contain"
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
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-slate-200/60 bg-white/70 shadow-sm backdrop-blur-md">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <a href="#top">
          <Logo />
        </a>

        <div className="hidden items-center gap-8 md:flex">
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
            Iniciar Sesión
          </a>
          <a
            href="#contacto"
            className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-md transition-all hover:-translate-y-0.5 hover:bg-blue-800 hover:shadow-lg"
          >
            Solicitar Demo
          </a>
        </div>

        <button
          className="text-slate-700 md:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label="Abrir menú"
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
              Iniciar Sesión
            </a>
            <a
              href="#contacto"
              onClick={() => setOpen(false)}
              className="rounded-xl bg-blue-700 px-4 py-2 text-center text-sm font-semibold text-white shadow-md hover:bg-blue-800"
            >
              Solicitar Demo
            </a>
          </div>
        </div>
      )}
    </header>
  );
}

function Hero() {
  return (
    <section id="top" className="relative overflow-hidden bg-slate-50 pt-32 pb-20 sm:pt-40 sm:pb-28">
      <div
        className="pointer-events-none absolute inset-0 -z-10 opacity-40"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 20%, rgba(37,99,235,0.15), transparent 40%), radial-gradient(circle at 80% 0%, rgba(29,78,216,0.12), transparent 45%)",
        }}
      />
      <Reveal className="mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-4 py-1.5 text-xs font-semibold text-blue-700">
          <ShieldCheck className="h-4 w-4" />
          Facturación Electrónica homologada por SUNAT
        </div>
        <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-slate-800 sm:text-5xl lg:text-6xl">
          El centro de control de tu negocio:{" "}
          <span className="bg-gradient-to-r from-blue-600 to-blue-700 bg-clip-text text-transparent">
            Ventas, Inventario y SUNAT
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600">
          FacturasPOS es el sistema web que automatiza tus procesos comerciales
          sin instalaciones pesadas ni pérdida de datos.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <a
            href="#contacto"
            className="w-full rounded-xl bg-blue-700 px-8 py-3.5 text-base font-semibold text-white shadow-lg transition-all hover:-translate-y-0.5 hover:bg-blue-800 hover:shadow-xl sm:w-auto"
          >
            Solicitar Demostración
          </a>
          <a
            href="#planes"
            className="w-full rounded-xl border-2 border-blue-700 px-8 py-3.5 text-base font-semibold text-blue-700 transition-all hover:-translate-y-0.5 hover:bg-blue-50 sm:w-auto"
          >
            Ver Planes
          </a>
        </div>
      </Reveal>
    </section>
  );
}

function ProblemSection() {
  return (
    <section className="bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-slate-800 sm:text-4xl">
            ¿Hasta tarde cuadrando caja?
          </h2>
          <p className="mt-4 text-lg text-slate-600">
            Así pierden tiempo y dinero la mayoría de negocios todos los días
            — hasta que automatizan todo con FacturasPOS.
          </p>
        </Reveal>

        <div className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-3">
          {PAIN_POINTS.map((pain, i) => (
            <Reveal key={pain.title} delay={i * 100}>
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-8 transition hover:shadow-xl">
                <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-md">
                  <pain.icon className="h-7 w-7" strokeWidth={2} />
                </div>
                <h3 className="text-xl font-semibold text-slate-800">
                  {pain.title}
                </h3>
                <p className="mt-3 text-slate-600">{pain.description}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section id="funcionalidades" className="scroll-mt-24 bg-slate-50 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-slate-800 sm:text-4xl">
            Todo lo que tu negocio necesita, en un solo sistema
          </h2>
          <p className="mt-4 text-lg text-slate-600">
            Diseñado para que factures, controles tu stock y sepas cuánto
            ganas, sin complicarte.
          </p>
        </Reveal>

        <div className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-3">
          {FEATURES.map((feature, i) => (
            <Reveal key={feature.title} delay={i * 100}>
              <div className="flex flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-md transition-shadow duration-300 hover:shadow-xl">
                <img
                  src={feature.image}
                  alt={feature.imageAlt}
                  className="h-48 w-full object-cover object-top"
                />
                <div className="p-8">
                  <h3 className="text-xl font-semibold text-slate-800">
                    {feature.title}
                  </h3>
                  <p className="mt-3 text-slate-600">{feature.description}</p>
                </div>
              </div>
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
          <h2 className="text-3xl font-bold tracking-tight text-slate-800 sm:text-4xl">
            FacturasPOS es para tu negocio
          </h2>
          <p className="mt-4 text-lg text-slate-600">
            No importa el rubro o el tamaño de tu emprendimiento.
          </p>
        </Reveal>

        <div className="mt-14 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {BUSINESS_TYPES.map((business, i) => (
            <Reveal key={business.label} delay={Math.min(i * 40, 400)}>
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-6 text-center transition hover:-translate-y-1 hover:shadow-lg">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 text-white">
                  <business.icon className="h-6 w-6" strokeWidth={2} />
                </div>
                <span className="text-sm font-medium text-slate-700">
                  {business.label}
                </span>
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
    <section id="planes" className="scroll-mt-24 bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-slate-800 sm:text-4xl">
            Planes y Precios
          </h2>
          <p className="mt-4 text-lg text-slate-600">
            Elige el plan que se ajusta al tamaño de tu negocio. Sin
            contratos forzosos.
          </p>
        </Reveal>

        <div className="mt-12 grid grid-cols-1 items-center gap-8 md:grid-cols-3">
          {PLANS.map((plan, i) => (
            <Reveal key={plan.name} delay={i * 100}>
            <div
              className={
                plan.highlighted
                  ? "relative rounded-2xl bg-slate-900 p-8 shadow-2xl transition-all hover:-translate-y-1 md:scale-105"
                  : "relative rounded-2xl border border-slate-200 bg-slate-50 p-8 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg"
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
                    : "text-lg font-semibold text-slate-800"
                }
              >
                {plan.name}
              </h3>

              <div className="mt-4 flex flex-col">
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
                  <span
                    className={
                      plan.highlighted
                        ? "font-medium text-slate-300"
                        : "font-medium text-slate-500"
                    }
                  >
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
                    <span
                      className={
                        plan.highlighted ? "text-slate-300" : "text-slate-600"
                      }
                    >
                      {feature}
                    </span>
                  </li>
                ))}
              </ul>

              <a
                href="#contacto"
                className={
                  plan.highlighted
                    ? "mt-8 block w-full rounded-xl bg-blue-600 px-6 py-3 text-center text-sm font-semibold text-white shadow-md transition-all hover:-translate-y-0.5 hover:bg-blue-500 hover:shadow-lg"
                    : "mt-8 block w-full rounded-xl border-2 border-blue-700 px-6 py-3 text-center text-sm font-semibold text-blue-700 transition-all hover:-translate-y-0.5 hover:bg-blue-50"
                }
              >
                Agendar Demo
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
      </div>
    </section>
  );
}

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

function FAQ() {
  const [abierto, setAbierto] = useState<number | null>(0);

  return (
    <section className="bg-slate-50 py-20 sm:py-28">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <Reveal className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-slate-800 sm:text-4xl">
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
                      className={`h-5 w-5 flex-shrink-0 text-slate-400 transition-transform ${
                        abiertoAqui ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                  {abiertoAqui && (
                    <p className="px-5 pb-5 text-slate-600 sm:px-6">{item.respuesta}</p>
                  )}
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
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
            <h2 className="text-3xl font-bold tracking-tight text-slate-800">
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
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-between gap-8 sm:flex-row">
          <img
            src="/logo-facturapos-dark.png"
            alt="FacturasPOS"
            className="h-9 w-auto object-contain"
          />

          <ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-sm">
            <li>
              <a href="#terminos" className="hover:text-white">
                Términos y Condiciones
              </a>
            </li>
            <li>
              <a href="#privacidad" className="hover:text-white">
                Política de Privacidad
              </a>
            </li>
            <li>
              <a href="mailto:ventas@facturapos.pe" className="hover:text-white">
                ventas@facturapos.pe
              </a>
            </li>
          </ul>

          {/* Reemplaza estos "#" por las URLs reales de tus redes sociales. */}
          <div className="flex items-center gap-4">
            <a href="#" aria-label="Facebook" className="text-slate-400 hover:text-white">
              <Facebook className="h-5 w-5" />
            </a>
            <a href="#" aria-label="Instagram" className="text-slate-400 hover:text-white">
              <Instagram className="h-5 w-5" />
            </a>
            <a href="#" aria-label="LinkedIn" className="text-slate-400 hover:text-white">
              <Linkedin className="h-5 w-5" />
            </a>
          </div>
        </div>

        <div className="mt-10 border-t border-slate-800 pt-6 text-center text-xs text-slate-500">
          <p>
            © {new Date().getFullYear()} FacturasPOS. Todos los derechos
            reservados.
          </p>
        </div>
      </div>
    </footer>
  );
}

function WhatsAppButton() {
  return (
    <a
      href={`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
        "Hola, quiero más información sobre FacturasPOS."
      )}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Contactar por WhatsApp"
      className="fixed bottom-4 right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg transition-all hover:-translate-y-1 hover:bg-emerald-600 hover:shadow-xl sm:bottom-6 sm:right-6 sm:h-14 sm:w-14"
    >
      <MessageCircle className="h-6 w-6 sm:h-7 sm:w-7" fill="currentColor" strokeWidth={0} />
    </a>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white font-sans text-slate-800 antialiased">
      <Navbar />
      <main>
        <Hero />
        <ProblemSection />
        <Features />
        <BusinessTypes />
        <Pricing />
        <FAQ />
        <ContactSection />
      </main>
      <Footer />
      <WhatsAppButton />
    </div>
  );
}
