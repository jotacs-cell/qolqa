import { useEffect, useState } from "react";
import LandingPage from "./LandingPage";
import Login from "./Login";
import SuperAdmin from "./SuperAdmin";
import CotizacionForm from "./CotizacionForm";

/**
 * Router mínimo por hash, solo para poder previsualizar las 3 vistas en este
 * mismo proyecto (#/login, #/admin) sin agregar react-router todavía.
 */
export default function App() {
  const [hash, setHash] = useState(window.location.hash);

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Cuando el hash apunta a una sección normal del landing (ej. #planes) en
  // vez de a una de estas rutas, el navegador intenta hacer scroll al id
  // apenas cambia el hash — pero en ese instante la sección todavía no
  // existe en el DOM (React recién está montando LandingPage), así que el
  // scroll automático nunca encuentra el elemento. Lo reintentamos a mano
  // una vez que el DOM ya tiene la sección pintada.
  useEffect(() => {
    if (hash && hash !== "#/login" && hash !== "#/admin" && hash !== "#/cotizacion-demo") {
      const id = hash.replace(/^#/, "");
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
        });
      });
    }
  }, [hash]);

  if (hash === "#/login") return <Login />;
  if (hash === "#/admin") return <SuperAdmin />;
  if (hash === "#/cotizacion-demo") return <CotizacionForm />;
  return <LandingPage />;
}
