import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import type { Connect } from 'vite';

const adminFallback:Connect.NextHandleFunction=(request,_response,next)=>{
  if(request.url?.startsWith('/admin/') && request.headers.accept?.includes('text/html')
    && !request.url.split('?')[0].endsWith('.html')) request.url='/admin/index.html';
  next();
};
export default defineConfig({
  plugins: [react(), {name:'admin-routing',configureServer(server){server.middlewares.use(adminFallback);},
    configurePreviewServer(server){server.middlewares.use(adminFallback);}}],
  server: { proxy: { '/api': process.env.API_PROXY_TARGET || 'http://127.0.0.1:3000' } },
  build:{rollupOptions:{input:{
    web:fileURLToPath(new URL('./index.html',import.meta.url)),
    admin:fileURLToPath(new URL('./admin/index.html',import.meta.url)),
  }}},
});
