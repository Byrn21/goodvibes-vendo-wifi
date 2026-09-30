const fs = require('fs');
const c = fs.readFileSync('assets/style.css', 'utf8');
const lines = c.split(String.fromCharCode(10));
for (let i = 0; i < lines.length; i++) {
  if (lines[i].indexOf('admin-sidebar__toggle') >= 0 || lines[i].indexOf('admin-overlay') >= 0 || lines[i].indexOf('.admin-sidebar') >= 0) {
    for (let j = Math.max(0, i - 1); j < Math.min(lines.length, i + 10); j++) {
      console.log((j+1) + ': ' + lines[j]);
    }
    console.log('---');
  }
}
