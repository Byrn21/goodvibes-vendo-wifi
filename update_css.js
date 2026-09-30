const fs = require('fs');
let content = fs.readFileSync('assets/style.css', 'utf8');

// 1. Fix toggle button - show on all screen sizes, position on left for desktop
const oldToggleCSS = `.admin-sidebar__toggle {
  position: absolute;
  top: 12px;
  right: 12px;
  background: none;
  border: none;
  color: var(--sidebar-text, #e2e8f0);
  cursor: pointer;
  padding: 6px;
  display: none;
  z-index: 1001;
}`;

const newToggleCSS = `.admin-sidebar__toggle {
  position: absolute;
  top: 12px;
  left: 12px;
  background: none;
  border: none;
  color: var(--sidebar-text, #e2e8f0);
  cursor: pointer;
  padding: 6px 8px;
  display: none;
  z-index: 1001;
  border-radius: 4px;
  transition: color 0.2s;
}

.admin-sidebar__toggle:hover {
  color: var(--primary, #5c3d11);
}

.admin-sidebar__toggle i.bi {
  font-size: 1.4rem;
}

.admin-sidebar__toggle .admin-sidebar__toggle-text {
  display: none;
}`;

if (content.indexOf(oldToggleCSS) === -1) {
  console.log('ERROR: toggle CSS not found');
  process.exit(1);
}
content = content.replace(oldToggleCSS, newToggleCSS);

// 2. Remove old hamburger-specific styles (they reference .hamburger class which we no longer use)
content = content.replace(`
.admin-sidebar__toggle .hamburger,
.admin-sidebar__toggle .hamburger::before,
.admin-sidebar__toggle .hamburger::after {
  display: block;
  width: 24px;
  height: 2px;
  background-color: var(--sidebar-text, #e2e8f0);
  border-radius: 2px;
  position: relative;
}

.admin-sidebar__toggle .hamburger::before,
.admin-sidebar__toggle .hamburger::after {
  content: '';
  position: absolute;
  left: 0;
}

.admin-sidebar__toggle .hamburger::before { top: -8px; }
.admin-sidebar__toggle .hamburger::after { top: 8px; }`, '');

// 3. Fix the admin-sidebar__content padding to account for visible toggle on desktop
const oldContentCSS = `.admin-sidebar__content {
  padding: 20px;
  padding-top: 60px;
}`;

const newContentCSS = `.admin-sidebar__content {
  padding: 20px;
  padding-top: 60px;
}

@media (min-width: 769px) {
  .admin-sidebar__content {
    padding-top: 30px;
  }
}`;

if (content.indexOf(oldContentCSS) === -1) {
  console.log('ERROR: content CSS not found');
  process.exit(1);
}
content = content.replace(oldContentCSS, newContentCSS);

// 4. Fix media query for mobile - show toggle on mobile and adjust overlay behavior
const oldMediaMobile = `@media (max-width: 768px) {
  .admin-sidebar__toggle {
    display: block;
  }

  .admin-sidebar {
    position: fixed;
    transform: translateX(0);
  }

  .admin-sidebar.collapsed-mobile {
    transform: translateX(-100%);
  }
}`;

const newMediaMobile = `@media (max-width: 768px) {
  .admin-sidebar__toggle {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .admin-sidebar__toggle .admin-sidebar__toggle-text {
    display: inline;
  }

  .admin-sidebar {
    position: fixed;
    transform: translateX(0);
    transition: transform 0.3s ease;
  }

  .admin-sidebar.collapsed-mobile {
    transform: translateX(-100%);
  }
}`;

if (content.indexOf(oldMediaMobile) === -1) {
  console.log('ERROR: mobile media query not found');
  process.exit(1);
}
content = content.replace(oldMediaMobile, newMediaMobile);

// 5. Add desktop toggle visibility
const oldMediaDesktop = `@media (min-width: 769px) {
  .admin-overlay {
    display: none;
  }
}`;

const newMediaDesktop = `@media (min-width: 769px) {
  .admin-sidebar__toggle {
    display: block;
  }

  .admin-overlay {
    display: none;
  }
}`;

if (content.indexOf(oldMediaDesktop) === -1) {
  console.log('ERROR: desktop media query not found');
  process.exit(1);
}
content = content.replace(oldMediaDesktop, newMediaDesktop);

// 6. Add admin user footer styles before "/* Main content */"
const mainContentMarker = `/* Main content */`;

const adminFooterStyles = `/* Admin user footer */
.admin-sidebar__footer {
  margin-top: auto;
  padding-top: 20px;
  border-top: 1px solid var(--sidebar-border, #334159);
}

.admin-user {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 15px;
  color: var(--sidebar-text, #e2e8f0);
  font-size: 0.875rem;
}

.admin-user__icon {
  font-size: 1.2rem;
  flex-shrink: 0;
}

.admin-user__info {
  display: flex;
  flex-direction: column;
}

.admin-user__label {
  font-size: 0.7rem;
  opacity: 0.7;
}

.admin-user__name {
  font-weight: 600;
}

/* Collapsed sidebar: hide text but show icon */
.admin-sidebar.collapsed .admin-sidebar__footer {
  padding-top: 10px;
}

.admin-sidebar.collapsed .admin-user__label,
.admin-sidebar.collapsed .admin-user__name {
  display: none;
}

`;

content = content.replace(mainContentMarker, adminFooterStyles + mainContentMarker);