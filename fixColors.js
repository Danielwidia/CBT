const fs = require('fs');

// Fix administrasi_guru.html
let html = fs.readFileSync('administrasi_guru.html', 'utf8');
html = html.replace(/amber/g, 'blue');
html = html.replace(/orange/g, 'cyan');
html = html.replace(/#d97706/g, '#2563eb');
html = html.replace(/#fef3c7/g, '#eff6ff');
html = html.replace(/#f59e0b/g, '#3b82f6');
html = html.replace(/245, 158, 11/g, '59, 130, 246');
fs.writeFileSync('administrasi_guru.html', html);

// Fix index.html specifically for the E-Kinerja buttons
let idx = fs.readFileSync('index.html', 'utf8');
idx = idx.replace(/text-amber-500/g, 'text-blue-500')
         .replace(/bg-amber-500\/20/g, 'bg-blue-500/20')
         .replace(/border-amber-500\/30/g, 'border-blue-500/30')
         .replace(/bg-amber-500\/10/g, 'bg-blue-500/10')
         .replace(/hover:bg-amber-500\/20/g, 'hover:bg-blue-500/20')
         .replace(/from-amber-500/g, 'from-blue-500')
         .replace(/to-orange-500/g, 'to-cyan-500')
         .replace(/from-amber-600/g, 'from-blue-600')
         .replace(/to-orange-600/g, 'to-cyan-600');
         
fs.writeFileSync('index.html', idx);
console.log('Colors replaced successfully.');
