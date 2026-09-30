const fs = require('fs');
let content = fs.readFileSync('admin.html', 'utf8');

// 4. Add fetchAdminUsername function after checkAuth()
const oldCheckAuth = "checkAuth();";

const newCheckAuth = `checkAuth();

      // Fetch admin username from API
      function fetchAdminUsername() {
        api('/api/admin/me')
          .then(function (res) {
            if (res.ok && res.data && res.data.username) {
              if (els.adminUsername) {
                els.adminUsername.textContent = res.data.username;
              }
              localStorage.setItem('adminUsername', res.data.username);
            }
          })
          .catch(function () {
            var username = localStorage.getItem('adminUsername') || 'admin';
            if (els.adminUsername) {
              els.adminUsername.textContent = username;
            }
          });
      }

      fetchAdminUsername();`;

if (content.indexOf(oldCheckAuth) === -1) {
  console.log('ERROR: checkAuth() not found');
  process.exit(1);
}

// Only replace the first occurrence
const idx = content.indexOf(oldCheckAuth);
content = content.substring(0, idx) + newCheckAuth + content.substring(idx + oldCheckAuth.length);

fs.writeFileSync('admin.html', content, 'utf8');
console.log('Step 3: fetchAdminUsername added');
