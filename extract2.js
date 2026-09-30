const fs = require('fs');
const c = fs.readFileSync('admin.html', 'utf8');
const lines = c.split('\n');
for (let i = 534; i < 580; i++) {
  console.log((i+1) + ': ' + lines[i]);
}
