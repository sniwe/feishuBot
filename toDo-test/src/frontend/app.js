(function () {
  const TASKS_ENDPOINT = "/api/tasks";
  const form = document.getElementById("todo-form");
  const input = document.getElementById("todo-input");
  const list = document.getElementById("todo-list");

  let items = [];
  let editingId = null;
  let editingText = "";

  void init();

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    items.push({ id: crypto.randomUUID(), text: text, done: false });
    input.value = "";
    void persistAndRender();
  });

  async function init() {
    items = await fetchItems();
    render();
  }

  async function fetchItems() {
    try {
      const response = await fetch(TASKS_ENDPOINT, { method: "GET" });
      if (!response.ok) return [];
      const payload = await response.json();
      return Array.isArray(payload.items) ? payload.items : [];
    } catch {
      return [];
    }
  }

  async function saveItems() {
    const response = await fetch(TASKS_ENDPOINT, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: items })
    });

    if (!response.ok) {
      throw new Error("Unable to save tasks");
    }

    const payload = await response.json();
    items = Array.isArray(payload.items) ? payload.items : items;
  }

  async function persistAndRender() {
    try {
      await saveItems();
      render();
    } catch (error) {
      console.error(error);
      alert("Failed to save tasks. Keep the server running and try again.");
    }
  }

  async function toggleItem(id) {
    items = items.map(function (item) {
      return item.id === id ? { id: item.id, text: item.text, done: !item.done } : item;
    });
    await persistAndRender();
  }

  async function removeItem(id) {
    items = items.filter(function (item) {
      return item.id !== id;
    });
    if (editingId === id) {
      editingId = null;
      editingText = "";
    }
    await persistAndRender();
  }

  function startEdit(item) {
    editingId = item.id;
    editingText = item.text;
    render();
  }

  function cancelEdit() {
    editingId = null;
    editingText = "";
    render();
  }

  async function commitEdit(id) {
    const nextText = editingText.trim();
    if (!nextText) return;

    items = items.map(function (item) {
      return item.id === id ? { id: item.id, text: nextText, done: item.done } : item;
    });

    editingId = null;
    editingText = "";
    await persistAndRender();
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
      checkbox.addEventListener("change", function () { void toggleItem(item.id); });
      left.appendChild(checkbox);

      if (editingId === item.id) {
        const editInput = document.createElement("input");
        editInput.type = "text";
        editInput.className = "edit-input";
        editInput.value = editingText;
        editInput.setAttribute("aria-label", "Edit task name");
        editInput.addEventListener("input", function (event) {
          editingText = event.target.value;
        });
        editInput.addEventListener("keydown", function (event) {
          if (event.key === "Enter") {
            event.preventDefault();
            void commitEdit(item.id);
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
        save.addEventListener("click", function () { void commitEdit(item.id); });

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
      del.addEventListener("click", function () { void removeItem(item.id); });

      left.appendChild(label);
      actions.appendChild(edit);
      actions.appendChild(del);
      li.appendChild(left);
      li.appendChild(actions);
      list.appendChild(li);
    });
  }
})();
