const fs = require('fs');
const c = fs.readFileSync('admin.html', 'utf8');
const lines = c.split('\n');
for (let i = 414; i < 510; i++) {
  console.log((i+1) + ': ' + lines[i]);
}
