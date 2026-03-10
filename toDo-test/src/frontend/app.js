(function () {
  const STORAGE_KEY = "todo-test-items";
  const SESSION_STORAGE_KEY = "todo-test-session";
  const form = document.getElementById("todo-form");
  const input = document.getElementById("todo-input");
  const list = document.getElementById("todo-list");

  const session = loadSession();
  let items = session.items;
  let editingId = session.editingId;
  let editingText = session.editingText;
  input.value = session.inputText;
  render();

  document.addEventListener("keydown", function (event) {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (String(event.key).toLowerCase() !== "s") return;
    event.preventDefault();
    persistSessionState();
  });

  window.addEventListener("beforeunload", persistSessionState);

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    items.push({ id: crypto.randomUUID(), text: text, done: false });
    input.value = "";
    persistSessionState();
    render();
  });

  input.addEventListener("input", saveSessionState);

  function loadItems() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveItems() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || typeof parsed !== "object") {
        return { items: loadItems(), editingId: null, editingText: "", inputText: "" };
      }

      const nextItems = Array.isArray(parsed.items) ? parsed.items : loadItems();
      const nextEditingId = typeof parsed.editingId === "string" ? parsed.editingId : null;
      const hasEditingTarget = nextItems.some(function (item) {
        return item.id === nextEditingId;
      });

      return {
        items: nextItems,
        editingId: hasEditingTarget ? nextEditingId : null,
        editingText: hasEditingTarget && typeof parsed.editingText === "string" ? parsed.editingText : "",
        inputText: typeof parsed.inputText === "string" ? parsed.inputText : ""
      };
    } catch {
      return { items: loadItems(), editingId: null, editingText: "", inputText: "" };
    }
  }

  function saveSessionState() {
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        items: items,
        editingId: editingId,
        editingText: editingText,
        inputText: input.value
      })
    );
  }

  function persistSessionState() {
    saveItems();
    saveSessionState();
  }

  function toggleItem(id) {
    items = items.map(function (item) {
      return item.id === id ? { id: item.id, text: item.text, done: !item.done } : item;
    });
    persistSessionState();
    render();
  }

  function removeItem(id) {
    items = items.filter(function (item) {
      return item.id !== id;
    });
    if (editingId === id) {
      editingId = null;
      editingText = "";
    }
    persistSessionState();
    render();
  }

  function startEdit(item) {
    editingId = item.id;
    editingText = item.text;
    saveSessionState();
    render();
  }

  function cancelEdit() {
    editingId = null;
    editingText = "";
    saveSessionState();
    render();
  }

  function commitEdit(id) {
    const nextText = editingText.trim();
    if (!nextText) return;

    items = items.map(function (item) {
      return item.id === id ? { id: item.id, text: nextText, done: item.done } : item;
    });

    editingId = null;
    editingText = "";
    persistSessionState();
    render();
  }

  function render() {
    list.innerHTML = "";
    items.forEach(function (item) {
      const li = document.createElement("li");
      li.className = "item" + (item.done ? " done" : "");

      const left = document.createElement("div");
      left.className = "item-left";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = item.done;
      checkbox.setAttribute("aria-label", "Mark task complete");
      checkbox.addEventListener("change", function () { toggleItem(item.id); });
      left.appendChild(checkbox);

      if (editingId === item.id) {
        const editInput = document.createElement("input");
        editInput.type = "text";
        editInput.className = "edit-input";
        editInput.value = editingText;
        editInput.setAttribute("aria-label", "Edit task name");
        editInput.addEventListener("input", function (event) {
          editingText = event.target.value;
          saveSessionState();
        });
        editInput.addEventListener("keydown", function (event) {
          if (event.key === "Enter") {
            event.preventDefault();
            commitEdit(item.id);
          }
          if (event.key === "Escape") {
            event.preventDefault();
            cancelEdit();
          }
        });
        left.appendChild(editInput);

        const actions = document.createElement("div");
        actions.className = "item-actions";

        const save = document.createElement("button");
        save.type = "button";
        save.className = "save";
        save.textContent = "Save";
        save.addEventListener("click", function () { commitEdit(item.id); });

        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "cancel";
        cancel.textContent = "Cancel";
        cancel.addEventListener("click", cancelEdit);

        actions.appendChild(save);
        actions.appendChild(cancel);
        li.appendChild(left);
        li.appendChild(actions);

        list.appendChild(li);
        setTimeout(function () {
          editInput.focus();
          editInput.select();
        }, 0);
        return;
      }

      const label = document.createElement("span");
      label.className = "label";
      label.textContent = item.text;

      const actions = document.createElement("div");
      actions.className = "item-actions";

      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "edit";
      edit.textContent = "Edit";
      edit.addEventListener("click", function () { startEdit(item); });

      const del = document.createElement("button");
      del.type = "button";
      del.className = "delete";
      del.textContent = "Delete";
      del.addEventListener("click", function () { removeItem(item.id); });

      left.appendChild(label);
      actions.appendChild(edit);
      actions.appendChild(del);
      li.appendChild(left);
      li.appendChild(actions);
      list.appendChild(li);
    });
  }
})();
