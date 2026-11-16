/* Bitácora Industrial - lógica de interfaz y operaciones Supabase */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const db = () => window.db;
  const STATUS = {
    pendiente: "Pendiente", en_proceso: "En proceso",
    realizado: "Realizada", cancelado: "Cancelada"
  };
  const PRIORITY = { critica: "Crítica", alta: "Alta", media: "Media", baja: "Baja" };
  const TYPE = {
    correctivo: "Correctivo", preventivo: "Preventivo", predictivo: "Predictivo",
    inspeccion: "Inspección", mejora: "Mejora"
  };

  let tasks = [];
  let areas = [];
  let equipment = [];
  let currentUser = null;
  let currentProfile = null;
  let toastTimer = null;
  let requestNumber = 0;

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));

  function notify(message, isError = false) {
    const el = $("toast");
    el.textContent = message;
    el.style.borderColor = isError ? "var(--danger)" : "var(--border)";
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 3500);
  }

  function setConnection(state, label) {
    const el = $("connectionState");
    el.className = `connection ${state}`;
    el.lastChild.textContent = ` ${label}`;
  }

  function formatDate(value) {
    if (!value) return "Sin fecha";
    const d = new Date(`${value}T00:00:00`);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("es-EC");
  }

  function isAdmin() {
    return currentProfile?.role === "admin";
  }

  function updateAuthUI() {
    const logged = Boolean(currentUser);
    $("loginOpenButton").classList.toggle("hidden", logged);
    $("userMenu").classList.toggle("hidden", !logged);
    $("userLabel").textContent = currentProfile?.username || currentUser?.email || "Usuario";
    $("newTaskButton").disabled = !logged;
  }

  async function loadProfile() {
    currentProfile = null;
    if (!currentUser) return;
    const { data, error } = await db().from("profiles")
      .select("id, username, role").eq("id", currentUser.id).maybeSingle();
    if (error) throw error;
    currentProfile = data;
  }

  async function loadLookups() {
    const [areaResult, equipmentResult] = await Promise.all([
      db().from("areas").select("id,nombre").order("nombre"),
      db().from("equipos").select("id,nombre,area_id").order("nombre")
    ]);
    if (areaResult.error) throw areaResult.error;
    if (equipmentResult.error) throw equipmentResult.error;
    areas = areaResult.data || [];
    equipment = equipmentResult.data || [];
    const areaOptions = areas.map(a => `<option value="${a.id}">${escapeHtml(a.nombre)}</option>`).join("");
    $("areaFilter").innerHTML = `<option value="">Todas las áreas</option>${areaOptions}`;
    $("taskArea").innerHTML = `<option value="">Seleccionar área</option>${areaOptions}`;
    fillEquipment();
  }

  function fillEquipment(areaId = $("taskArea").value) {
    const list = equipment.filter(e => !areaId || String(e.area_id) === String(areaId));
    $("taskEquipment").innerHTML = `<option value="">Sin equipo específico</option>` +
      list.map(e => `<option value="${e.id}">${escapeHtml(e.nombre)}</option>`).join("");
  }

  async function loadTasks() {
    if (!db()) return;
    const myRequest = ++requestNumber;
    $("taskList").innerHTML = '<div class="loading">Cargando tareas...</div>';
    const { data, error } = await db().from("tareas")
      .select("id,codigo,titulo,descripcion,area_id,equipo_id,familia,tipo_mantenimiento,prioridad,estado,fecha_programada,responsable,observaciones,created_at,areas(nombre),equipos(nombre)")
      .order("created_at", { ascending: false }).limit(1000);
    if (myRequest !== requestNumber) return; // evita que una consulta anterior sobrescriba la nueva
    if (error) {
      $("taskList").innerHTML = "";
      notify(`No se pudieron cargar las tareas: ${error.message}`, true);
      return;
    }
    tasks = data || [];
    renderTasks();
  }

  function filteredTasks() {
    const term = $("searchInput").value.trim().toLocaleLowerCase("es");
    const status = $("statusFilter").value;
    const area = $("areaFilter").value;
    const priority = $("priorityFilter").value;
    const from = $("dateFromFilter").value;
    const to = $("dateToFilter").value;
    return tasks.filter(t => {
      const haystack = [t.codigo, t.titulo, t.descripcion, t.familia, t.responsable, t.equipos?.nombre, t.areas?.nombre]
        .filter(Boolean).join(" ").toLocaleLowerCase("es");
      const date = t.fecha_programada || t.created_at?.slice(0, 10) || "";
      return (!term || haystack.includes(term)) &&
        (!status || t.estado === status) &&
        (!area || String(t.area_id) === area) &&
        (!priority || t.prioridad === priority) &&
        (!from || date >= from) && (!to || date <= to);
    });
  }

  function renderTasks() {
    const list = filteredTasks();
    $("statTotal").textContent = list.length;
    $("statPending").textContent = list.filter(t => t.estado === "pendiente").length;
    $("statProgress").textContent = list.filter(t => t.estado === "en_proceso").length;
    $("statDone").textContent = list.filter(t => t.estado === "realizado").length;
    $("resultCount").textContent = `${list.length} ${list.length === 1 ? "registro" : "registros"}`;
    $("emptyState").classList.toggle("hidden", list.length !== 0);
    $("taskList").classList.toggle("hidden", list.length === 0);

    $("taskList").innerHTML = list.map(t => {
      const status = STATUS[t.estado] || t.estado;
      const priority = PRIORITY[t.prioridad] || t.prioridad;
      const actions = currentUser ? `
        <div class="task-actions">
          <button data-action="edit" data-id="${t.id}">Editar</button>
          <button data-action="status" data-id="${t.id}" data-status="en_proceso">En proceso</button>
          <button data-action="status" data-id="${t.id}" data-status="realizado">Marcar realizada</button>
          ${isAdmin() ? `<button data-action="delete" data-id="${t.id}">Eliminar</button>` : ""}
        </div>` : "";
      return `<article class="task-card">
        <div class="task-top">
          <div><span class="task-code">${escapeHtml(t.codigo || "SIN CÓDIGO")}</span>
            <h3 class="task-title">${escapeHtml(t.titulo)}</h3></div>
          <div><span class="pill ${escapeHtml(t.estado)}">${escapeHtml(status)}</span></div>
        </div>
        ${t.descripcion ? `<p class="task-description">${escapeHtml(t.descripcion)}</p>` : ""}
        <div class="task-meta">
          <span>▣ ${escapeHtml(t.areas?.nombre || "Sin área")}</span>
          <span>⚙ ${escapeHtml(t.equipos?.nombre || "Sin equipo")}</span>
          <span>Prioridad: <b class="priority ${escapeHtml(t.prioridad)}">${escapeHtml(priority)}</b></span>
          <span>Tipo: ${escapeHtml(TYPE[t.tipo_mantenimiento] || t.tipo_mantenimiento || "—")}</span>
          <span>Programada: ${formatDate(t.fecha_programada)}</span>
          <span>Responsable: ${escapeHtml(t.responsable || "No asignado")}</span>
        </div>
        ${t.observaciones ? `<p class="task-description">Observaciones: ${escapeHtml(t.observaciones)}</p>` : ""}
        ${actions}
      </article>`;
    }).join("");
  }

  function resetTaskForm() {
    $("taskForm").reset();
    $("taskId").value = "";
    $("taskStatus").value = "pendiente";
    $("taskPriority").value = "media";
    $("taskType").value = "correctivo";
    $("taskDialogTitle").textContent = "Nueva tarea";
    fillEquipment("");
  }

  function openNewTask() {
    if (!currentUser) return notify("Inicia sesión para registrar tareas.", true);
    resetTaskForm();
    $("taskDialog").showModal();
  }

  function openEditTask(id) {
    const t = tasks.find(x => String(x.id) === String(id));
    if (!t) return;
    $("taskId").value = t.id;
    $("taskTitle").value = t.titulo || "";
    $("taskDescription").value = t.descripcion || "";
    $("taskArea").value = t.area_id || "";
    fillEquipment(t.area_id);
    $("taskEquipment").value = t.equipo_id || "";
    $("taskFamily").value = t.familia || "";
    $("taskType").value = t.tipo_mantenimiento || "correctivo";
    $("taskPriority").value = t.prioridad || "media";
    $("taskStatus").value = t.estado || "pendiente";
    $("taskScheduled").value = t.fecha_programada || "";
    $("taskResponsible").value = t.responsable || "";
    $("taskNotes").value = t.observaciones || "";
    $("taskDialogTitle").textContent = "Editar tarea";
    $("taskDialog").showModal();
  }

  async function saveTask(event) {
    event.preventDefault();
    if (!currentUser) return notify("Debes iniciar sesión.", true);
    const id = $("taskId").value;
    const payload = {
      titulo: $("taskTitle").value.trim(),
      descripcion: $("taskDescription").value.trim() || null,
      area_id: $("taskArea").value || null,
      equipo_id: $("taskEquipment").value || null,
      familia: $("taskFamily").value.trim() || null,
      tipo_mantenimiento: $("taskType").value,
      prioridad: $("taskPriority").value,
      estado: $("taskStatus").value,
      fecha_programada: $("taskScheduled").value || null,
      responsable: $("taskResponsible").value.trim() || null,
      observaciones: $("taskNotes").value.trim() || null
    };
    if (!payload.titulo || !payload.area_id) return notify("Completa el título y el área.", true);

    const button = $("taskForm").querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const query = id
        ? db().from("tareas").update(payload).eq("id", id)
        : db().from("tareas").insert({ ...payload, creado_por: currentUser.id });
      const { error } = await query;
      if (error) throw error;
      $("taskDialog").close();
      notify(id ? "Tarea actualizada." : "Tarea registrada.");
      await loadTasks();
    } catch (error) {
      notify(`No se pudo guardar: ${error.message}`, true);
    } finally {
      button.disabled = false;
    }
  }

  async function changeStatus(id, status) {
    if (!currentUser) return notify("Inicia sesión para modificar tareas.", true);
    const { error } = await db().from("tareas").update({ estado: status }).eq("id", id);
    if (error) return notify(`No se pudo cambiar el estado: ${error.message}`, true);
    notify("Estado actualizado.");
    await loadTasks();
  }

  async function deleteTask(id) {
    if (!isAdmin()) return notify("Solo el administrador puede eliminar tareas.", true);
    if (!confirm("¿Seguro que deseas eliminar esta tarea? Esta acción no se puede deshacer.")) return;
    const { error } = await db().from("tareas").delete().eq("id", id);
    if (error) return notify(`No se pudo eliminar: ${error.message}`, true);
    notify("Tarea eliminada.");
    await loadTasks();
  }

  function exportCSV() {
    const rows = filteredTasks();
    const columns = [
      ["Código", "codigo"], ["Título", "titulo"], ["Descripción", "descripcion"],
      ["Área", t => t.areas?.nombre], ["Equipo", t => t.equipos?.nombre],
      ["Familia", "familia"], ["Tipo", "tipo_mantenimiento"], ["Prioridad", "prioridad"],
      ["Estado", "estado"], ["Fecha programada", "fecha_programada"],
      ["Responsable", "responsable"], ["Observaciones", "observaciones"]
    ];
    const quote = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const content = [columns.map(c => quote(c[0])).join(";"),
      ...rows.map(t => columns.map(c => quote(typeof c[1] === "function" ? c[1](t) : t[c[1]])).join(";"))
    ].join("\r\n");
    const blob = new Blob(["\ufeff", content], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, "bitacora-industrial.csv");
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  function exportPDF() {
    if (!window.jspdf?.jsPDF) return notify("No se pudo cargar jsPDF. Revisa tu conexión.", true);
    const rows = filteredTasks();
    const doc = new window.jspdf.jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    doc.setFont("helvetica", "bold"); doc.setFontSize(16);
    doc.text("BITÁCORA INDUSTRIAL - REPORTE DE TAREAS", 14, 15);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.text(`Generado: ${new Date().toLocaleString("es-EC")} | Registros: ${rows.length}`, 14, 21);
    const headers = [["Código", "Trabajo", "Área", "Equipo", "Prioridad", "Estado", "Programada", "Responsable"]];
    const body = rows.map(t => [
      t.codigo || "", t.titulo || "", t.areas?.nombre || "", t.equipos?.nombre || "",
      PRIORITY[t.prioridad] || t.prioridad || "", STATUS[t.estado] || t.estado || "",
      t.fecha_programada || "", t.responsable || ""
    ]);
    if (typeof doc.autoTable === "function") {
      doc.autoTable({ head: headers, body, startY: 27, styles: { fontSize: 7, cellPadding: 2 }, headStyles: { fillColor: [20, 70, 100] } });
    } else {
      let y = 30;
      rows.forEach((t, i) => {
        const line = `${i + 1}. ${t.codigo || ""} ${t.titulo} | ${t.areas?.nombre || ""} | ${STATUS[t.estado] || t.estado}`;
        const split = doc.splitTextToSize(line, 265);
        if (y + split.length * 4 > 190) { doc.addPage(); y = 15; }
        doc.text(split, 14, y); y += split.length * 4 + 2;
      });
    }
    doc.save("bitacora-industrial.pdf");
  }

  async function login(event) {
    event.preventDefault();
    $("loginError").classList.add("hidden");
    const { data, error } = await db().auth.signInWithPassword({
      email: $("loginEmail").value.trim(),
      password: $("loginPassword").value
    });
    if (error) {
      $("loginError").textContent = error.message;
      $("loginError").classList.remove("hidden");
      return;
    }
    currentUser = data.user;
    try {
      await loadProfile();
      updateAuthUI();
      $("loginDialog").close();
      $("loginForm").reset();
      notify("Sesión iniciada.");
      renderTasks();
    } catch (profileError) {
      notify(`Sesión iniciada, pero no se pudo leer el perfil: ${profileError.message}`, true);
    }
  }

  async function logout() {
    const { error } = await db().auth.signOut();
    if (error) return notify(error.message, true);
    currentUser = null; currentProfile = null;
    updateAuthUI(); renderTasks(); notify("Sesión cerrada.");
  }

  function bindEvents() {
    $("newTaskButton").addEventListener("click", openNewTask);
    $("loginOpenButton").addEventListener("click", () => $("loginDialog").showModal());
    $("logoutButton").addEventListener("click", logout);
    $("taskForm").addEventListener("submit", saveTask);
    $("loginForm").addEventListener("submit", login);
    $("taskArea").addEventListener("change", () => fillEquipment());
    ["searchInput", "statusFilter", "areaFilter", "priorityFilter", "dateFromFilter", "dateToFilter"]
      .forEach(id => $(id).addEventListener("input", renderTasks));
    $("clearFiltersButton").addEventListener("click", () => {
      ["searchInput", "statusFilter", "areaFilter", "priorityFilter", "dateFromFilter", "dateToFilter"]
        .forEach(id => $(id).value = "");
      renderTasks();
    });
    $("csvButton").addEventListener("click", exportCSV);
    $("pdfButton").addEventListener("click", exportPDF);
    $("taskList").addEventListener("click", event => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      const { action, id, status } = button.dataset;
      if (action === "edit") openEditTask(id);
      if (action === "status") changeStatus(id, status);
      if (action === "delete") deleteTask(id);
    });
    document.querySelectorAll("[data-close]").forEach(button => {
      button.addEventListener("click", () => $(button.dataset.close).close());
    });
    $("themeButton").addEventListener("click", () => {
      document.documentElement.classList.toggle("light");
      localStorage.setItem("bitacora-theme", document.documentElement.classList.contains("light") ? "light" : "dark");
    });
    if (localStorage.getItem("bitacora-theme") === "light") document.documentElement.classList.add("light");
  }

  async function init() {
    bindEvents();
    if (!db()) {
      setConnection("offline", "Configura Supabase");
      $("taskList").innerHTML = '<div class="loading">Configura las credenciales en supabaseClient.js para conectar la aplicación.</div>';
      return;
    }
    try {
      const { data: { session } } = await db().auth.getSession();
      currentUser = session?.user || null;
      if (currentUser) await loadProfile();
      updateAuthUI();
      await loadLookups();
      await loadTasks();
      setConnection("online", "Conectado");
    } catch (error) {
      setConnection("offline", "Error de conexión");
      notify(`Error de inicialización: ${error.message}`, true);
    }

    db().auth.onAuthStateChange((_event, session) => {
      // La sesión inicial ya se procesa en init. Los cambios posteriores actualizan el estado.
      currentUser = session?.user || null;
      setTimeout(async () => {
        try { await loadProfile(); } catch (_) { currentProfile = null; }
        updateAuthUI(); renderTasks();
      }, 0);
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
