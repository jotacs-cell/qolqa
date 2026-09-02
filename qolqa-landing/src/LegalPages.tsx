import type { ReactNode } from "react";

/**
 * Contenido real (no genérico ni de relleno): describe exactamente cómo
 * funciona FacturasPOS hoy — qué datos guarda, dónde, y con quién los
 * comparte. Redactado por el equipo, NO revisado todavía por un abogado —
 * antes de tratarlo como definitivo, conviene esa revisión legal.
 */

function LegalShell({ titulo, actualizado, children }: { titulo: string; actualizado: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <a
            href="/"
            className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700"
          >
            ← Volver al inicio
          </a>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{titulo}</h1>
          <p className="mt-2 text-sm text-slate-500">Última actualización: {actualizado}</p>
        </div>
      </div>
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="space-y-4 text-[15px] leading-relaxed text-slate-700 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-slate-900 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_a]:font-medium [&_a]:text-blue-700 [&_a]:hover:text-blue-800 [&_strong]:text-slate-900">
          {children}
        </div>
      </div>
    </div>
  );
}

export function TerminosPage() {
  return (
    <LegalShell titulo="Términos y Condiciones" actualizado="2 de septiembre de 2026">
      <p>
        Estos términos regulan el uso de FacturasPOS, el sistema de ventas, inventario y facturación
        electrónica al que accedes a través de este sitio. Al crear una cuenta o usar el sistema, aceptas
        lo siguiente.
      </p>

      <h2>1. Qué es FacturasPOS</h2>
      <p>
        FacturasPOS es un servicio en línea (SaaS) para que tu negocio registre ventas, controle su
        inventario y emita boletas, facturas y notas de crédito/débito electrónicas ante SUNAT. El envío a
        SUNAT lo realiza NubeFacT, un Operador de Servicios Electrónicos (OSE) homologado — FacturasPOS
        no reemplaza a un OSE, se conecta a uno.
      </p>

      <h2>2. Tu cuenta y tu empresa</h2>
      <p>
        Cada empresa que se registra tiene sus propios datos, usuarios y comprobantes, aislados de los de
        cualquier otra empresa que use el sistema. Eres responsable de la veracidad de los datos que
        registras (RUC, razón social, dirección) y de mantener en secreto las contraseñas de tus usuarios.
      </p>

      <h2>3. Planes y pagos</h2>
      <p>
        El acceso al sistema depende de tener un plan activo. Los pagos se registran manualmente (por
        Yape, Plin, transferencia o efectivo) o subiendo un comprobante de pago para su revisión — hoy no
        hay una pasarela de pago automática integrada. Si tu suscripción vence sin renovarse, el acceso al
        sistema puede suspenderse hasta que se regularice.
      </p>

      <h2>4. Responsabilidad sobre la facturación electrónica</h2>
      <p>
        FacturasPOS te permite emitir comprobantes electrónicos, pero la validez tributaria final de cada
        comprobante depende de que SUNAT lo acepte a través de NubeFacT. Eres responsable de configurar
        correctamente tus series de comprobantes y de revisar que tus comprobantes efectivamente lleguen a
        SUNAT (esto lo puedes verificar dentro del propio sistema).
      </p>

      <h2>5. Qué no está permitido</h2>
      <ul>
        <li>Usar el sistema para emitir comprobantes con datos falsos.</li>
        <li>Compartir tus credenciales de acceso con personas fuera de tu empresa.</li>
        <li>Intentar acceder a datos de otra empresa distinta a la tuya.</li>
      </ul>

      <h2>6. Cambios a estos términos</h2>
      <p>
        Podemos actualizar estos términos cuando el sistema cambie de forma relevante. Si tienes dudas
        sobre alguna condición, escríbenos antes de continuar usando el sistema.
      </p>

      <h2>7. Contacto</h2>
      <p>
        <a href="mailto:juancarlosrojochavez1@gmail.com">juancarlosrojochavez1@gmail.com</a>
      </p>
    </LegalShell>
  );
}

export function PrivacidadPage() {
  return (
    <LegalShell titulo="Política de Privacidad" actualizado="2 de septiembre de 2026">
      <p>
        En FacturasPOS tratamos datos personales tuyos, de tus usuarios y de tus clientes para poder
        prestar el servicio de ventas y facturación electrónica. Esta política explica qué datos
        guardamos, para qué, y con quién los compartimos.
      </p>

      <h2>1. Qué datos guardamos</h2>
      <ul>
        <li>
          <strong>De tu empresa:</strong> RUC, razón social, dirección, y las credenciales de tu proveedor
          de facturación electrónica (NubeFacT) que tú mismo configuras.
        </li>
        <li>
          <strong>De tus usuarios (staff):</strong> nombre, correo y contraseña (guardada siempre cifrada,
          nunca en texto plano), y el rol que tienen dentro de tu empresa.
        </li>
        <li>
          <strong>De tus clientes finales:</strong> los datos que tú mismo ingresas para emitir un
          comprobante — nombre o razón social, tipo y número de documento (DNI/RUC), y dirección cuando
          aplica. Estos datos existen porque SUNAT los exige en cada comprobante electrónico, no porque
          nosotros los solicitemos aparte.
        </li>
        <li>
          <strong>Comprobantes de pago de tu suscripción:</strong> si subes una imagen o PDF como
          comprobante de tu pago del plan, ese archivo se guarda para que podamos verificarlo.
        </li>
      </ul>

      <h2>2. Dónde se guardan estos datos</h2>
      <p>
        Los datos se guardan en bases de datos alojadas por nuestro proveedor de infraestructura en la
        nube. Cada empresa tiene sus datos separados de los de las demás mediante permisos a nivel de base
        de datos — no es solo una separación "visual" en la pantalla.
      </p>

      <h2>3. Con quién compartimos datos</h2>
      <p>
        Solo compartimos los datos estrictamente necesarios para prestar el servicio:
      </p>
      <ul>
        <li>
          <strong>NubeFacT (y por su intermedio, SUNAT):</strong> los datos de cada comprobante que emites,
          porque la ley exige que las boletas y facturas se declaren electrónicamente.
        </li>
        <li>
          <strong>Nadie más.</strong> No vendemos ni compartimos tus datos ni los de tus clientes con
          terceros para publicidad u otros fines.
        </li>
      </ul>

      <h2>4. Tus derechos (Ley N.º 29733, Ley de Protección de Datos Personales)</h2>
      <p>
        Puedes solicitarnos en cualquier momento: acceder a los datos que tenemos sobre ti o tu empresa,
        corregirlos si están mal, o pedir que se eliminen cuando ya no exista una obligación legal de
        conservarlos (por ejemplo, los comprobantes electrónicos deben conservarse por el plazo que exige
        SUNAT, incluso si dejas de usar el sistema).
      </p>

      <h2>5. Seguridad</h2>
      <p>
        Las contraseñas nunca se guardan en texto plano. El acceso de un super administrador de la
        plataforma a las credenciales de facturación electrónica de tu empresa es de solo configuración —
        el token real nunca se muestra una vez guardado. Toda acción sensible (cambios de permisos,
        creación o bloqueo de usuarios, etc.) queda registrada en un historial de auditoría.
      </p>

      <h2>6. Contacto</h2>
      <p>
        Para cualquier consulta sobre tus datos: <a href="mailto:juancarlosrojochavez1@gmail.com">juancarlosrojochavez1@gmail.com</a>
      </p>
    </LegalShell>
  );
}
