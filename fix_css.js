const fs = require('fs');

// ============================================================
// Add CSS styles for connection instructions modal
// ============================================================
let css = fs.readFileSync('C:\\Users\\Admin\\omada-captive-portal\\assets\\style.css', 'utf8');

// Add styles at the end (before the final closing or at the end)
const newStyles = `
/* ---- Connection Instructions Modal ---- */
.connection-instructions__dialog {
  max-width: 420px;
  width: 90%;
  margin: 0 auto;
}

.connection-instructions__body {
  padding: 1.5rem;
  text-align: center;
}

.connection-instructions__list {
  text-align: left;
  padding: 0.75rem 0;
  margin: 1rem 0;
  line-height: 1.8;
}

.connection-instructions__list li {
  font-size: 0.95rem;
  color: var(--text-2);
  margin-bottom: 0.5rem;
}

.connection-instructions__list--tl {
  display: none;
}

.modal-close {
  position: absolute;
  top: 12px;
  right: 12px;
}
`;

// Append before the final line if it ends with }\r\n
css = css.replace(/\r\n$/, '') + newStyles + '\r\n';
fs.writeFileSync('C:\\Users\\Admin\\omada-captive-portal\\assets\\style.css', css);
console.log('CSS styles added.');