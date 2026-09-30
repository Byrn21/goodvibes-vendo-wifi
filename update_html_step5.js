const fs = require('fs');
let content = fs.readFileSync('admin.html', 'utf8');

// 6. Add Download Template button after Import Vouchers button
const oldButton = '<div class="form-field actions-end"><button type="submit" class="btn btn--primary">Import Vouchers</button></div>';

const newButtons = '<div class="form-field actions-end"><button type="submit" class="btn btn--primary">Import Vouchers</button></div>' +
                   '<div class="form-field"><button type="button" class="btn btn--outline" id="download-template">Download Template</button></div>';

if (content.indexOf(oldButton) === -1) {
  console.log('ERROR: submit button not found');
  process.exit(1);
}
content = content.replace(oldButton, newButtons);
console.log('Button added');

// 7. Add event listener for download template button
const oldFormListener = `        var form = document.getElementById('import-form');\r\n        if (form) {`;

const newFormListener = `        var form = document.getElementById('import-form');\r\n        var templateBtn = document.getElementById('download-template');\r\n        if (templateBtn) {\r\n          templateBtn.addEventListener('click', function () { downloadTemplate(); });\r\n        }\r\n        if (form) {`;

if (content.indexOf(oldFormListener) === -1) {
  console.log('ERROR: form listener not found');
  // Try without \r\n
  const oldFormListener2 = `        var form = document.getElementById('import-form');\n        if (form) {`;
  const newFormListener2 = `        var form = document.getElementById('import-form');\n        var templateBtn = document.getElementById('download-template');\n        if (templateBtn) {\n          templateBtn.addEventListener('click', function () { downloadTemplate(); });\n        }\n        if (form) {`;
  
  if (content.indexOf(oldFormListener2) === -1) {
    console.log('ERROR: form listener not found with either line ending');
    process.exit(1);
  }
  content = content.replace(oldFormListener2, newFormListener2);
} else {
  content = content.replace(oldFormListener, newFormListener);
}

fs.writeFileSync('admin.html', content, 'utf8');
console.log('Step 5 complete: Download Template button and event listener added');

