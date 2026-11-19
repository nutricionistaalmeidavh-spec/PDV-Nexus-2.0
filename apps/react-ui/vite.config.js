import {defineConfig} from 'vite';
export default defineConfig({
  base:'/',
  server:{host:'127.0.0.1',port:5173,strictPort:true,proxy:{'/api':{target:'http://127.0.0.1:3434',changeOrigin:true}}},
  build:{target:'es2022',outDir:'dist',emptyOutDir:true}
});
