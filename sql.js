let db;

async function initDatabase() {
    const config = { locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}` };
    const SQL = await initSqlJs(config);
    
    // 1. Intentar recuperar la base de datos guardada
    const savedDb = localStorage.getItem('sqlite_db');

    if (savedDb) {
        // Si existe, convertimos el string base64 de vuelta a un array de bytes
        const u8array = Uint8Array.from(atob(savedDb), c => c.charCodeAt(0));
        db = new SQL.Database(u8array);
        console.log("Base de datos recuperada desde LocalStorage");
    } else {
        // Si no existe, crear una nueva
        db = new SQL.Database();
        db.run("CREATE TABLE IF NOT EXISTS tareas (id INTEGER PRIMARY KEY AUTOINCREMENT, texto TEXT, cumplida INTEGER DEFAULT 0);");
        console.log("Nueva base de datos creada");
    }
    
    renderTasks();
}

// 2. Función para persistir los cambios
function saveToLocalStorage() {
    // Exportamos la base de datos SQL a un array de bytes
    const data = db.export();
    // Lo convertimos a una cadena de texto (base64) para poder guardarlo en LocalStorage
    const base64str = btoa(String.fromCharCode.apply(null, data));
    localStorage.setItem('sqlite_db', base64str);
}

// 3. Modifica tus funciones de acción para que llamen a guardar:
function addTask() {
    const input = document.getElementById('taskInput');
    const text = input.value.trim();
    if (text !== "") {
        db.run("INSERT INTO tareas (texto) VALUES (?)", [text]);
        input.value = "";
        saveToLocalStorage(); // <-- ¡IMPORTANTE!
        renderTasks();
    }
}

function toggleTask(id, currentState) {
    const newState = currentState === 0 ? 1 : 0;
    db.run("UPDATE tareas SET cumplida = ? WHERE id = ?", [newState, id]);
    saveToLocalStorage(); // <-- ¡IMPORTANTE!
    renderTasks();
}

function deleteTask(id) {
    db.run("DELETE FROM tareas WHERE id = ?", [id]);
    saveToLocalStorage(); // <-- ¡IMPORTANTE!
    renderTasks();
}
