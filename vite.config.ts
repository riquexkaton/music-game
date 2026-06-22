import { defineConfig } from "vite";

const port = Number(process.env.PORT) || 5173;

export default defineConfig({
  // En dev normal abre el navegador y usa 5173; bajo el preview (PORT seteado)
  // respeta el puerto asignado y no abre una pestaña extra.
  server: { port, open: !process.env.PORT },
});
