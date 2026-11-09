/* =========================================================
   BITÁCORA INDUSTRIAL - CLIENTE SUPABASE
   Lectura pública; escritura autenticada; eliminación admin.
   La seguridad real está en PostgreSQL RLS, no en esta UI.
   ========================================================= */

let currentModal = null;
let currentEditModal = null;
let currentProfile = null;
let currentSession = null;
let selectedMonth = getCurrentMonthString();
let isLoading = false;

function getCurrentMonthString() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getUserRole() {
    return currentProfile?.role || null;
}

function isAuthenticated() {
    return Boolean(currentSession?.user && currentProfile);
}

function isAdmin() {
    return getUserRole() === 'admin';
}

function setDbStatus(message, type = 'secondary') {
    const status = document.getElementById('dbStatus');
    if (!status) return;
    status.textContent = message;
    status.className = `badge bg-${type} status-badge`;
}

function showMessage(message, type = 'danger') {
    const box = document.getElementById('appMessage');
    if (!box) {
        alert(message);
        return;
    }
    box.className = `alert alert-${type} py-2 small`;
    box.textContent = message;
    box.classList.remove('d-none');
    window.setTimeout(() => box.classList.add('d-none'), 5000);
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
}

async function loadProfile(session) {
    currentSession = session || null;
    currentProfile = null;

    if (session?.user?.id) {
        const { data, error } = await window._supabase
            .from('profiles')
            .select('id, username, role')
            .eq('id', session.user.id)
            .maybeSingle();

        if (error) {
            console.error('No se pudo consultar el perfil:', error);
        } else {
            currentProfile = data || null;
        }
    }

    checkAuthUI();
}

function checkAuthUI() {
    const loggedIn = isAuthenticated();
    const admin = isAdmin();

    document.getElementById('loginBtn')?.classList.toggle('d-none', loggedIn);
    document.getElementById('logoutBtn')?.classList.toggle('d-none', !loggedIn);
    document.getElementById('taskEditorSection')?.classList.toggle('d-none', !loggedIn);
    document.getElementById('clearAllBtn')?.classList.toggle('d-none', !admin);
    document.getElementById('arrastrarPendientesBtn')?.classList.toggle('d-none', !loggedIn);

    const usernameDisplay = document.getElementById('adminUsernameDisplay');
    if (usernameDisplay) {
        usernameDisplay.textContent = loggedIn
            ? `${currentProfile.username} · ${admin ? 'Administrador' : 'Usuario'}`
            : '';
    }

    const publicHint = document.getElementById('publicViewHint');
    if (publicHint) publicHint.classList.toggle('d-none', loggedIn);

    // Los controles de cada tarea se vuelven a dibujar según el perfil.
    if (window._lastTaskRows) render(window._lastTaskRows);
}

async function refreshSessionAndProfile() {
    const { data, error } = await window._supabase.auth.getSession();
    if (error) console.error('Error obteniendo sesión:', error);
    await loadProfile(data?.session || null);
}

async function boot() {
    renderMonthSelectorUI();
    await refreshSessionAndProfile();

    // No convertir este callback en async: se difiere el trabajo de Supabase
    // para evitar bloquear el flujo interno de auth.
    window._supabase.auth.onAuthStateChange((_event, session) => {
        Promise.resolve().then(async () => {
            await loadProfile(session || null);
            await init({ skipProfile: true });
        });
    });

    await init({ skipProfile: true });
}

async function init(options = {}) {
    if (isLoading) return;
    isLoading = true;
    try {
        if (!options.skipProfile) await refreshSessionAndProfile();
        renderMonthSelectorUI();

        const { data, error } = await window._supabase
            .from('tareas')
            .select('*')
            .eq('mes_periodo', selectedMonth)
            .order('id', { ascending: false });

        if (error) throw error;
        window._lastTaskRows = data || [];
        render(window._lastTaskRows);
        setDbStatus('Conectado', 'success');
    } catch (error) {
        console.error('Error cargando bitácora:', error);
        setDbStatus('Error de conexión', 'danger');
        const list = document.getElementById('taskList');
        if (list) {
            list.replaceChildren();
            const item = document.createElement('li');
            item.className = 'list-group-item text-center text-danger py-4';
            item.textContent = 'No se pudieron cargar las tareas. Verifica tu conexión e inténtalo nuevamente.';
            list.appendChild(item);
        }
    } finally {
        isLoading = false;
    }
}

function renderMonthSelectorUI() {
    const container = document.getElementById('monthSelectorContainer') || createMonthSelectorDOM();
    const input = document.getElementById('filtroMes');
    if (input) {
        input.value = selectedMonth;
        input.max = getCurrentMonthString();
    }
    return container;
}

function createMonthSelectorDOM() {
    const div = document.createElement('div');
    div.id = 'monthSelectorContainer';
    div.className = 'month-selector mb-3 d-flex align-items-center flex-wrap gap-2';

    const label = document.createElement('label');
    label.htmlFor = 'filtroMes';
    label.className = 'form-label m-0 fw-semibold small';
    label.textContent = 'Periodo';

    const input = document.createElement('input');
    input.type = 'month';
    input.id = 'filtroMes';
    input.className = 'form-control form-control-sm month-input';
    input.max = getCurrentMonthString();
    input.value = selectedMonth;
    input.addEventListener('change', () => changeMonth(input.value));

    const dragButton = document.createElement('button');
    dragButton.id = 'arrastrarPendientesBtn';
    dragButton.type = 'button';
    dragButton.className = 'btn btn-sm btn-outline-primary d-none';
    dragButton.textContent = 'Arrastrar pendientes del mes anterior';
    dragButton.addEventListener('click', arrastrarPendientesMesAnterior);

    div.append(label, input, dragButton);
    const card = document.querySelector('#mainCard');
    const heading = card?.querySelector('h2');
    if (heading?.nextSibling) card.insertBefore(div, heading.nextSibling);
    else card?.prepend(div);
    return div;
}

function changeMonth(newMonth) {
    if (!/^\d{4}-\d{2}$/.test(newMonth) || newMonth > getCurrentMonthString()) {
        showMessage('No se pueden visualizar meses futuros ni periodos inválidos.', 'warning');
        const input = document.getElementById('filtroMes');
        if (input) input.value = selectedMonth;
        return;
    }
    selectedMonth = newMonth;
    init({ skipProfile: true });
}

async function arrastrarPendientesMesAnterior() {
    if (!isAuthenticated()) return showMessage('Inicia sesión para realizar esta acción.', 'warning');

    const [year, month] = selectedMonth.split('-').map(Number);
    const previousDate = new Date(year, month - 2, 1);
    const previousMonth = `${previousDate.getFullYear()}-${String(previousDate.getMonth() + 1).padStart(2, '0')}`;

    if (!confirm(`¿Deseas copiar las tareas pendientes y en proceso de ${previousMonth} a ${selectedMonth}?`)) return;

    try {
        const { data, error } = await window._supabase
            .from('tareas')
            .select('texto, descripcion, area, familia, equipo, estado')
            .eq('mes_periodo', previousMonth)
            .in('estado', ['pendiente', 'en_proceso']);
        if (error) throw error;

        if (!data?.length) {
            showMessage('No hay tareas pendientes o en proceso en el mes anterior.', 'info');
            return;
        }

        const copies = data.map(task => ({
            ...task,
            texto: `[Arrastrado] ${task.texto}`,
            mes_periodo: selectedMonth
        }));

        const { error: insertError } = await window._supabase.from('tareas').insert(copies);
        if (insertError) throw insertError;

        showMessage(`${copies.length} tarea(s) copiadas correctamente.`, 'success');
        await init({ skipProfile: true });
    } catch (error) {
        console.error(error);
        showMessage(error.message || 'No se pudieron copiar las tareas.');
    }
}

async function loginAdmin() {
    const username = document.getElementById('adminUser')?.value.trim().toLowerCase() || '';
    const password = document.getElementById('adminPassword')?.value || '';
    const errorBox = document.getElementById('loginErrorMsg');
    const submit = document.getElementById('loginSubmitBtn');

    errorBox?.classList.add('d-none');
    if (!username || !password) {
        if (errorBox) {
            errorBox.textContent = 'Introduce tu usuario y contraseña.';
            errorBox.classList.remove('d-none');
        }
        return;
    }

    if (submit) {
        submit.disabled = true;
        submit.textContent = 'Verificando…';
    }

    try {
        const { data, error } = await window._supabase.functions.invoke('login-username', {
            body: { username, password }
        });

        if (error || !data?.session?.access_token || !data?.session?.refresh_token) {
            throw new Error(data?.error || 'Usuario o contraseña incorrectos.');
        }

        const { error: sessionError } = await window._supabase.auth.setSession({
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token
        });
        if (sessionError) throw sessionError;

        await refreshSessionAndProfile();
        if (!currentProfile) {
            await window._supabase.auth.signOut();
            throw new Error('La cuenta no tiene un perfil válido. Contacta al administrador.');
        }

        bootstrap.Modal.getOrCreateInstance(document.getElementById('loginModal')).hide();
        document.getElementById('adminUser').value = '';
        document.getElementById('adminPassword').value = '';
        await init({ skipProfile: true });
    } catch (error) {
        console.error('Error de inicio de sesión:', error);
        if (errorBox) {
            errorBox.textContent = error.message || 'No se pudo iniciar sesión.';
            errorBox.classList.remove('d-none');
        }
    } finally {
        if (submit) {
            submit.disabled = false;
            submit.textContent = 'Iniciar sesión';
        }
    }
}

async function logoutAdmin() {
    const { error } = await window._supabase.auth.signOut();
    if (error) {
        console.error(error);
        showMessage('No se pudo cerrar la sesión. Inténtalo nuevamente.');
        return;
    }
    currentSession = null;
    currentProfile = null;
    checkAuthUI();
    await init({ skipProfile: true });
}

async function addTask() {
    if (!isAuthenticated()) return showMessage('Inicia sesión para registrar tareas.', 'warning');

    const input = document.getElementById('taskInput');
    const texto = input.value.trim();
    if (!texto) {
        input.focus();
        return showMessage('El título de la tarea es obligatorio.', 'warning');
    }

    const payload = {
        texto,
        descripcion: document.getElementById('taskDescInput').value.trim() || null,
        area: document.getElementById('taskArea').value.trim() || null,
        familia: document.getElementById('taskFamilia').value.trim() || null,
        equipo: document.getElementById('taskEquipo').value.trim() || null,
        estado: 'pendiente',
        mes_periodo: selectedMonth
    };

    const button = document.getElementById('addTaskBtn');
    button.disabled = true;
    try {
        const { error } = await window._supabase.from('tareas').insert([payload]);
        if (error) throw error;

        ['taskInput', 'taskDescInput', 'taskArea', 'taskFamilia', 'taskEquipo']
            .forEach(id => { document.getElementById(id).value = ''; });
        showMessage('Tarea registrada correctamente.', 'success');
        await init({ skipProfile: true });
    } catch (error) {
        console.error(error);
        showMessage(error.message || 'Error al guardar la tarea.');
    } finally {
        button.disabled = false;
    }
}

function openStatusModal(id, currentStatus, currentAuthor, currentComment) {
    if (!isAuthenticated()) return;
    document.getElementById('modalTaskId').value = id;
    document.getElementById('modalStatusSelect').value = currentStatus || 'pendiente';
    document.getElementById('modalAuthor').value = currentAuthor || '';
    document.getElementById('modalComment').value = currentComment || '';
    currentModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('completeModal'));
    currentModal.show();
}

async function saveTaskStatus() {
    if (!isAuthenticated()) return showMessage('Inicia sesión para modificar tareas.', 'warning');

    const id = document.getElementById('modalTaskId').value;
    const status = document.getElementById('modalStatusSelect').value;
    const realizadoPor = document.getElementById('modalAuthor').value.trim();
    const comentario = document.getElementById('modalComment').value.trim();

    const payload = {
        estado: status,
        realizado_por: realizadoPor || null,
        comentario: comentario || null,
        fecha_realizacion: status === 'realizado' ? new Date().toISOString() : null
    };

    try {
        const { error } = await window._supabase.from('tareas').update(payload).eq('id', id);
        if (error) throw error;
        currentModal?.hide();
        showMessage('Estado actualizado correctamente.', 'success');
        await init({ skipProfile: true });
    } catch (error) {
        console.error(error);
        showMessage(error.message || 'No se pudo actualizar el estado.');
    }
}

function editTask(row) {
    if (!isAuthenticated()) return;
    document.getElementById('editTaskId').value = row.id;
    document.getElementById('editTaskInputText').value = row.texto || '';
    document.getElementById('editTaskInputDesc').value = row.descripcion || '';
    document.getElementById('editTaskArea').value = row.area || '';
    document.getElementById('editTaskFamilia').value = row.familia || '';
    document.getElementById('editTaskEquipo').value = row.equipo || '';
    currentEditModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('editModal'));
    currentEditModal.show();
}

async function saveEditedTask() {
    if (!isAuthenticated()) return showMessage('Inicia sesión para modificar tareas.', 'warning');

    const id = document.getElementById('editTaskId').value;
    const texto = document.getElementById('editTaskInputText').value.trim();
    if (!texto) return showMessage('El título de la tarea es obligatorio.', 'warning');

    const payload = {
        texto,
        descripcion: document.getElementById('editTaskInputDesc').value.trim() || null,
        area: document.getElementById('editTaskArea').value.trim() || null,
        familia: document.getElementById('editTaskFamilia').value.trim() || null,
        equipo: document.getElementById('editTaskEquipo').value.trim() || null
    };

    try {
        const { error } = await window._supabase.from('tareas').update(payload).eq('id', id);
        if (error) throw error;
        currentEditModal?.hide();
        showMessage('Tarea modificada correctamente.', 'success');
        await init({ skipProfile: true });
    } catch (error) {
        console.error(error);
        showMessage(error.message || 'No se pudo modificar la tarea.');
    }
}

async function deleteTask(id) {
    if (!isAdmin()) return showMessage('Solo un administrador puede eliminar tareas.', 'warning');
    if (!confirm('¿Estás seguro de eliminar este registro? Esta acción no se puede deshacer.')) return;

    const { error } = await window._supabase.from('tareas').delete().eq('id', id);
    if (error) {
        console.error(error);
        showMessage(error.message || 'No se pudo eliminar la tarea.');
        return;
    }
    showMessage('Registro eliminado.', 'success');
    await init({ skipProfile: true });
}

async function clearAll() {
    if (!isAdmin()) return showMessage('Solo un administrador puede eliminar registros.', 'warning');
    if (!confirm(`¿Seguro que quieres eliminar todas las entradas del periodo ${selectedMonth}? Esta acción no se puede deshacer.`)) return;

    const { error } = await window._supabase.from('tareas').delete().eq('mes_periodo', selectedMonth);
    if (error) {
        console.error(error);
        showMessage(error.message || 'No se pudieron eliminar las entradas.');
        return;
    }
    showMessage('Se eliminaron las entradas del periodo seleccionado.', 'success');
    await init({ skipProfile: true });
}

async function exportPDF(tipo) {
    try {
        let query = window._supabase.from('tareas').select('*').eq('mes_periodo', selectedMonth);
        if (tipo === 'pendientes') query = query.in('estado', ['pendiente', 'en_proceso']);
        else if (tipo === 'realizados') query = query.eq('estado', 'realizado');

        const { data, error } = await query.order('id', { ascending: false });
        if (error) throw error;
        if (!data?.length) {
            showMessage(`No hay registros para el periodo ${selectedMonth}.`, 'info');
            return;
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16);
        doc.text(`Bitacora - Reporte Periodo ${selectedMonth}`, 14, 20);
        let y = 32;

        data.forEach((task, index) => {
            const title = `${index + 1}. [${(task.estado || 'pendiente').toUpperCase()}] ${task.texto || ''}`;
            const lines = doc.splitTextToSize(title, 180);
            const blockHeight = lines.length * 6 + 5;
            if (y + blockHeight > 280) {
                doc.addPage();
                y = 20;
            }
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10);
            doc.text(lines, 14, y);
            y += lines.length * 6;
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            const details = [task.area && `Área: ${task.area}`, task.familia && `Familia: ${task.familia}`, task.equipo && `Equipo: ${task.equipo}`].filter(Boolean).join(' | ');
            if (details) {
                const detailLines = doc.splitTextToSize(details, 180);
                doc.text(detailLines, 14, y);
                y += detailLines.length * 5;
            }
            if (task.descripcion) {
                const descLines = doc.splitTextToSize(task.descripcion, 180);
                doc.text(descLines, 14, y);
                y += descLines.length * 5;
            }
            y += 5;
        });
        doc.save(`Bitacora_${selectedMonth}_${tipo}.pdf`);
    } catch (error) {
        console.error(error);
        showMessage('No se pudo generar el PDF.');
    }
}

function toggleTheme() {
    const html = document.documentElement;
    const isDark = html.getAttribute('data-bs-theme') === 'dark';
    const nextTheme = isDark ? 'light' : 'dark';
    html.setAttribute('data-bs-theme', nextTheme);
    localStorage.setItem('theme', nextTheme); // Solo preferencia visual, nunca credenciales/roles.
    updateThemeButton(nextTheme);
}

function updateThemeButton(theme) {
    const button = document.getElementById('themeToggleBtn');
    if (button) button.textContent = theme === 'dark' ? '☀️ Claro' : '🌙 Oscuro';
}

function render(rows = []) {
    const list = document.getElementById('taskList');
    if (!list) return;
    list.replaceChildren();

    const count = document.getElementById('taskCount');
    if (count) count.textContent = `${rows.length} ${rows.length === 1 ? 'entrada' : 'entradas'} en ${selectedMonth}`;

    const totals = {
        pendiente: rows.filter(row => (row.estado || 'pendiente') === 'pendiente').length,
        en_proceso: rows.filter(row => row.estado === 'en_proceso').length,
        realizado: rows.filter(row => row.estado === 'realizado').length
    };
    Object.entries(totals).forEach(([key, value]) => {
        const target = document.getElementById(`count-${key}`);
        if (target) target.textContent = value;
    });

    if (!rows.length) {
        const empty = document.createElement('li');
        empty.className = 'list-group-item empty-state text-center py-5';
        empty.innerHTML = '<div class="empty-icon">📋</div><strong>No hay entradas registradas</strong><p class="text-muted small mb-0 mt-1">No existen tareas para el periodo seleccionado.</p>';
        list.appendChild(empty);
        return;
    }

    rows.forEach(row => {
        const item = document.createElement('li');
        item.className = 'list-group-item task-item';

        const content = document.createElement('div');
        content.className = 'task-content';

        const top = document.createElement('div');
        top.className = 'task-topline';

        const title = document.createElement('h3');
        title.className = `task-title ${row.estado === 'realizado' ? 'task-title-completed' : ''}`;
        title.textContent = row.texto || '(Sin título)';

        const status = document.createElement('span');
        const state = row.estado || 'pendiente';
        status.className = `badge task-status status-${state}`;
        status.textContent = state === 'en_proceso' ? 'En proceso' : state === 'realizado' ? 'Realizada' : 'Pendiente';
        top.append(title, status);
        content.appendChild(top);

        const tags = document.createElement('div');
        tags.className = 'task-tags';
        [['Área', row.area], ['Familia', row.familia], ['Equipo', row.equipo]].forEach(([label, value]) => {
            if (!value) return;
            const tag = document.createElement('span');
            tag.className = 'task-tag';
            tag.textContent = `${label}: ${value}`;
            tags.appendChild(tag);
        });
        if (tags.childElementCount) content.appendChild(tags);

        if (row.descripcion) {
            const description = document.createElement('p');
            description.className = 'task-description';
            description.textContent = row.descripcion;
            content.appendChild(description);
        }

        const meta = document.createElement('div');
        meta.className = 'task-meta';
        const created = row.created_at ? new Date(row.created_at).toLocaleString('es-EC') : '';
        meta.textContent = created ? `Registrada: ${created}` : '';
        if (row.estado === 'realizado' && row.realizado_por) meta.textContent += ` · Responsable: ${row.realizado_por}`;
        content.appendChild(meta);

        if (row.comentario) {
            const comment = document.createElement('p');
            comment.className = 'task-comment';
            comment.textContent = `Observación: ${row.comentario}`;
            content.appendChild(comment);
        }

        item.appendChild(content);

        if (isAuthenticated()) {
            const actions = document.createElement('div');
            actions.className = 'task-actions';

            const statusButton = document.createElement('button');
            statusButton.type = 'button';
            statusButton.className = 'btn btn-sm btn-outline-primary';
            statusButton.textContent = 'Estado';
            statusButton.addEventListener('click', () => openStatusModal(row.id, row.estado, row.realizado_por, row.comentario));

            const editButton = document.createElement('button');
            editButton.type = 'button';
            editButton.className = 'btn btn-sm btn-outline-secondary';
            editButton.textContent = 'Editar';
            editButton.addEventListener('click', () => editTask(row));
            actions.append(statusButton, editButton);

            if (isAdmin()) {
                const deleteButton = document.createElement('button');
                deleteButton.type = 'button';
                deleteButton.className = 'btn btn-sm btn-outline-danger';
                deleteButton.textContent = 'Eliminar';
                deleteButton.addEventListener('click', () => deleteTask(row.id));
                actions.appendChild(deleteButton);
            }
            item.appendChild(actions);
        }

        list.appendChild(item);
    });
}

window.addEventListener('DOMContentLoaded', () => {
    const theme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-bs-theme', theme);
    updateThemeButton(theme);

    document.getElementById('taskInput')?.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            addTask();
        }
    });

    document.getElementById('loginForm')?.addEventListener('submit', event => {
        event.preventDefault();
        loginAdmin();
    });

    document.getElementById('arrastrarPendientesBtn')?.addEventListener('click', arrastrarPendientesMesAnterior);
    document.getElementById('filtroMes')?.addEventListener('change', event => changeMonth(event.target.value));

    boot();
});