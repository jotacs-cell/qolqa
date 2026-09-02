/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_LOGIN_URL?: string;
  readonly VITE_APP_SIGNUP_URL?: string;
  readonly VITE_LEADS_API_URL?: string;
  readonly VITE_WHATSAPP_NUMBER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
