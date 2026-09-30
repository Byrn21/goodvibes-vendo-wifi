const fs = require('fs');
let content = fs.readFileSync('admin.html', 'utf8');

// 3. Fix toggleSidebar function - separate mobile and desktop behavior
const oldToggle = `      function toggleSidebar(forceState) {
        var isCollapsed = forceState !== undefined
          ? forceState
          : els.sidebar.classList.contains('collapsed');
        if (isCollapsed) {
          els.sidebar.classList.remove('collapsed');
          els.sidebar.classList.remove('collapsed-mobile');
          els.overlay.classList.add('hidden');
        } else {
          els.sidebar.classList.add('collapsed');
        }
      }`;

const newToggle = `      function toggleSidebar(forceState) {
        var isMobile = window.innerWidth <= 768;
        if (isMobile) {
          var isCollapsed = forceState !== undefined
            ? forceState
            : !els.sidebar.classList.contains('collapsed-mobile');
          if (isCollapsed) {
            els.sidebar.classList.remove('collapsed-mobile');
            els.overlay.classList.remove('hidden');
          } else {
            els.sidebar.classList.add('collapsed-mobile');
            els.overlay.classList.add('hidden');
          }
        } else {
          var isCollapsed = forceState !== undefined
            ? forceState
            : !els.sidebar.classList.contains('collapsed');
          if (isCollapsed) {
            els.sidebar.classList.remove('collapsed');
          } else {
            els.sidebar.classList.add('collapsed');
          }
        }
      }`;

if (content.indexOf(oldToggle) === -1) {
  console.log('ERROR: toggleSidebar not found');
  process.exit(1);
}
content = content.replace(oldToggle, newToggle);
fs.writeFileSync('admin.html', content, 'utf8');
console.log('Step 2: toggleSidebar fixed');
