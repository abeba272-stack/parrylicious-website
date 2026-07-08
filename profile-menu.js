import { isAuthConfigured, getSession, signOut, onAuthStateChange } from './auth-client.js';
import { getCurrentUserRole } from './data-client.js';

function safeRoleLabel(role) {
  if (role === 'admin') return 'admin';
  if (role === 'staff') return 'staff';
  return 'gast/kunde';
}

function buildMenu(container) {
  container.innerHTML = `
    <div class="profile-menu">
      <button class="btn small ghost profile-trigger" type="button">Profil</button>
      <div class="profile-dropdown hidden">
        <div class="profile-meta">
          <div class="profile-email">Gast</div>
          <div class="profile-role">Nicht eingeloggt</div>
        </div>
        <a class="btn small ghost" href="admin.html">Profil-Einstellungen</a>
        <a class="btn small ghost profile-login" href="login.html">Einloggen</a>
        <button class="btn small ghost profile-logout hidden" type="button">Abmelden</button>
      </div>
    </div>
  `;
  return {
    trigger: container.querySelector('.profile-trigger'),
    dropdown: container.querySelector('.profile-dropdown'),
    emailEl: container.querySelector('.profile-email'),
    roleEl: container.querySelector('.profile-role'),
    loginLink: container.querySelector('.profile-login'),
    logoutBtn: container.querySelector('.profile-logout')
  };
}

async function readUserState() {
  if (!isAuthConfigured) return { email: null, role: 'gast/kunde' };

  let session = null;
  try {
    session = await getSession();
  } catch (_error) {
    return { email: null, role: 'gast/kunde' };
  }
  const email = session?.user?.email || null;
  if (!email) return { email: null, role: 'gast/kunde' };

  let role = 'customer';
  try {
    role = await getCurrentUserRole();
  } catch (_error) {
    role = 'customer';
  }
  return { email, role: safeRoleLabel(role) };
}

function wireInteractions(parts) {
  parts.trigger.addEventListener('click', () => {
    parts.dropdown.classList.toggle('hidden');
  });

  document.addEventListener('click', (event) => {
    const menuRoot = parts.trigger.closest('.profile-menu');
    if (!menuRoot?.contains(event.target)) {
      parts.dropdown.classList.add('hidden');
    }
  });
}

async function syncState(parts) {
  const state = await readUserState();
  if (!state.email) {
    parts.emailEl.textContent = 'Gast';
    parts.roleEl.textContent = 'Nicht eingeloggt';
    parts.loginLink.classList.remove('hidden');
    parts.logoutBtn.classList.add('hidden');
    return;
  }
  parts.emailEl.textContent = state.email;
  parts.roleEl.textContent = `Rolle: ${state.role}`;
  parts.loginLink.classList.add('hidden');
  parts.logoutBtn.classList.remove('hidden');
}

async function initMenu(container) {
  const parts = buildMenu(container);
  wireInteractions(parts);

  parts.logoutBtn.addEventListener('click', async () => {
    if (!isAuthConfigured) return;
    await signOut();
    parts.dropdown.classList.add('hidden');
    await syncState(parts);
    window.location.href = 'home.html';
  });

  if (isAuthConfigured) {
    onAuthStateChange(() => {
      syncState(parts);
    });
  }
  syncState(parts);
}

document.querySelectorAll('[data-profile-menu]').forEach((node) => {
  initMenu(node);
});
