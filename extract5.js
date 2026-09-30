const fs = require('fs');
const c = fs.readFileSync('backend/src/routes/admin.js', 'utf8');
const lines = c.split(String.fromCharCode(10));
for (let i = 300; i < 330; i++) {
  if (i < lines.length) console.log((i+1) + ': ' + lines[i]);
}
