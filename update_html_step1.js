const fs = require('fs');
let content = fs.readFileSync('admin.html', 'utf8');

// 1. Add Bootstrap Icons CDN and XLSX library before body tag
const bodyMatch = content.match(/<body>/);
if (!bodyMatch) {
  console.log('ERROR: body tag not found');
  process.exit(1);
}
content = content.replace(
  '<body>',
  '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.0/font/bootstrap-icons.css">\n' +
  '<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>\n' +
  '<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>\n' +
  '<body>'
);

// 2. Add adminUsername to DOM elements cache
content = content.replace(
  "overlay:        document.getElementById('admin-overlay'),\n      };",
  "overlay:        document.getElementById('admin-overlay'),\n        adminUsername: document.getElementById('admin-username'),\n      };"
);

fs.writeFileSync('admin.html', content, 'utf8');
console.log('Step 1: CDN and DOM cache updated');
