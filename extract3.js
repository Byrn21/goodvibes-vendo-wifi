const fs = require('fs');
const c = fs.readFileSync('backend/src/routes/admin.js', 'utf8');
const lines = c.split(String.fromCharCode(10));
let start = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].indexOf('router.post') >= 0 && lines[i].indexOf('vouchers/import') >= 0) {
    start = i;
    break;
  }
}
if (start >= 0) {
  for (let i = start; i < start + 70; i++) {
    if (i >= lines.length) break;
    console.log((i+1) + ': ' + lines[i]);
  }
}
