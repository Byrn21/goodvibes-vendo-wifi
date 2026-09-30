const fs = require('fs');
let content = fs.readFileSync('admin.html', 'utf8');

// 5. Add downloadTemplate function before renderImportForm
const importFormStart = "      function renderImportForm() {";

const newFunctions = `      // Download CSV template for voucher import
      function downloadTemplate() {
        var csvContent = 'Code,Type,Duration,Price\\r\\n' +
                         '123456,standard,60,\\u20b150.00\\r\\n' +
                         '789012,premium,120,\\u20b1100.00\\r\\n';
        var BOM = new Uint8Array([0xEF, 0xBB, 0xBF]);
        var blob = new Blob([BOM, csvContent], { type: 'text/csv;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'voucher-template.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      `;

if (content.indexOf(importFormStart) === -1) {
  console.log('ERROR: renderImportForm not found');
  process.exit(1);
}
content = content.replace(importFormStart, newFunctions + importFormStart);
fs.writeFileSync('admin.html', content, 'utf8');
console.log('Step 4: downloadTemplate function added');
