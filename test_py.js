const fs = require('fs');
let c = fs.readFileSync('admin.html', 'utf8');
console.log('Read OK, length: ' + c.length);
fs.writeFileSync('admin.html', c, 'utf8');
console.log('Wrote admin.html');
