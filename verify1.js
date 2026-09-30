const fs = require(String.fromCharCode(102,115));
const c = fs.readFileSync(String.fromCharCode(97,100,109,105,110,46,104,116,109,108), String.fromCharCode(117,116,102,56));
// Check template changes
let idx = c.indexOf(String.fromCharCode(84,69,77,80,76,65,84,69,95));
console.log(c.substring(idx, idx + 120));
// Check column widths
idx = c.indexOf(String.fromCharCode(119,115,91,39,33,99,111,108,115,39]));
if (idx >= 0) console.log(String.fromCharCode(102,111,117,110,100,58,32) + c.substring(idx, idx + 80));
// Check import helper text
idx = c.indexOf(String.fromCharCode(82,101,113,117,105,114,101,100));
console.log(c.substring(idx, idx + 120));
